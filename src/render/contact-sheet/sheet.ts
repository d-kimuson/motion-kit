import {
  frameToTime,
  toSeconds,
  validateOutputFrame,
  type FrameRate,
} from '../../core/timeline/time.ts';
import { type Diagnostic } from '../../lib/diagnostic.ts';
import { type Result } from '../../lib/result.ts';
import { type BrowserOptions } from '../browser/launch.ts';
import { type Renderer } from '../renderer.ts';
import { composeContactSheet } from './compose.ts';
import { contactSheetLayout, type ContactSheetLayout } from './layout.ts';
import {
  selectContactSheetFrames,
  type ContactSheetFrameSpec,
  type ContactSheetRegion,
} from './select.ts';

// One Contact Sheet, from the mounted Composition to the PNG: pick the representative frames, lay
// them out, capture them with the one renderer, and composite. The caller owns the Renderer and the
// output path; this function owns everything between the descriptor and the image bytes.

export type ContactSheetFrame = {
  readonly frame: number;
  readonly timeSeconds: number;
  /** 0-based cell of the frame in the grid, so a tile can be found without counting. */
  readonly column: number;
  readonly row: number;
};

export type ContactSheet = {
  readonly image: Buffer;
  readonly composition: {
    readonly id: string;
    readonly width: number;
    readonly height: number;
    readonly fps: { readonly numerator: number; readonly denominator: number };
    readonly frameCount: number;
  };
  readonly layout: ContactSheetLayout;
  readonly frames: readonly ContactSheetFrame[];
  /** Every capture warning the frames emitted, in frame order. */
  readonly diagnostics: readonly Diagnostic[];
};

type SheetOutcome =
  | Result<ContactSheet, readonly Diagnostic[]>
  | { readonly ok: false; readonly aborted: true };

/**
 * Draws the frames `spec` selects from `region` into one sheet. `rate` is the Composition's own, so
 * a tile's label is the Presentation Time the frame has on the timeline rather than a second
 * conversion of it.
 */
export const renderContactSheet = async (options: {
  readonly renderer: Renderer;
  readonly spec: ContactSheetFrameSpec;
  readonly region: ContactSheetRegion;
  readonly rate: FrameRate;
  readonly columns?: number | undefined;
  readonly tileWidth?: number | undefined;
  readonly browser?: BrowserOptions | undefined;
  readonly signal?: AbortSignal | undefined;
}): Promise<SheetOutcome> => {
  const { renderer, spec, region, rate } = options;
  const aborted = (): boolean => options.signal?.aborted === true;
  const descriptor = renderer.descriptor();
  // An explicitly named frame outside the Composition is the same finding `frame` and `check`
  // report for it; the region check below then only catches a frame the caller cut off with
  // --from/--to, which is an argument problem rather than a Composition one.
  if (spec.kind === 'frames') {
    const outside = spec.frames.flatMap((frame) => {
      const checked = validateOutputFrame(frame, BigInt(descriptor.durationInFrames));
      return checked.ok ? [] : [checked.error];
    });
    if (outside.length > 0) return { ok: false, error: outside };
  }
  const selected = selectContactSheetFrames({ spec, region });
  if (!selected.ok) return selected;
  const frames = selected.value;
  const laidOut = contactSheetLayout({
    tileCount: frames.length,
    sourceWidth: descriptor.width,
    sourceHeight: descriptor.height,
    columns: options.columns,
    tileWidth: options.tileWidth,
  });
  if (!laidOut.ok) return { ok: false, error: [laidOut.error] };
  const layout = laidOut.value;
  const tiles: {
    frame: number;
    timeSeconds: number;
    image: Uint8Array;
  }[] = [];
  const diagnostics: Diagnostic[] = [];
  for (const frame of frames) {
    const result = await renderer.renderFrame({
      frame,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
    if (!result.ok) return 'aborted' in result ? { ok: false, aborted: true } : result;
    tiles.push({
      frame,
      timeSeconds: toSeconds(frameToTime(BigInt(frame), rate)),
      image: result.value.image,
    });
    diagnostics.push(...result.value.diagnostics);
  }
  if (aborted()) return { ok: false, aborted: true };
  const composed = await composeContactSheet({
    tiles,
    layout,
    ...(options.browser === undefined ? {} : { browser: options.browser }),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  });
  if (!composed.ok)
    return 'aborted' in composed
      ? { ok: false, aborted: true }
      : { ok: false, error: [composed.error] };
  return {
    ok: true,
    value: {
      image: composed.value,
      composition: {
        id: descriptor.id,
        width: descriptor.width,
        height: descriptor.height,
        fps: descriptor.fps,
        frameCount: descriptor.durationInFrames,
      },
      layout,
      frames: tiles.map((tile, index) => ({
        frame: tile.frame,
        timeSeconds: tile.timeSeconds,
        column: index % layout.columns,
        row: Math.floor(index / layout.columns),
      })),
      diagnostics,
    },
  };
};
