import { compareSequenceSpans } from '../../core/sequence/directory.ts';
import { createFrameRate, frameToTime, toSeconds } from '../../core/timeline/time.ts';
import { type Diagnostic } from '../../lib/diagnostic.ts';
import { type SequenceSpan } from '../../lib/loading-protocol.ts';
import { type Result } from '../../lib/result.ts';
import { observeCapture } from '../capture/frame.ts';
import { createRendererPool, type RendererPoolOptions } from '../pool.ts';
import { audioEntries, sequenceEntries, type AudioEntry, type SequenceEntry } from './timeline.ts';

// `inspect` reports a Composition's declared timeline: its named Sequences and its audio clips.
// The audio comes from the descriptor, so it needs no frame. The Sequences exist only in the
// mounted tree, which registers each one while it is mounted, so the page has to settle frames to
// learn them. The frames are observed, not captured: each one is settled and committed under the
// renderer's ownership protocol and then released with no screenshot taken (agent ADR: inspect).

export type InspectCompositionOptions = RendererPoolOptions;

export type InspectReport = {
  readonly composition: {
    readonly id: string;
    readonly width: number;
    readonly height: number;
    readonly fps: { readonly numerator: number; readonly denominator: number };
    readonly durationInFrames: number;
    readonly durationSeconds: number;
  };
  /** Every named Sequence any frame of the Composition mounted, in `sequenceSpans` order. */
  readonly sequences: readonly SequenceEntry[];
  /** The declared clips in declaration order. */
  readonly audio: readonly AudioEntry[];
};

type Aborted = { readonly ok: false; readonly aborted: true };
export type InspectOutcome = Result<InspectReport, readonly Diagnostic[]> | Aborted;

const spanKey = ({ path, startFrame, endFrame }: SequenceSpan): string =>
  JSON.stringify([path, startFrame, endFrame]);

/**
 * Observes every frame of the Composition, `concurrency` realms at once, and reports what it
 * declares. A Sequence is only registered while its ancestors show the frame, so a frame that is
 * not observed could hide one: the scan is exhaustive instead of guessing at the boundaries.
 */
export const inspectComposition = async (
  options: InspectCompositionOptions,
): Promise<InspectOutcome> => {
  const opened = await createRendererPool(options);
  if (!opened.ok) return 'aborted' in opened ? opened : { ok: false, error: [opened.error] };
  const pool = opened.value;
  try {
    const descriptor = pool.descriptor();
    const rate = createFrameRate(descriptor.fps);
    if (!rate.ok) return { ok: false, error: [rate.error] };
    // A span equal in every field to another is a sibling of the same name and frames, which is a
    // different Sequence; a frame lists each of them, so the most any one frame listed is how many
    // exist. Taking the union of distinct spans alone would merge them. Known exception: equal
    // spans that no single frame mounts together (empty spans left at the same edge by parents shown
    // on disjoint frames, or ones mounted conditionally on disjoint frames) are counted once,
    // because the page reports spans and not identities.
    const seen = new Map<string, { readonly span: SequenceSpan; count: number }>();
    for await (const frame of pool.renderFrames({
      from: 0,
      to: descriptor.durationInFrames,
      format: observeCapture,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    })) {
      if (!frame.ok) return 'aborted' in frame ? frame : { ok: false, error: frame.error };
      const inFrame = new Map<string, { readonly span: SequenceSpan; count: number }>();
      for (const span of frame.value.sequences ?? []) {
        const key = spanKey(span);
        const entry = inFrame.get(key) ?? { span, count: 0 };
        entry.count += 1;
        inFrame.set(key, entry);
      }
      for (const [key, { span, count }] of inFrame) {
        const known = seen.get(key);
        if (known === undefined) seen.set(key, { span, count });
        else known.count = Math.max(known.count, count);
      }
    }
    return {
      ok: true,
      value: {
        composition: {
          id: descriptor.id,
          width: descriptor.width,
          height: descriptor.height,
          fps: descriptor.fps,
          durationInFrames: descriptor.durationInFrames,
          durationSeconds: toSeconds(frameToTime(BigInt(descriptor.durationInFrames), rate.value)),
        },
        sequences: sequenceEntries(
          [...seen.values()]
            .flatMap(({ span, count }) => Array.from({ length: count }, () => span))
            .sort(compareSequenceSpans),
          rate.value,
        ),
        audio: audioEntries(descriptor.audio ?? [], descriptor.durationInFrames, rate.value),
      },
    };
  } finally {
    await pool.dispose();
  }
};
