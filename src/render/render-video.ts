import {
  createFrameRate,
  frameCount,
  frameToTime,
  timeToFrameFloor,
  toSeconds,
} from '../core/timeline/time.ts';
import { type LoadingDescriptor } from '../lib/loading-protocol.ts';
import { type CaptureFormat, type FrameCaptureResult } from './capture/frame.ts';
import { encoderInvariantDiagnostic } from './encoding/diagnostics.ts';
import {
  type EncodeOutcome,
  type EncodeProgress,
  type Encoder,
  type FfmpegEncoderOptions,
  type VideoEncodingOptions,
} from './encoding/encoder.ts';
import { createFfmpegEncoder } from './encoding/ffmpeg.ts';

/** The Composition surface video output needs: a mounted descriptor and its frame stream.
 * `Renderer` and `RendererPool` satisfy it structurally, which keeps this module free of a
 * renderer import.
 */
export type VideoComposition = {
  readonly descriptor: () => LoadingDescriptor;
  readonly renderFrames: (options: {
    readonly from: number;
    readonly to: number;
    readonly signal?: AbortSignal;
    readonly format?: CaptureFormat;
  }) => AsyncIterable<FrameCaptureResult>;
};

export type RenderVideoOptions = VideoEncodingOptions & {
  readonly fps?: { readonly numerator: number; readonly denominator: number };
  readonly composition: VideoComposition;
  /** Absolute path of the MP4 to produce. */
  readonly output: string;
  /** Directory the Composition's relative audio sources resolve against; the process working
   * directory when omitted. The CLI passes its own project root explicitly.
   */
  readonly projectRoot?: string;
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: EncodeProgress) => void;
  /** A probed encoder; otherwise one probe happens here, once per call. */
  readonly encoder?: Encoder;
  readonly ffmpegPath?: FfmpegEncoderOptions['ffmpegPath'];
};

/**
 * The capture video frames use. libx264's 4:2:0 output already discards more than a quality-95
 * JPEG does (measured on the explainer: 39.8 dB PSNR from PNG input, 39.3 dB from this JPEG), and
 * a JPEG captures in well under half a PNG's time at 1080p (system-ffmpeg-encoder ADR).
 */
export const videoCapture = { type: 'jpeg', quality: 95 } as const satisfies CaptureFormat;

/** Renders `composition`'s whole frame range and pipes it into the Encoder port.
 * No frame file ever reaches the disk: the frames go from capture to the child's stdin.
 * Audio crosses as the descriptor's declarations: the same call, the same child.
 */
export const renderVideo = async (options: RenderVideoOptions): Promise<EncodeOutcome> => {
  const { composition, output, projectRoot, signal, onProgress, encoder, ffmpegPath } = options;
  // Re-read the signal through a call so the check after the probe is not narrowed away.
  const cancelled = (): boolean => signal?.aborted === true;
  if (cancelled()) return { ok: false, aborted: true };
  const descriptor = composition.descriptor();
  const sourceRate = createFrameRate(descriptor.fps);
  const outputRate = createFrameRate(options.fps ?? descriptor.fps);
  if (!sourceRate.ok || !outputRate.ok)
    return {
      ok: false,
      error: [
        encoderInvariantDiagnostic(
          `Composition "${descriptor.id}" has an invalid frame rate.`,
          'Mount a Composition whose descriptor fps the Time Module accepts; report this as a bug.',
        ),
      ],
    };
  const duration = frameToTime(BigInt(descriptor.durationInFrames), sourceRate.value);
  const count = frameCount(duration, outputRate.value);
  if (
    !count.ok ||
    count.value > BigInt(Number.MAX_SAFE_INTEGER) ||
    outputRate.value.numerator * sourceRate.value.denominator >
      sourceRate.value.numerator * outputRate.value.denominator
  )
    return {
      ok: false,
      error: [
        encoderInvariantDiagnostic(
          'Invalid output frame rate.',
          'Choose an output frame rate no greater than the Composition frame rate.',
        ),
      ],
    };
  const total = Number(count.value);
  const frames =
    options.fps === undefined
      ? composition.renderFrames({
          from: 0,
          to: descriptor.durationInFrames,
          signal,
          format: videoCapture,
        })
      : (async function* () {
          for (let i = 0; i < total; i++) {
            const source = Number(
              timeToFrameFloor(frameToTime(BigInt(i), outputRate.value), sourceRate.value),
            );
            for await (const frame of composition.renderFrames({
              from: source,
              to: source + 1,
              signal,
              format: videoCapture,
            })) {
              yield frame;
              if (!frame.ok) return;
            }
          }
        })();
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
    frames,
    imageFormat: videoCapture.type,
    fps: options.fps ?? descriptor.fps,
    frameCount: total,
    ...(options.fps === undefined
      ? {}
      : { sourceFps: descriptor.fps, durationSeconds: toSeconds(duration) }),
    ...(options.crf === undefined ? {} : { crf: options.crf }),
    ...(options.videoBitrate === undefined ? {} : { videoBitrate: options.videoBitrate }),
    ...(options.resolution === undefined ? {} : { resolution: options.resolution }),
    ...(options.preset === undefined ? {} : { preset: options.preset }),
    output,
    ...(descriptor.audio === undefined ? {} : { audio: descriptor.audio }),
    ...(projectRoot === undefined ? {} : { projectRoot }),
    signal,
    onProgress,
  });
};
