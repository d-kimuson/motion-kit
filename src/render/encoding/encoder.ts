import { type Diagnostic } from '../../lib/diagnostic.ts';
import { type AudioTrack } from '../../lib/loading-protocol.ts';
import { type Result } from '../../lib/result.ts';
import { type CaptureFormat, type FrameCaptureResult } from '../capture/frame.ts';

/** Not a new type: exactly the stream `renderFrames` already yields, re-aliased so it cannot
 * drift from the public `FrameCaptureResult` (exported from the `./render` subpath).
 */
export type FrameStream = AsyncIterable<FrameCaptureResult>;

export type EncodeProgress = {
  /** Frames handed to FFmpeg so far; monotonic and never greater than `frameCount`. */
  readonly encodedFrames: number;
  /** The request's total, echoed; not a count of the stream. */
  readonly frameCount: number;
};

export type VideoEncodingOptions = {
  readonly crf?: number;
  readonly videoBitrate?: number;
  readonly resolution?: { readonly width: number; readonly height: number };
  readonly sourceFps?: { readonly numerator: number; readonly denominator: number };
  readonly durationSeconds?: number;
  readonly preset?:
    | 'ultrafast'
    | 'superfast'
    | 'veryfast'
    | 'faster'
    | 'fast'
    | 'medium'
    | 'slow'
    | 'slower'
    | 'veryslow';
};

export type EncodeRequest = VideoEncodingOptions & {
  readonly frames: FrameStream;
  /** The encoding every frame of `frames` arrives in; PNG when omitted. A frame in another
   * encoding is a contract violation (`internal.unexpected`).
   */
  readonly imageFormat?: CaptureFormat['type'];
  /** The output rational rate; never a rounded float. */
  readonly fps: { readonly numerator: number; readonly denominator: number };
  /** The total output frames expected from `frames`; bounds progress and the receipt. Zero is legal. */
  readonly frameCount: number;
  /** Absolute path of the MP4 to produce. */
  readonly output: string;
  /** Audio clips the Composition declared, in declaration order. Absent or empty is the silent
   * path: the child receives exactly the video-only arguments. Times are frame counts, converted
   * once by the Time Module on the same rational timebase as `frames`.
   */
  readonly audio?: readonly AudioTrack[];
  /** Directory that a relative `audio[].src` resolves against; the process working directory
   * when omitted. Absolute sources are used as given.
   */
  readonly projectRoot?: string;
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: EncodeProgress) => void;
};

export type EncodeReceipt = {
  readonly output: string;
  /** Equal to the request's `frameCount`; the encoder counts what it wrote. */
  readonly frameCount: number;
  readonly width: number;
  readonly height: number;
  readonly fps: { readonly numerator: number; readonly denominator: number };
  /** Composition duration when supplied; otherwise derived from frameCount and fps. */
  readonly durationSeconds: number;
  /** The warnings the captured frames carried (`seek.uncontrolled`, `layout.*`), in frame
   * order and unchanged. A successful encode is still a successful render, and the CLI's
   * envelope reports them: the mp4 route must not drop what the frames route forwards.
   */
  readonly diagnostics: readonly Diagnostic[];
};

/** Several Diagnostics without a second result type; cancellation aborts instead. */
export type EncodeOutcome =
  | Result<EncodeReceipt, readonly Diagnostic[]>
  | { readonly ok: false; readonly aborted: true };

export type Encoder = {
  encode: (request: EncodeRequest) => Promise<EncodeOutcome>;
};

/** A finished probe is a `Result`; a cancelled one is aborted control flow, not a Diagnostic. */
export type EncodeProbeOutcome = Result<Encoder> | { readonly ok: false; readonly aborted: true };

/** Probes PATH once per invocation; its Result is how a missing or too-old binary reports. */
export type FfmpegEncoderOptions = {
  readonly ffmpegPath?: string;
  /** The `ffprobe` that measures a declared track's channel count; the encoder's own sibling by
   * default. It is part of the same FFmpeg install, so a caller rarely needs to name it.
   */
  readonly ffprobePath?: string;
  /** Cancels the probe's children; the probe then returns `{ ok: false, aborted: true }`. */
  readonly signal?: AbortSignal;
};
