import { createFrameRate } from '../core/timeline/time.ts';
import { type LoadingDescriptor } from '../lib/loading-protocol.ts';
import { type FrameCaptureResult } from './capture/frame.ts';
import { encoderInvariantDiagnostic } from './encoding/diagnostics.ts';
import {
  type EncodeOutcome,
  type EncodeProgress,
  type Encoder,
  type FfmpegEncoderOptions,
} from './encoding/encoder.ts';
import { createFfmpegEncoder } from './encoding/ffmpeg.ts';

/** The Composition surface video output needs: a mounted descriptor and its frame stream.
 * `Renderer` satisfies it structurally, which keeps this module free of a renderer import.
 */
export type VideoComposition = {
  readonly descriptor: () => LoadingDescriptor;
  readonly renderFrames: (options: {
    readonly from: number;
    readonly to: number;
    readonly signal?: AbortSignal;
  }) => AsyncIterable<FrameCaptureResult>;
};

export type RenderVideoOptions = {
  readonly composition: VideoComposition;
  /** Absolute path of the MP4 to produce. */
  readonly output: string;
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: EncodeProgress) => void;
  /** A probed encoder; otherwise one probe happens here, once per call. */
  readonly encoder?: Encoder;
  readonly ffmpegPath?: FfmpegEncoderOptions['ffmpegPath'];
};

/** Renders `composition`'s whole frame range and pipes it into the Encoder port.
 * No PNG file ever reaches the disk: the frames go from capture to the child's stdin.
 */
export const renderVideo = async (options: RenderVideoOptions): Promise<EncodeOutcome> => {
  const { composition, output, signal, onProgress, encoder, ffmpegPath } = options;
  // Re-read the signal through a call so the check after the probe is not narrowed away.
  const cancelled = (): boolean => signal?.aborted === true;
  if (cancelled()) return { ok: false, aborted: true };
  const descriptor = composition.descriptor();
  if (!createFrameRate(descriptor.fps).ok)
    return {
      ok: false,
      error: [
        encoderInvariantDiagnostic(
          `Composition "${descriptor.id}" has an invalid frame rate.`,
          'Mount a Composition whose descriptor fps the Time Module accepts; report this as a bug.',
        ),
      ],
    };
  let resolved = encoder;
  if (resolved === undefined) {
    // Probe before the first frame is rendered, so a missing binary fails without a capture run.
    const probed = await createFfmpegEncoder({
      ffmpegPath,
      ...(signal === undefined ? {} : { signal }),
    });
    if (!probed.ok)
      return 'aborted' in probed
        ? { ok: false, aborted: true }
        : { ok: false, error: [probed.error] };
    resolved = probed.value;
  }
  if (cancelled()) return { ok: false, aborted: true };
  return resolved.encode({
    frames: composition.renderFrames({
      from: 0,
      to: descriptor.durationInFrames,
      signal,
    }),
    fps: descriptor.fps,
    frameCount: descriptor.durationInFrames,
    output,
    signal,
    onProgress,
  });
};
