import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { closeSync, openSync, renameSync, rmSync, statSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';

import { createFrameRate, durationFromFrameCount, toSeconds } from '../../core/timeline/time.ts';
import { type Diagnostic } from '../../lib/diagnostic.ts';
import { type Result } from '../../lib/result.ts';
import { type FrameCaptureResult } from '../capture/frame.ts';
import {
  encoderInvariantDiagnostic,
  ffmpegFailedDiagnostic,
  ffmpegNotFoundDiagnostic,
  ffmpegUnsupportedDiagnostic,
  outputInvalidDiagnostic,
} from './diagnostics.ts';
import {
  type EncodeOutcome,
  type EncodeReceipt,
  type EncodeRequest,
  type Encoder,
  type FfmpegEncoderOptions,
} from './encoder.ts';

/** The supported floor (2023-02-27); raising it is a deliberate, tested change. */
export const MINIMUM_FFMPEG_VERSION = '6.0';
/** The only H.264 encoder Phase 1 accepts; a build without it cannot produce MP4. */
export const REQUIRED_VIDEO_ENCODER = 'libx264';
/** Bounded probe/stderr output; FFmpeg logs are unbounded and never belong whole in a Diagnostic. */
const STDERR_TAIL_LIMIT = 4096;
/** Bounded escalation for a child that ignores SIGTERM. */
const KILL_GRACE_MS = 2000;
/** Chroma-subsampled output is what players decode; RGB is not a valid H.264 pixel format. */
const PIXEL_FORMAT = 'yuv420p';

const abortedOutcome = { ok: false, aborted: true } as const;

/** Secrets can reach FFmpeg's log through a URL; a Diagnostic never carries them. */
const redact = (text: string): string =>
  text.replace(/([a-z][a-z0-9+.-]*:\/\/)[^/\s@]+@/giu, '$1***@');

type ProcessRun = {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: string;
  readonly stderr: string;
};

/** One probe child: no stdin, bounded output, no shell, converted to a value at this boundary. */
const runProbe = (binary: string, args: readonly string[]): Promise<ProcessRun> =>
  new Promise((resolve, reject) => {
    const child = spawn(binary, [...args], { stdio: ['ignore', 'pipe', 'pipe'], shell: false });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout = (stdout + chunk).slice(-STDERR_TAIL_LIMIT * 8);
    });
    child.stderr.on('data', (chunk: string) => {
      stderr = (stderr + chunk).slice(-STDERR_TAIL_LIMIT);
    });
    child.on('error', reject);
    child.on('close', (code, signal) => {
      resolve({ code, signal, stdout, stderr: redact(stderr) });
    });
  });

/** A binary that cannot be found or executed is a Diagnostic, never a raw exception. */
const isMissingBinary = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  (error.code === 'ENOENT' || error.code === 'EACCES' || error.code === 'EPERM');

const parseVersion = (stdout: string): { version: string; numeric: string } | undefined => {
  const firstLine = stdout.split('\n')[0] ?? '';
  const token = /^ffmpeg version (\S+)/u.exec(firstLine)?.[1];
  if (token === undefined) return undefined;
  // Vendored builds carry suffixes such as `6.1.1-1ubuntu1` or `n7.0`; compare the numeric head.
  const numeric = /\d+(?:\.\d+){0,2}/u.exec(token)?.[0];
  return { version: token, numeric: numeric ?? '' };
};

const compareVersions = (left: string, right: string): number => {
  const parse = (value: string): number[] =>
    value.split('.').map((part) => Number.parseInt(part, 10) || 0);
  const a = parse(left);
  const b = parse(right);
  for (let index = 0; index < Math.max(a.length, b.length); index++) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
};

/** Probes once per invocation: `-version` for a parseable version, `-encoders` for libx264. */
const probe = async (binary: string): Promise<Result<undefined>> => {
  let versionRun: ProcessRun;
  try {
    versionRun = await runProbe(binary, ['-version']);
  } catch (error) {
    if (isMissingBinary(error)) return { ok: false, error: ffmpegNotFoundDiagnostic(binary) };
    throw error;
  }
  // A `-version` that does not exit 0 means the binary is present but not runnable.
  if (versionRun.code !== 0) return { ok: false, error: ffmpegNotFoundDiagnostic(binary) };
  const parsed = parseVersion(versionRun.stdout);
  if (parsed === undefined)
    return {
      ok: false,
      error: ffmpegUnsupportedDiagnostic({
        found: 'unknown',
        required: MINIMUM_FFMPEG_VERSION,
        missing: [],
      }),
    };

  let encodersRun: ProcessRun;
  try {
    encodersRun = await runProbe(binary, ['-hide_banner', '-encoders']);
  } catch (error) {
    if (isMissingBinary(error)) return { ok: false, error: ffmpegNotFoundDiagnostic(binary) };
    throw error;
  }
  // Only the encoder-name column counts: a description that mentions libx264 is not support.
  const hasH264 =
    encodersRun.code === 0 &&
    encodersRun.stdout
      .split('\n')
      .some((line) => line.trim().split(/\s+/u)[1] === REQUIRED_VIDEO_ENCODER);
  const tooOld =
    parsed.numeric === '' || compareVersions(parsed.numeric, MINIMUM_FFMPEG_VERSION) < 0;
  if (tooOld || !hasH264)
    return {
      ok: false,
      error: ffmpegUnsupportedDiagnostic({
        found: parsed.version,
        required: MINIMUM_FFMPEG_VERSION,
        missing: hasH264 ? [] : [REQUIRED_VIDEO_ENCODER],
      }),
    };
  return { ok: true, value: undefined };
};

const createSibling = (output: string): Result<string> => {
  // FFmpeg picks the muxer from the extension, so the sibling keeps the target's extension
  // while its name stays unique and its `.` prefix keeps it out of a directory listing's way.
  const extension = extname(output);
  const name = `${basename(output, extension)}.${randomUUID()}.part${extension}`;
  const path = join(dirname(output), `.${name}`);
  try {
    // An exclusive create is what makes an existing file unreachable and a directory that
    // cannot take the sibling fail before FFmpeg runs.
    closeSync(openSync(path, 'wx'));
    return { ok: true, value: path };
  } catch {
    return { ok: false, error: outputInvalidDiagnostic({ output, reason: 'unwritable' }) };
  }
};

const removeSibling = (path: string): void => {
  try {
    rmSync(path, { force: true });
  } catch {
    /* Nothing better can be reported than the failure that asked for the removal. */
  }
};

/** SIGTERM, then SIGKILL after a bounded grace, and resolve when the child is gone. */
const terminate = (child: ChildProcess, closed: Promise<void>): Promise<void> => {
  if (child.exitCode !== null || child.signalCode !== null) return closed;
  child.kill('SIGTERM');
  const timer = setTimeout(() => {
    child.kill('SIGKILL');
  }, KILL_GRACE_MS);
  timer.unref();
  return closed.then(() => {
    clearTimeout(timer);
  });
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

/** Hands the PNG stream to the child and stops at the first failed frame, abort, or over-long stream. */
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
  const write = (png: Buffer): Promise<boolean> =>
    new Promise((resolve) => {
      stdin.write(png, (error) => resolve(error === undefined || error === null));
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
    if (!(await write(frame.png))) break;
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

const durationSecondsOf = (request: EncodeRequest): number | undefined => {
  const rate = createFrameRate(request.fps);
  if (!rate.ok) return undefined;
  const duration = durationFromFrameCount(BigInt(request.frameCount), rate.value);
  return duration.ok ? toSeconds(duration.value) : undefined;
};

/** The whole subprocess boundary: probe, pipe, rename. Nothing above it sees a child or an exception. */
const encodeWithFfmpeg = async (binary: string, request: EncodeRequest): Promise<EncodeOutcome> => {
  const { output, frameCount, signal } = request;
  // Zero is a legal frame count: decide from the request before anything is created.
  if (frameCount === 0)
    return { ok: false, error: [outputInvalidDiagnostic({ output, reason: 'no-frames' })] };
  if (signal?.aborted === true) return abortedOutcome;
  const seconds = durationSecondsOf(request);
  if (seconds === undefined)
    return {
      ok: false,
      error: [
        encoderInvariantDiagnostic(
          'The encoder received an unsatisfiable frame rate.',
          'Pass the Composition descriptor fps validated by the Time Module; report this as a bug.',
        ),
      ],
    };

  const sibling = createSibling(output);
  if (!sibling.ok) return { ok: false, error: [sibling.error] };
  const temporary = sibling.value;

  let child: ChildProcess;
  try {
    child = spawn(
      binary,
      [
        // FFmpeg cannot prompt while stdin is the frame pipe, so it would refuse the
        // temporary sibling it always finds; overwriting that file is safe, `output` never is.
        '-y',
        '-hide_banner',
        '-loglevel',
        'error',
        '-f',
        'image2pipe',
        '-framerate',
        `${request.fps.numerator}/${request.fps.denominator}`,
        '-c:v',
        'png',
        '-i',
        'pipe:0',
        '-c:v',
        REQUIRED_VIDEO_ENCODER,
        '-pix_fmt',
        PIXEL_FORMAT,
        '-r',
        `${request.fps.numerator}/${request.fps.denominator}`,
        temporary,
      ],
      { stdio: ['pipe', 'ignore', 'pipe'], shell: false },
    );
  } catch {
    removeSibling(temporary);
    return { ok: false, error: [ffmpegNotFoundDiagnostic(binary)] };
  }

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
  signal?.removeEventListener('abort', onAbort);
  if (written.stop === 'frames-end') await closed;
  else await terminate(child, closed);

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
    // The destination directory refused the rename; the corrective action is writability.
    return fail([outputInvalidDiagnostic({ output, reason: 'unwritable' })]);
  }
  const receipt: EncodeReceipt = {
    output,
    frameCount,
    width: written.size.width,
    height: written.size.height,
    fps: request.fps,
    durationSeconds: seconds,
    diagnostics: written.diagnostics,
  };
  return { ok: true, value: receipt };
};

/** Probes `ffmpeg` (or `ffmpegPath`) once and returns the port bound to that binary. */
export const createFfmpegEncoder = async (
  options: FfmpegEncoderOptions = {},
): Promise<Result<Encoder>> => {
  const binary = options.ffmpegPath ?? 'ffmpeg';
  const probed = await probe(binary);
  if (!probed.ok) return probed;
  return {
    ok: true,
    value: {
      encode: (request) => encodeWithFfmpeg(binary, request),
    },
  };
};
