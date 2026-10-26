import { statSync } from 'node:fs';
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
};

/** Frame-derived seconds, exactly once per value: the Time Module owns the conversion. */
const secondsOf = (frame: number | undefined, rate: FrameRate): number =>
  toSeconds(frameToTime(BigInt(frame ?? 0), rate));

/** Fixed six-decimal seconds, so FFmpeg's own parsing cannot round differently per value. */
const secondsText = (seconds: number): string => seconds.toFixed(6);

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
    let readable = false;
    try {
      readable = statSync(source).isFile();
    } catch {
      readable = false;
    }
    if (!readable) return { ok: false, error: audioFileMissingDiagnostic(source) };
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
    });
  }
  return { ok: true, value: resolved };
};

/** One `-i` per declared track, in declaration order; input index `i + 1` is track `i`. */
export const audioInputArguments = (tracks: readonly ResolvedAudioTrack[]): string[] =>
  tracks.flatMap((track) => ['-i', track.source]);

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
      'aformat=sample_fmts=fltp:channel_layouts=stereo',
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
