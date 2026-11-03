import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { closeSync, openSync, rmSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';

import { type Result } from '../../lib/result.ts';
import { audioChannelProbeArguments, parseChannelCount } from './audio.ts';
import {
  ffmpegNotFoundDiagnostic,
  ffmpegUnsupportedDiagnostic,
  outputInvalidDiagnostic,
} from './diagnostics.ts';

// The subprocess boundary shared by everything that runs FFmpeg: one probe shape, one temporary
// sibling, one bounded termination, one cancellation rule. The MP4 encoder and the WAV export both
// build on it, so neither owns a second way to start or stop a child.

/** The supported floor (2023-02-27); raising it is a deliberate, tested change. */
export const MINIMUM_FFMPEG_VERSION = '6.0';
/** Bounded probe/stderr output; FFmpeg logs are unbounded and never belong whole in a Diagnostic. */
export const STDERR_TAIL_LIMIT = 4096;
/** Bounded escalation for a child that ignores SIGTERM. */
export const KILL_GRACE_MS = 2000;

/** Cancellation is control flow, not a result: it carries no Diagnostic. */
export const abortedOutcome = { ok: false, aborted: true } as const;

/** Secrets can reach FFmpeg's log through a URL; a Diagnostic never carries them. */
export const redact = (text: string): string =>
  text.replace(/([a-z][a-z0-9+.-]*:\/\/)[^/\s@]+@/giu, '$1***@');

export type ProcessRun = {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: string;
  readonly stderr: string;
};

/** One probe child: no stdin, bounded output, no shell, converted to a value at this boundary. */
export const runProbe = (
  binary: string,
  args: readonly string[],
  signal?: AbortSignal,
): Promise<ProcessRun | 'aborted'> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted === true) {
      resolve('aborted');
      return;
    }
    const child = spawn(binary, [...args], { stdio: ['ignore', 'pipe', 'pipe'], shell: false });
    let stdout = '';
    let stderr = '';
    let killed = false;
    let killTimer: NodeJS.Timeout | undefined;
    const onAbort = (): void => {
      killed = true;
      child.kill('SIGTERM');
      killTimer = setTimeout(() => {
        child.kill('SIGKILL');
      }, KILL_GRACE_MS);
      killTimer.unref();
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    const settle = (): void => {
      signal?.removeEventListener('abort', onAbort);
      if (killTimer !== undefined) clearTimeout(killTimer);
    };
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout = (stdout + chunk).slice(-STDERR_TAIL_LIMIT * 8);
    });
    child.stderr.on('data', (chunk: string) => {
      stderr = (stderr + chunk).slice(-STDERR_TAIL_LIMIT);
    });
    child.on('error', (error) => {
      settle();
      reject(error);
    });
    child.on('close', (code, exitSignal) => {
      settle();
      if (killed) {
        resolve('aborted');
        return;
      }
      resolve({ code, signal: exitSignal, stdout, stderr: redact(stderr) });
    });
  });

/** A binary that cannot be found or executed is a Diagnostic, never a raw exception. */
export const isMissingBinary = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  (error.code === 'ENOENT' || error.code === 'EACCES' || error.code === 'EPERM');

export const parseVersion = (stdout: string): { version: string; numeric: string } | undefined => {
  const firstLine = stdout.split('\n')[0] ?? '';
  const token = /^ffmpeg version (\S+)/u.exec(firstLine)?.[1];
  if (token === undefined) return undefined;
  // Vendored builds carry suffixes such as `6.1.1-1ubuntu1` or `n7.0`; compare the numeric head.
  const numeric = /\d+(?:\.\d+){0,2}/u.exec(token)?.[0];
  return { version: token, numeric: numeric ?? '' };
};

export const compareVersions = (left: string, right: string): number => {
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

/**
 * `-version` alone: the version is what every FFmpeg path needs, and it is all an export that
 * encodes no video needs. A binary that cannot run, or a version that cannot be parsed, is a
 * Diagnostic; the caller decides which capabilities matter on top of that.
 */
export const probeFfmpegVersion = async (
  binary: string,
  signal?: AbortSignal,
): Promise<Result<{ readonly version: string; readonly numeric: string }> | 'aborted'> => {
  let versionRun: ProcessRun | 'aborted';
  try {
    versionRun = await runProbe(binary, ['-version'], signal);
  } catch (error) {
    if (isMissingBinary(error)) return { ok: false, error: ffmpegNotFoundDiagnostic(binary) };
    throw error;
  }
  if (versionRun === 'aborted') return 'aborted';
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
  if (parsed.numeric === '' || compareVersions(parsed.numeric, MINIMUM_FFMPEG_VERSION) < 0)
    return {
      ok: false,
      error: ffmpegUnsupportedDiagnostic({
        found: parsed.version,
        required: MINIMUM_FFMPEG_VERSION,
        missing: [],
      }),
    };
  return { ok: true, value: parsed };
};

/**
 * FFmpeg ships `ffprobe` next to `ffmpeg`; a bare name has no directory to borrow, so PATH
 * resolves it exactly the way it resolves the encoder. The channel count decides how a source is
 * converted to stereo (audio muxing ADR), which is why one probe runs per declared track.
 */
export const ffprobeFor = (ffmpegBinary: string): string => {
  const directory = dirname(ffmpegBinary);
  if (directory === '.' || directory === '') return 'ffprobe';
  return join(directory, process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe');
};

/** One probe per resolved track, in declaration order; a silent artifact probes nothing. */
export const probeSourceChannels = async (
  binary: string,
  sources: readonly string[],
  signal?: AbortSignal,
): Promise<Result<readonly (number | undefined)[]> | 'aborted'> => {
  const counts: (number | undefined)[] = [];
  for (const source of sources) {
    let run: ProcessRun | 'aborted';
    try {
      run = await runProbe(binary, audioChannelProbeArguments(source), signal);
    } catch (error) {
      // A missing or unrunnable ffprobe is part of the missing FFmpeg install, not a bad track.
      if (isMissingBinary(error)) return { ok: false, error: ffmpegNotFoundDiagnostic(binary) };
      throw error;
    }
    if (run === 'aborted') return 'aborted';
    // A file whose stream cannot be read reports no count: the mix fails later, as before.
    counts.push(run.code === 0 ? parseChannelCount(run.stdout) : undefined);
  }
  return { ok: true, value: counts };
};

/** The temporary sibling both artifacts are written to before they replace their target. */
export const createSibling = (output: string): Result<string> => {
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

export const removeSibling = (path: string): void => {
  try {
    rmSync(path, { force: true });
  } catch {
    /* Nothing better can be reported than the failure that asked for the removal. */
  }
};

/** SIGTERM, then SIGKILL after a bounded grace, and resolve when the child is gone. */
export const terminate = (child: ChildProcess, closed: Promise<void>): Promise<void> => {
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
