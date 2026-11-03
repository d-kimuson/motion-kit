import { spawn, type ChildProcess } from 'node:child_process';
import { renameSync, statSync } from 'node:fs';

import {
  createFrameRate,
  durationFromFrameCount,
  toSeconds,
  type FrameRate,
} from '../../core/timeline/time.ts';
import { type Diagnostic } from '../../lib/diagnostic.ts';
import { coverOnExit } from '../../lib/exit.ts';
import { type CaptureFormat, type FrameCaptureResult } from '../capture/frame.ts';
import {
  audioInputArguments,
  audioOutputArguments,
  resolveAudioTracks,
  withChannelCounts,
} from './audio.ts';
import {
  encoderInvariantDiagnostic,
  ffmpegFailedDiagnostic,
  ffmpegNotFoundDiagnostic,
  ffmpegUnsupportedDiagnostic,
  outputInvalidDiagnostic,
} from './diagnostics.ts';
import {
  type EncodeOutcome,
  type EncodeProbeOutcome,
  type EncodeReceipt,
  type EncodeRequest,
  type FfmpegEncoderOptions,
} from './encoder.ts';
import {
  MINIMUM_FFMPEG_VERSION,
  STDERR_TAIL_LIMIT,
  abortedOutcome,
  createSibling,
  ffprobeFor,
  isMissingBinary,
  probeFfmpegVersion,
  probeSourceChannels,
  redact,
  removeSibling,
  runProbe,
  terminate,
} from './process.ts';

/** The only H.264 encoder Phase 1 accepts; a build without it cannot produce MP4. */
export const REQUIRED_VIDEO_ENCODER = 'libx264';
/** Default libx264 quality when no bitrate or CRF is requested. */
export const DEFAULT_VIDEO_CRF = 28;
/** Chroma-subsampled output is what players decode; RGB is not a valid H.264 pixel format. */
const PIXEL_FORMAT = 'yuv420p';

/** Probes once per invocation: `-version` for a parseable version, `-encoders` for libx264. */
const probe = async (
  binary: string,
  signal?: AbortSignal,
): Promise<{ ok: true; value: undefined } | { ok: false; error: Diagnostic } | 'aborted'> => {
  const version = await probeFfmpegVersion(binary, signal);
  if (version === 'aborted') return 'aborted';
  if (!version.ok) return version;

  let encodersRun;
  try {
    encodersRun = await runProbe(binary, ['-hide_banner', '-encoders'], signal);
  } catch (error) {
    if (isMissingBinary(error)) return { ok: false, error: ffmpegNotFoundDiagnostic(binary) };
    throw error;
  }
  if (encodersRun === 'aborted') return 'aborted';
  // Only the encoder-name column counts: a description that mentions libx264 is not support.
  const hasH264 =
    encodersRun.code === 0 &&
    encodersRun.stdout
      .split('\n')
      .some((line) => line.trim().split(/\s+/u)[1] === REQUIRED_VIDEO_ENCODER);
  if (!hasH264)
    return {
      ok: false,
      error: ffmpegUnsupportedDiagnostic({
        found: version.value.version,
        required: MINIMUM_FFMPEG_VERSION,
        missing: [REQUIRED_VIDEO_ENCODER],
      }),
    };
  return { ok: true, value: undefined };
};

type FrameRead =
  | { readonly kind: 'element'; readonly element: FrameCaptureResult }
  | { readonly kind: 'end' };

type PumpResult = {
  readonly encodedFrames: number;
  readonly size: { readonly width: number; readonly height: number } | undefined;
  /** Why the handover stopped; `frames-end` is the only one that lets the child finish alone. */
  readonly stop: 'frames-end' | 'capture-failure' | 'aborted' | 'child-gone';
  readonly failure: readonly Diagnostic[] | undefined;
  /** Warnings from the frames handed over, so a successful encode can report them. */
  readonly diagnostics: readonly Diagnostic[];
};

/** FFmpeg's decoder for each capture encoding piped through `image2pipe`. */
const inputCodec: Readonly<Record<CaptureFormat['type'], string>> = { png: 'png', jpeg: 'mjpeg' };

/** mjpeg decodes to full-range `yuvj420p`, which `-pix_fmt` alone carries into the MP4 as
 * full range; scaling to the limited range gives the same output format a PNG input gets.
 */
const inputFilter = (request: EncodeRequest): readonly string[] => {
  const filters = [
    ...(request.imageFormat === 'jpeg' ? [`scale=out_range=tv,format=${PIXEL_FORMAT}`] : []),
    ...(request.resolution === undefined
      ? []
      : [`scale=${request.resolution.width}:${request.resolution.height}:flags=lanczos`]),
  ];
  return filters.length === 0 ? [] : ['-vf', filters.join(',')];
};

/** Hands the image stream to the child and stops at the first failed frame, abort, or over-long stream. */
const pump = async (options: {
  readonly child: ChildProcess;
  readonly request: EncodeRequest;
  readonly stop: Promise<'stop'>;
  readonly aborted: () => boolean;
}): Promise<PumpResult> => {
  const { child, request, stop, aborted } = options;
  const stdin = child.stdin;
  if (stdin === null)
    return {
      encodedFrames: 0,
      size: undefined,
      stop: 'child-gone',
      failure: undefined,
      diagnostics: [],
    };
  // A broken pipe is reported through the write callback; an unhandled 'error' would throw.
  stdin.on('error', () => {});
  const iterator = request.frames[Symbol.asyncIterator]();
  const imageFormat = request.imageFormat ?? 'png';
  const write = (image: Buffer): Promise<boolean> =>
    new Promise((resolve) => {
      stdin.write(image, (error) => resolve(error === undefined || error === null));
    });
  let encodedFrames = 0;
  let size: { width: number; height: number } | undefined;
  let failure: readonly Diagnostic[] | undefined;
  const diagnostics: Diagnostic[] = [];
  let stop_ = 'child-gone' as PumpResult['stop'];

  while (true) {
    if (aborted()) {
      stop_ = 'aborted';
      break;
    }
    const pending = iterator.next();
    // The pending read outlives an abort or a dead child; never let its rejection escape.
    pending.catch(() => {});
    const read = await Promise.race<FrameRead | 'stop'>([
      pending.then((result): FrameRead =>
        result.done === true ? { kind: 'end' } : { kind: 'element', element: result.value },
      ),
      stop,
    ]);
    if (read === 'stop') break;
    if (aborted()) {
      stop_ = 'aborted';
      break;
    }
    if (read.kind === 'end') {
      stop_ = 'frames-end';
      break;
    }
    const element = read.element;
    if (!element.ok) {
      // An aborted element is aborted control flow, exactly like a caller cancellation.
      if ('aborted' in element) {
        stop_ = 'aborted';
        break;
      }
      failure = element.error;
      stop_ = 'capture-failure';
      break;
    }
    const frame = element.value;
    if (size === undefined) size = { width: frame.width, height: frame.height };
    else if (frame.width !== size.width || frame.height !== size.height) {
      // The viewport is fixed for a mount; a differing frame is a contract violation.
      failure = [
        encoderInvariantDiagnostic(
          `Frame ${frame.frame} is ${frame.width}x${frame.height}, but the first frame was ${size.width}x${size.height}.`,
          'Render one Composition with a fixed viewport; a resolution change inside one mount is a bug.',
        ),
      ];
      stop_ = 'capture-failure';
      break;
    }
    if (frame.format !== imageFormat) {
      // The child was started with one decoder; a frame in another encoding would corrupt it.
      failure = [
        encoderInvariantDiagnostic(
          `Frame ${frame.frame} is ${frame.format}, but the encoder was asked for ${imageFormat}.`,
          'Capture every frame of one encode in the format its request names; a mix is a bug.',
        ),
      ];
      stop_ = 'capture-failure';
      break;
    }
    // A stalled reader must not swallow the abort: race the write against the same stop.
    const wrote = await Promise.race<boolean | 'stop'>([write(frame.image), stop]);
    if (wrote === 'stop') {
      stop_ = aborted() ? 'aborted' : 'child-gone';
      break;
    }
    if (!wrote) break;
    encodedFrames += 1;
    diagnostics.push(...frame.diagnostics);
    request.onProgress?.({ encodedFrames, frameCount: request.frameCount });
    if (encodedFrames >= request.frameCount) {
      stop_ = 'frames-end';
      break;
    }
  }
  void iterator.return?.().catch(() => {});
  if (stop_ === 'frames-end') stdin.end();
  return { encodedFrames, size, stop: stop_, failure, diagnostics };
};

/** The Time Module's own reading of the request: the rational rate and the exact duration. */
const timebaseOf = (request: EncodeRequest): { rate: FrameRate; seconds: number } | undefined => {
  const rate = createFrameRate(request.fps);
  if (!rate.ok) return undefined;
  const duration = durationFromFrameCount(BigInt(request.frameCount), rate.value);
  return duration.ok ? { rate: rate.value, seconds: toSeconds(duration.value) } : undefined;
};

/** The whole subprocess boundary: probe, pipe, rename. Nothing above it sees a child or an exception. */
const encodeWithFfmpeg = async (
  binary: string,
  probeBinary: string,
  request: EncodeRequest,
): Promise<EncodeOutcome> => {
  const { output, frameCount, signal } = request;
  if (
    (request.crf !== undefined &&
      (!Number.isSafeInteger(request.crf) || request.crf < 0 || request.crf > 51)) ||
    (request.videoBitrate !== undefined &&
      (!Number.isSafeInteger(request.videoBitrate) || request.videoBitrate <= 0)) ||
    (request.crf !== undefined && request.videoBitrate !== undefined) ||
    (request.resolution !== undefined &&
      ![request.resolution.width, request.resolution.height].every(
        (n) => Number.isSafeInteger(n) && n > 0 && n % 2 === 0,
      )) ||
    (request.preset !== undefined &&
      ![
        'ultrafast',
        'superfast',
        'veryfast',
        'faster',
        'fast',
        'medium',
        'slow',
        'slower',
        'veryslow',
      ].includes(request.preset))
  )
    return {
      ok: false,
      error: [
        encoderInvariantDiagnostic(
          'Invalid video encoding options.',
          'Use CRF 0–51 or a positive bitrate, and positive even output dimensions.',
        ),
      ],
    };
  // Zero is a legal frame count: decide from the request before anything is created.
  if (frameCount === 0)
    return { ok: false, error: [outputInvalidDiagnostic({ output, reason: 'no-frames' })] };
  if (signal?.aborted === true) return abortedOutcome;
  const timebase = timebaseOf(request);
  if (timebase === undefined)
    return {
      ok: false,
      error: [
        encoderInvariantDiagnostic(
          'The encoder received an unsatisfiable frame rate.',
          'Pass the Composition descriptor fps validated by the Time Module; report this as a bug.',
        ),
      ],
    };
  const sourceRate = createFrameRate(request.sourceFps ?? request.fps);
  if (!sourceRate.ok) return { ok: false, error: [sourceRate.error] };
  // The Composition's declarations, before any range clips them: an empty array is the silent
  // path, a nonempty one always muxes an audio stream (silence when the range keeps no clip).
  const declaredAudio = request.audio ?? [];
  // Resolved before the sibling exists, so a missing file leaves no temporary file and no child.
  const audio = resolveAudioTracks({
    tracks: declaredAudio,
    projectRoot: request.projectRoot ?? process.cwd(),
    rate: sourceRate.value,
    ...(request.audioRange === undefined ? {} : { range: request.audioRange }),
  });
  if (!audio.ok) return { ok: false, error: [audio.error] };
  // The channel counts decide the mono conversion; probed before the sibling for the same reason.
  const channels = await probeSourceChannels(
    probeBinary,
    audio.value.map((track) => track.source),
    signal,
  );
  if (channels === 'aborted') return abortedOutcome;
  if (!channels.ok) return { ok: false, error: [channels.error] };
  const tracks = withChannelCounts(audio.value, channels.value);

  const sibling = createSibling(output);
  if (!sibling.ok) return { ok: false, error: [sibling.error] };
  const temporary = sibling.value;
  const rateText = `${String(request.fps.numerator)}/${String(request.fps.denominator)}`;
  // Exactly TASK-159's vector when no audio is declared: nothing about the silent path changes.
  const argumentsList = [
    // FFmpeg cannot prompt while stdin is the frame pipe, so it would refuse the
    // temporary sibling it always finds; overwriting that file is safe, `output` never is.
    '-y',
    '-hide_banner',
    '-loglevel',
    'error',
    '-f',
    'image2pipe',
    '-framerate',
    rateText,
    '-c:v',
    inputCodec[request.imageFormat ?? 'png'],
    '-i',
    'pipe:0',
    ...audioInputArguments(tracks),
    '-c:v',
    REQUIRED_VIDEO_ENCODER,
    ...inputFilter(request),
    ...(request.videoBitrate === undefined
      ? ['-crf', String(request.crf ?? DEFAULT_VIDEO_CRF)]
      : []),
    ...(request.videoBitrate === undefined ? [] : ['-b:v', `${String(request.videoBitrate)}k`]),
    ...(request.preset === undefined ? [] : ['-preset', request.preset]),
    '-movflags',
    '+faststart',
    '-pix_fmt',
    PIXEL_FORMAT,
    '-r',
    rateText,
    ...(declaredAudio.length === 0
      ? []
      : audioOutputArguments(tracks, request.durationSeconds ?? timebase.seconds)),
    temporary,
  ];

  let child: ChildProcess;
  try {
    child = spawn(binary, argumentsList, { stdio: ['pipe', 'ignore', 'pipe'], shell: false });
  } catch {
    removeSibling(temporary);
    return { ok: false, error: [ffmpegNotFoundDiagnostic(binary)] };
  }

  // Cancellation below is asynchronous, and a library that exits the process from its own signal
  // handler ends it before this encode can finish. The child and its temporary file are exactly
  // what a caller of a cancelled run must not find afterwards, so both are dealt with
  // synchronously on the way out — `SIGKILL` there, because an exiting process cannot wait for
  // `SIGTERM` to be honoured (lib/exit.ts).
  const releaseCover = coverOnExit(() => {
    child.kill('SIGKILL');
    removeSibling(temporary);
  });

  let stderrTail = '';
  child.stderr?.setEncoding('utf8');
  child.stderr?.on('data', (chunk: string) => {
    stderrTail = (stderrTail + chunk).slice(-STDERR_TAIL_LIMIT);
  });
  let exitCode: number | null = null;
  let exitSignal: NodeJS.Signals | null = null;
  let spawnError: Error | undefined;
  let resolveClosed: () => void = () => {};
  const closed = new Promise<void>((resolve) => {
    resolveClosed = resolve;
  });
  child.once('error', (error) => {
    spawnError = error;
    resolveClosed();
  });
  child.once('close', (code, childSignal) => {
    exitCode = code;
    exitSignal = childSignal;
    resolveClosed();
  });
  const isAborted = (): boolean => signal?.aborted === true;
  let aborted = isAborted();
  let resolveStop: (value: 'stop') => void = () => {};
  const stopped = new Promise<'stop'>((resolve) => {
    resolveStop = resolve;
  });
  const onAbort = (): void => {
    aborted = true;
    resolveStop('stop');
  };
  signal?.addEventListener('abort', onAbort, { once: true });
  // A child that dies before the last frame would otherwise leave the pump waiting on a read.
  void closed.then(() => {
    resolveStop('stop');
  });

  const written = await pump({ child, request, stop: stopped, aborted: () => aborted });
  if (written.stop === 'frames-end') {
    // After the last frame the child is expected to finish alone, but a cancellation that
    // arrives during that wait must still kill it rather than outlive the command.
    await Promise.race([closed, stopped]);
    if (aborted) await terminate(child, closed);
  } else await terminate(child, closed);
  signal?.removeEventListener('abort', onAbort);
  // The child is gone and the rest of this function is synchronous, so an exit cannot strand it.
  releaseCover();

  const fail = (diagnostics: readonly Diagnostic[]): EncodeOutcome => {
    removeSibling(temporary);
    return { ok: false, error: diagnostics };
  };
  if (spawnError !== undefined && isMissingBinary(spawnError))
    return fail([ffmpegNotFoundDiagnostic(binary)]);
  // An aborted element is aborted control flow, exactly like a caller cancellation.
  if (aborted || written.stop === 'aborted') {
    removeSibling(temporary);
    return abortedOutcome;
  }
  if (written.failure !== undefined) return fail(written.failure);
  // A non-zero exit before any frame reached the child is "no frame ever reached the child",
  // not an FFmpeg failure: the reason is observable from the request, not from the exit.
  if (exitCode !== 0 && written.encodedFrames === 0)
    return fail([outputInvalidDiagnostic({ output, reason: 'no-frames' })]);
  if (exitCode !== 0 || exitSignal !== null) {
    // The child's own report is the only evidence of why it gave up after a frame.
    return fail([
      ffmpegFailedDiagnostic({
        exitCode,
        signal: exitSignal,
        stderrTail: redact(stderrTail),
      }),
    ]);
  }
  // A short stream is a violated invariant: `frameCount` is the descriptor's durationInFrames.
  if (written.encodedFrames < frameCount || written.size === undefined)
    return fail([
      encoderInvariantDiagnostic(
        `The frame stream ended after ${written.encodedFrames} of ${frameCount} frames.`,
        'Render the exact frame range the descriptor declares; report a short capture stream as a bug.',
      ),
    ]);
  let bytes: number;
  try {
    bytes = statSync(temporary).size;
  } catch {
    return fail([
      encoderInvariantDiagnostic(
        'The temporary encode target disappeared before it could be inspected.',
        'Report this as a bug: a successful encode must leave the file it created.',
      ),
    ]);
  }
  if (bytes === 0) return fail([outputInvalidDiagnostic({ output, reason: 'empty' })]);
  try {
    renameSync(temporary, output);
  } catch {
    // A child ran and wrote the sibling, so this is not the pre-spawn `unwritable` observation;
    // the destination refused the rename, and no frame-or-FFmpeg reason describes that.
    return fail([
      encoderInvariantDiagnostic(
        'The encoded file could not be moved onto the target path.',
        'Check that --out names a file path and not an existing directory; report it as a bug if it persists.',
      ),
    ]);
  }
  const receipt: EncodeReceipt = {
    output,
    frameCount,
    width: request.resolution?.width ?? written.size.width,
    height: request.resolution?.height ?? written.size.height,
    fps: request.fps,
    durationSeconds: request.durationSeconds ?? timebase.seconds,
    diagnostics: written.diagnostics,
  };
  return { ok: true, value: receipt };
};

/** Probes `ffmpeg` (or `ffmpegPath`) once and returns the port bound to that binary. */
export const createFfmpegEncoder = async (
  options: FfmpegEncoderOptions = {},
): Promise<EncodeProbeOutcome> => {
  const binary = options.ffmpegPath ?? 'ffmpeg';
  // The per-track channel probes only run when audio is declared; this is their binary.
  const probeBinary = options.ffprobePath ?? ffprobeFor(binary);
  const probed = await probe(binary, options.signal);
  if (probed === 'aborted') return abortedOutcome;
  if (!probed.ok) return probed;
  return {
    ok: true,
    value: {
      encode: (request) => encodeWithFfmpeg(binary, probeBinary, request),
    },
  };
};
