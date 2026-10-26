import { closeSync, openSync, statSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';

import {
  addTime,
  frameToTime,
  subtractTime,
  toSeconds,
  type FrameRate,
} from '../../core/timeline/time.ts';
import { type AudioTrack } from '../../lib/loading-protocol.ts';
import { type Result } from '../../lib/result.ts';
import { audioFileMissingDiagnostic } from './diagnostics.ts';

/**
 * The mixed audio's sample rate. Every track is resampled to it, so an input's own rate never
 * reaches the AAC stream; 48 kHz is the usual AAC-in-MP4 target (audio muxing ADR).
 */
export const AUDIO_SAMPLE_RATE = 48_000;
/** Stereo AAC at 192 kbit/s: transparent for narration and music at this sample rate. */
export const AUDIO_BITRATE = '192k';

/** A declaration with its path resolved and its frame times converted once, by the Time Module. */
export type ResolvedAudioTrack = {
  /** Absolute path passed to `-i`; already known to name a readable file. */
  readonly source: string;
  /** Timeline placement for `adelay`; frame-derived seconds in integer milliseconds. */
  readonly startMs: number;
  /** `atrim` start, relative to the source file. */
  readonly offsetSeconds: number;
  /** `atrim` end, relative to the source file; `undefined` plays to the natural end. */
  readonly endSeconds: number | undefined;
  /** Linear gain for `volume`; one is unchanged. */
  readonly volume: number;
  /**
   * What `ffprobe` reported for the source, attached by `withChannelCounts`. `undefined` means
   * the probe could not tell, so the graph falls back to the layout-agnostic conversion.
   */
  readonly channels: number | undefined;
};

/**
 * The one fact the graph needs from the source file. `ffprobe` prints the channel count alone:
 * `csv=p=0` has no header and no field names, so nothing but the number is parsed.
 */
export const audioChannelProbeArguments = (source: string): readonly string[] => [
  '-v',
  'error',
  '-select_streams',
  'a:0',
  '-show_entries',
  'stream=channels',
  '-of',
  'csv=p=0',
  source,
];

/** A positive integer is a channel count; empty or garbage output is "unknown", not a guess. */
export const parseChannelCount = (stdout: string): number | undefined => {
  const value = Number.parseInt(stdout.trim(), 10);
  return Number.isSafeInteger(value) && value > 0 ? value : undefined;
};

/** The probe result for each track, aligned by index with `resolveAudioTracks`' order. */
export const withChannelCounts = (
  tracks: readonly ResolvedAudioTrack[],
  channels: readonly (number | undefined)[],
): readonly ResolvedAudioTrack[] =>
  tracks.map((track, index) => ({ ...track, channels: channels[index] }));

/** Frame-derived seconds, exactly once per value: the Time Module owns the conversion. */
const secondsOf = (frame: number | undefined, rate: FrameRate): number =>
  toSeconds(frameToTime(BigInt(frame ?? 0), rate));

/** Fixed six-decimal seconds, so FFmpeg's own parsing cannot round differently per value. */
const secondsText = (seconds: number): string => seconds.toFixed(6);

/**
 * A regular file this process may read. `statSync` alone accepts a mode the process cannot open,
 * which FFmpeg would then reject after the first frame is piped; the open is what makes the
 * README's "not readable is `asset.load-failed`" true before any encode child runs.
 */
const isReadableFile = (source: string): boolean => {
  try {
    if (!statSync(source).isFile()) return false;
    closeSync(openSync(source, 'r'));
    return true;
  } catch {
    return false;
  }
};

/**
 * Resolves every declared track against the project root and converts its frame times.
 * A path that is not a readable file stops the encode before the child is spawned: no output,
 * `asset.load-failed` with the file in `location` (audio muxing ADR).
 */
export const resolveAudioTracks = (options: {
  readonly tracks: readonly AudioTrack[];
  readonly projectRoot: string;
  readonly rate: FrameRate;
}): Result<readonly ResolvedAudioTrack[]> => {
  const resolved: ResolvedAudioTrack[] = [];
  for (const track of options.tracks) {
    const source = isAbsolute(track.src) ? track.src : resolve(options.projectRoot, track.src);
    if (!isReadableFile(source)) return { ok: false, error: audioFileMissingDiagnostic(source) };
    const offset = frameToTime(BigInt(track.offsetInFrames ?? 0), options.rate);
    let endSeconds: number | undefined;
    if (track.endInFrames !== undefined) {
      // Play for exactly the declared timeline length, starting at the trim point.
      const start = frameToTime(BigInt(track.startInFrames ?? 0), options.rate);
      const end = frameToTime(BigInt(track.endInFrames), options.rate);
      endSeconds = toSeconds(addTime(offset, subtractTime(end, start)));
    }
    resolved.push({
      source,
      startMs: Math.round(secondsOf(track.startInFrames, options.rate) * 1000),
      offsetSeconds: toSeconds(offset),
      endSeconds,
      volume: track.volume ?? 1,
      channels: undefined,
    });
  }
  return { ok: true, value: resolved };
};

/** One `-i` per declared track, in declaration order; input index `i + 1` is track `i`. */
export const audioInputArguments = (tracks: readonly ResolvedAudioTrack[]): string[] =>
  tracks.flatMap((track) => ['-i', track.source]);

/**
 * The conversion to the mixed stream's 48 kHz stereo. A mono source is duplicated into both
 * channels at unity gain by `pan`: `aformat`'s automatic mono→stereo matrix is constant-power
 * (0.7071 per channel, −3.01 dB), which would make the same file render quieter as mono than as
 * stereo and silently change the balance between clips. Anything else (stereo, or a count the
 * probe could not report) keeps the layout-agnostic conversion, which is unity for stereo and
 * downmixes a wider layout.
 */
const channelGraph = (channels: number | undefined): string =>
  channels === 1
    ? 'aformat=sample_fmts=fltp,pan=stereo|c0=c0|c1=c0'
    : 'aformat=sample_fmts=fltp:channel_layouts=stereo';

/**
 * The filter graph that trims, gains, normalizes, places and sums every track. `normalize=0`
 * keeps each declared gain as authored; FFmpeg's default would divide them by the track count.
 * `apad` fills the tail so the output `-t` (frame-derived) decides where the audio ends.
 */
export const audioFilterGraph = (tracks: readonly ResolvedAudioTrack[]): string => {
  const chains = tracks.map((track, index) => {
    const trim =
      track.endSeconds === undefined
        ? `atrim=start=${secondsText(track.offsetSeconds)}`
        : `atrim=start=${secondsText(track.offsetSeconds)}:end=${secondsText(track.endSeconds)}`;
    const chain = [
      trim,
      'asetpts=PTS-STARTPTS',
      `volume=${String(track.volume)}`,
      `aresample=${String(AUDIO_SAMPLE_RATE)}`,
      channelGraph(track.channels),
      `adelay=${String(track.startMs)}:all=1`,
    ].join(',');
    return `[${String(index + 1)}:a]${chain}[a${String(index)}]`;
  });
  const mixed = tracks.map((_, index) => `[a${String(index)}]`).join('');
  return `${chains.join(';')};${mixed}amix=inputs=${String(tracks.length)}:duration=longest:normalize=0,apad[aout]`;
};

/** Output-side arguments: the graph, both maps, AAC stereo, and the exact output duration. */
export const audioOutputArguments = (
  tracks: readonly ResolvedAudioTrack[],
  durationSeconds: number,
): string[] => [
  '-filter_complex',
  audioFilterGraph(tracks),
  '-map',
  '0:v:0',
  '-map',
  '[aout]',
  '-c:a',
  'aac',
  '-b:a',
  AUDIO_BITRATE,
  '-ar',
  String(AUDIO_SAMPLE_RATE),
  // The Composition's exclusive end, from frameCount and fps: never a second duration source.
  '-t',
  secondsText(durationSeconds),
];
