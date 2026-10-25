import { type Diagnostic } from '../../lib/diagnostic.ts';
import { type Result } from '../../lib/result.ts';
import { type FrameCaptureResult } from '../capture/frame.ts';

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

export type EncodeRequest = {
  readonly frames: FrameStream;
  /** The Composition's rational rate; never a rounded float. */
  readonly fps: { readonly numerator: number; readonly denominator: number };
  /** The descriptor's `durationInFrames`: the total `frames` is expected to yield, and the
   * bound `EncodeProgress` and the receipt are measured against. Zero is legal (see Diagnostics).
   */
  readonly frameCount: number;
  /** Absolute path of the MP4 to produce. */
  readonly output: string;
  readonly signal?: AbortSignal;
  readonly onProgress?: (progress: EncodeProgress) => void;
  // TASK-171 adds the audio track here (`audioTracks?: ...`), on this same rational timebase.
  // TASK-159 implements no audio and only leaves the field's attachment point open.
};

export type EncodeReceipt = {
  readonly output: string;
  /** Equal to the request's `frameCount`; the encoder counts what it wrote. */
  readonly frameCount: number;
  readonly width: number;
  readonly height: number;
  readonly fps: { readonly numerator: number; readonly denominator: number };
  /** Derived by the Time Module from frameCount and fps. */
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
  /** Cancels the probe's children; the probe then returns `{ ok: false, aborted: true }`. */
  readonly signal?: AbortSignal;
};
