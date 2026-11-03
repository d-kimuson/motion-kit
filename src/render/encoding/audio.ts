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
/** The WAV export's sample format: 16-bit signed PCM, the shape every audio tool reads. */
export const AUDIO_EXPORT_CODEC = 'pcm_s16le';
export const AUDIO_EXPORT_BIT_DEPTH = 16;
/** The mixed stream's channel count, so an exported WAV and the MP4's audio have the same shape. */
export const AUDIO_EXPORT_CHANNELS = 2;

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
 * `asset.load-failed` with the file in `location` (audio muxing ADR). Every declared source is
 * validated even when `range` keeps none of it, so a ranged render reports a bad `src` exactly as
 * the whole-Composition render does.
 *
 * `range` re-expresses the tracks against the rendered interval: only what the range can play is
 * resolved, so a clip outside it adds no input. Omitted means the whole Composition, where every
 * declaration is an input exactly as before.
 */
export const resolveAudioTracks = (options: {
  readonly tracks: readonly AudioTrack[];
  readonly projectRoot: string;
  readonly rate: FrameRate;
  readonly range?: { readonly from: number; readonly to: number };
}): Result<readonly ResolvedAudioTrack[]> => {
  const resolved: ResolvedAudioTrack[] = [];
  for (const declared of options.tracks) {
    const source = isAbsolute(declared.src)
      ? declared.src
      : resolve(options.projectRoot, declared.src);
    if (!isReadableFile(source)) return { ok: false, error: audioFileMissingDiagnostic(source) };
    const track =
      options.range === undefined ? declared : clipAudioTracks([declared], options.range).at(0);
    if (track === undefined) continue;
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

/**
 * Re-expresses the Composition's declared tracks relative to a render range, so the encoder keeps
 * placing and trimming by frame counts and the Time Module stays the only frame→second converter.
 *
 * The range is `from` (inclusive) to `to` (exclusive) in Global Frames. A kept clip starts at its
 * own timeline start minus `from`, reads its source from where the range enters it, and ends where
 * the range leaves it; a clip with no declared end keeps playing to the source's natural end and
 * the graph's final `atrim` ends it at the range. A clip whose declared span does not overlap the
 * range is dropped, so the range keeps only the clips that can be heard in it.
 */
export const clipAudioTracks = (
  tracks: readonly AudioTrack[],
  range: { readonly from: number; readonly to: number },
): readonly AudioTrack[] => {
  const kept: AudioTrack[] = [];
  for (const track of tracks) {
    const start = track.startInFrames ?? 0;
    const offset = track.offsetInFrames ?? 0;
    const end = track.endInFrames;
    if (start >= range.to || (end !== undefined && end <= range.from)) continue;
    // Frames of this clip the range cut off its head; the source resumes after exactly those.
    const headCut = Math.max(0, range.from - start);
    kept.push({
      ...track,
      startInFrames: Math.max(start, range.from) - range.from,
      offsetInFrames: offset + headCut,
      ...(end === undefined ? {} : { endInFrames: Math.min(end, range.to) - range.from }),
    });
  }
  return kept;
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
 * Rebuild mixed timestamps from sample counts; amix can retain a short first input's end PTS.
 * Finite `apad` fills the tail and the final `atrim` ends audio at the Composition duration.
 *
 * `firstInputIndex` is the child input the first track arrives on: 1 when a video stream is input
 * 0 (the MP4 encode), 0 when the artifact is audio alone (the WAV export). The graph itself is the
 * same one, so both artifacts mix with one implementation (audio muxing ADR).
 */
export const audioFilterGraph = (
  tracks: readonly ResolvedAudioTrack[],
  durationSeconds: number,
  firstInputIndex = 1,
): string => {
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
    return `[${String(index + firstInputIndex)}:a]${chain}[a${String(index)}]`;
  });
  const mixed = tracks.map((_, index) => `[a${String(index)}]`).join('');
  return `${chains.join(';')};${mixed}amix=inputs=${String(tracks.length)}:duration=longest:normalize=0,asetpts=N/SR/TB,apad=whole_dur=${secondsText(durationSeconds)},atrim=end=${secondsText(durationSeconds)}[aout]`;
};

/**
 * A silent stream of exactly `durationSeconds`. A Composition that declares audio keeps one audio
 * stream even when the rendered range contains none of its clips, so the artifact's stream layout
 * does not depend on where the range falls (audio muxing ADR).
 */
export const audioSilenceFilterGraph = (durationSeconds: number): string =>
  `anullsrc=channel_layout=stereo:sample_rate=${String(AUDIO_SAMPLE_RATE)},atrim=end=${secondsText(durationSeconds)}[aout]`;

/**
 * The interval the declared tracks are re-expressed against, or `undefined` for the whole
 * Composition. A range that covers the whole Composition is the whole-Composition render, so
 * nothing is clipped and a clip declared at or after the end stays an input as it always did; the
 * MP4 encode and the WAV export share this rule, so both artifacts hold the same audio.
 */
export const audioRangeFor = (options: {
  readonly range: { readonly from: number; readonly to: number } | undefined;
  readonly durationInFrames: number;
}): { readonly from: number; readonly to: number } | undefined =>
  options.range === undefined ||
  (options.range.from === 0 && options.range.to === options.durationInFrames)
    ? undefined
    : options.range;

/** Output-side arguments: the graph, both maps, AAC stereo, and the exact output duration. An empty
 * track list is the declared-but-all-outside case, which emits silence rather than no stream. */
export const audioOutputArguments = (
  tracks: readonly ResolvedAudioTrack[],
  durationSeconds: number,
): string[] => [
  '-filter_complex',
  tracks.length === 0
    ? audioSilenceFilterGraph(durationSeconds)
    : audioFilterGraph(tracks, durationSeconds),
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
];

/**
 * Output-side arguments for the WAV export: the same mix graph, mapped alone into 48 kHz stereo
 * PCM. There is no video stream, so the tracks are inputs 0..N-1 and `[aout]` is the only map. An
 * empty track list emits silence of the artifact duration, exactly as the MP4's audio does.
 */
export const audioOnlyOutputArguments = (
  tracks: readonly ResolvedAudioTrack[],
  durationSeconds: number,
): string[] => [
  '-filter_complex',
  tracks.length === 0
    ? audioSilenceFilterGraph(durationSeconds)
    : audioFilterGraph(tracks, durationSeconds, 0),
  '-map',
  '[aout]',
  '-c:a',
  AUDIO_EXPORT_CODEC,
  '-ar',
  String(AUDIO_SAMPLE_RATE),
  '-ac',
  String(AUDIO_EXPORT_CHANNELS),
];
