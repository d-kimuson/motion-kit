import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, renameSync, statSync } from 'node:fs';
import { dirname } from 'node:path';

import { type FrameRate } from '../../core/timeline/time.ts';
import { type Diagnostic } from '../../lib/diagnostic.ts';
import { coverOnExit } from '../../lib/exit.ts';
import { type AudioTrack } from '../../lib/loading-protocol.ts';
import { type Result } from '../../lib/result.ts';
import {
  AUDIO_EXPORT_BIT_DEPTH,
  AUDIO_EXPORT_CHANNELS,
  AUDIO_SAMPLE_RATE,
  audioInputArguments,
  audioOnlyOutputArguments,
  resolveAudioTracks,
  withChannelCounts,
} from './audio.ts';
import {
  encoderInvariantDiagnostic,
  ffmpegFailedDiagnostic,
  ffmpegNotFoundDiagnostic,
  noAudioDiagnostic,
  outputInvalidDiagnostic,
} from './diagnostics.ts';
import {
  STDERR_TAIL_LIMIT,
  abortedOutcome,
  createSibling,
  ffprobeFor,
  isMissingBinary,
  probeFfmpegVersion,
  probeSourceChannels,
  redact,
  removeSibling,
  terminate,
} from './process.ts';

/**
 * One audio-only export: the Composition's declared tracks mixed exactly as the MP4's audio is,
 * written to a WAV without capturing a frame. Times are frame counts, so the same Time Module
 * conversion and the same filter graph produce both artifacts (audio export ADR).
 */
export type AudioExportRequest = {
  /** The mounted Composition's id, for the Diagnostic a silent Composition reports. */
  readonly compositionId: string;
  /** The declared clips, in declaration order. Absent or empty is the failure, not silence. */
  readonly audio: readonly AudioTrack[];
  /** Directory a relative `src` resolves against; absolute sources are used as given. */
  readonly projectRoot: string;
  /** The Composition's frame rate: the one frame→second conversion both artifacts share. */
  readonly rate: FrameRate;
  /** Global frames the artifact covers, or `undefined` for the whole Composition. */
  readonly range: { readonly from: number; readonly to: number } | undefined;
  /** The artifact's duration, from the Time Module: the final `atrim` ends the mix there. */
  readonly durationSeconds: number;
  /** Absolute path of the WAV to produce. */
  readonly output: string;
  readonly signal?: AbortSignal;
  /** The FFmpeg to run; `PATH`'s `ffmpeg` when omitted. */
  readonly ffmpegPath?: string;
  /** The `ffprobe` that measures each track's channel count; FFmpeg's own sibling by default. */
  readonly ffprobePath?: string;
};

export type AudioExportReceipt = {
  readonly output: string;
  readonly sampleRate: number;
  readonly channels: number;
  readonly bitDepth: number;
  readonly durationSeconds: number;
  /** Clips the range kept and the graph mixed; zero means the artifact is silence. */
  readonly trackCount: number;
};

/** Several Diagnostics without a second result type; cancellation aborts instead. */
export type AudioExportOutcome =
  | Result<AudioExportReceipt, readonly Diagnostic[]>
  | { readonly ok: false; readonly aborted: true };

/**
 * Probes the binary, resolves and clips the declared tracks, and runs one FFmpeg child that reads
 * no frame: the graph is the encoder's own, so the WAV and the MP4's audio cannot drift apart.
 * The target is written to a temporary sibling and renamed only on success, so no partial file
 * appears at `output` and a destination that refuses the sibling fails before the child runs.
 */
export const exportAudio = async (request: AudioExportRequest): Promise<AudioExportOutcome> => {
  const { output, signal } = request;
  // Re-read the signal through a call so a check after an await is not narrowed away.
  const cancelled = (): boolean => signal?.aborted === true;
  if (cancelled()) return abortedOutcome;
  // A Composition that declares nothing has no mix to export. Silence is not an answer to a
  // request for audio: it is the same file for every bug the caller is looking for.
  if (request.audio.length === 0)
    return { ok: false, error: [noAudioDiagnostic(request.compositionId)] };
  const binary = request.ffmpegPath ?? 'ffmpeg';
  // The export encodes no video, so only the version is required: a build without libx264 can
  // still write PCM (audio export ADR).
  const probed = await probeFfmpegVersion(binary, signal);
  if (probed === 'aborted') return abortedOutcome;
  if (!probed.ok) return { ok: false, error: [probed.error] };
  // Resolved before the sibling exists, so a missing file leaves no temporary file and no child.
  const resolved = resolveAudioTracks({
    tracks: request.audio,
    projectRoot: request.projectRoot,
    rate: request.rate,
    ...(request.range === undefined ? {} : { range: request.range }),
  });
  if (!resolved.ok) return { ok: false, error: [resolved.error] };
  // The channel counts decide the mono conversion, and they are the encoder's own probe: a mono
  // clip keeps its level here exactly as it does in the MP4.
  const channels = await probeSourceChannels(
    request.ffprobePath ?? ffprobeFor(binary),
    resolved.value.map((track) => track.source),
    signal,
  );
  if (channels === 'aborted') return abortedOutcome;
  if (!channels.ok) return { ok: false, error: [channels.error] };
  const tracks = withChannelCounts(resolved.value, channels.value);
  if (cancelled()) return abortedOutcome;

  // The destination directory is created only here, once there is a mix to write: a Composition
  // with no declared audio, or one whose `src` cannot be read, leaves the file system untouched.
  try {
    mkdirSync(dirname(output), { recursive: true });
  } catch {
    return { ok: false, error: [outputInvalidDiagnostic({ output, reason: 'unwritable' })] };
  }
  const sibling = createSibling(output);
  if (!sibling.ok) return { ok: false, error: [sibling.error] };
  const temporary = sibling.value;
  const argumentsList = [
    // FFmpeg cannot prompt without a terminal, so it would refuse the sibling it always finds;
    // overwriting that file is safe, `output` never is.
    '-y',
    '-hide_banner',
    '-loglevel',
    'error',
    ...audioInputArguments(tracks),
    ...audioOnlyOutputArguments(tracks, request.durationSeconds),
    temporary,
  ];

  let child: ChildProcess;
  try {
    child = spawn(binary, argumentsList, { stdio: ['ignore', 'ignore', 'pipe'], shell: false });
  } catch {
    removeSibling(temporary);
    return { ok: false, error: [ffmpegNotFoundDiagnostic(binary)] };
  }

  // A library that exits the process from its own signal handler ends the run before this export
  // can finish, so the child and its sibling are dealt with synchronously on the way out.
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
  let resolveStop: () => void = () => {};
  const stopped = new Promise<void>((resolve) => {
    resolveStop = resolve;
  });
  const onAbort = (): void => resolveStop();
  signal?.addEventListener('abort', onAbort, { once: true });
  await Promise.race([closed, stopped]);
  if (cancelled()) await terminate(child, closed);
  signal?.removeEventListener('abort', onAbort);
  releaseCover();

  const fail = (diagnostics: readonly Diagnostic[]): AudioExportOutcome => {
    removeSibling(temporary);
    return { ok: false, error: diagnostics };
  };
  if (spawnError !== undefined && isMissingBinary(spawnError))
    return fail([ffmpegNotFoundDiagnostic(binary)]);
  if (cancelled()) {
    removeSibling(temporary);
    return abortedOutcome;
  }
  if (exitCode !== 0 || exitSignal !== null) {
    // The child's own report is the only evidence of why it gave up.
    return fail([
      ffmpegFailedDiagnostic({ exitCode, signal: exitSignal, stderrTail: redact(stderrTail) }),
    ]);
  }
  let bytes: number;
  try {
    bytes = statSync(temporary).size;
  } catch {
    return fail([
      encoderInvariantDiagnostic(
        'The temporary audio target disappeared before it could be inspected.',
        'Report this as a bug: a successful export must leave the file it created.',
      ),
    ]);
  }
  if (bytes === 0) return fail([outputInvalidDiagnostic({ output, reason: 'empty' })]);
  try {
    renameSync(temporary, output);
  } catch {
    return fail([
      encoderInvariantDiagnostic(
        'The exported audio could not be moved onto the target path.',
        'Check that --out names a file path and not an existing directory; report it as a bug if it persists.',
      ),
    ]);
  }
  return {
    ok: true,
    value: {
      output,
      sampleRate: AUDIO_SAMPLE_RATE,
      channels: AUDIO_EXPORT_CHANNELS,
      bitDepth: AUDIO_EXPORT_BIT_DEPTH,
      durationSeconds: request.durationSeconds,
      trackCount: tracks.length,
    },
  };
};
