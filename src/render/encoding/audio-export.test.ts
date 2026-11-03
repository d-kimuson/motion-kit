import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { createFrameRate, type FrameRate } from '../../core/timeline/time.ts';
import { currentDate } from '../../lib/clock.ts';
import { type Diagnostic } from '../../lib/diagnostic.ts';
import { type AudioTrack } from '../../lib/loading-protocol.ts';
import { exportAudio, type AudioExportOutcome } from './audio-export.ts';

let directory: string;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'motion-kit-audio-export-'));
});
afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

/** The Composition rate the frame counts are converted with: 10 fps, so one frame is 100 ms. */
const rate = (): FrameRate => {
  const created = createFrameRate({ numerator: 10, denominator: 1 });
  if (!created.ok) throw new Error('the test frame rate must be valid');
  return created.value;
};

const errorsOf = (outcome: AudioExportOutcome): readonly Diagnostic[] => {
  if (outcome.ok || 'aborted' in outcome)
    throw new Error(`expected a failure, got ${JSON.stringify(outcome)}`);
  return outcome.error;
};

const pathsLeftBehind = (path: string): string[] =>
  readdirSync(path).filter((name) => name.endsWith('.part') || name.startsWith('.'));

/** The argv the stand-in binary saw, so the export's flag contract is pinned. */
const exportArgv = (): string[] => {
  const args = join(directory, 'export.args');
  if (!existsSync(args)) return [];
  return readFileSync(args, 'utf8')
    .trim()
    .split(' ')
    .filter((word) => word !== '');
};

/** Every role the stand-in binary was invoked in, in order. */
const invocations = (): string[] => {
  const log = join(directory, 'invocations.log');
  return existsSync(log)
    ? readFileSync(log, 'utf8')
        .split('\n')
        .filter((line) => line !== '')
    : [];
};

type StandInVariant = {
  /** The `-version` line; FFmpeg 6.0 is the supported floor. */
  readonly version?: string;
  /** What the export invocation does: write the file, fail, write nothing, or never finish. */
  readonly export?: 'ok' | 'fail' | 'empty' | 'stall';
};

/** The mixed stream's own metadata, so the WAV is checked as a file and not from the receipt. */
const ProbeOutputSchema = z.object({
  streams: z.array(z.record(z.string(), z.unknown())).min(1),
});

/**
 * A stand-in for FFmpeg's audio path. The real binary is exercised by the one case that generates
 * its own clips; every failure mode and the argument vector need no audio device or encoder.
 */
const standInFfmpeg = (variant: StandInVariant = {}): string => {
  const log = join(directory, 'invocations.log');
  const args = join(directory, 'export.args');
  const script = `#!/bin/sh
log="${log}"
args="${args}"
case "$1" in
  -version)
    echo version >> "$log"
    printf '%s\\n' "${variant.version ?? 'ffmpeg version 9.0.1 Copyright (c) 2000-2026 the FFmpeg developers'}"
    exit 0
    ;;
  -hide_banner)
    echo encoders >> "$log"
    exit 0
    ;;
esac
echo export >> "$log"
printf '%s\\n' "$*" > "$args"
last=""
for argument in "$@"; do last="$argument"; done
${
  variant.export === 'fail'
    ? 'printf \'%s\\n\' "boom: no such filter" >&2\nexit 1'
    : variant.export === 'empty'
      ? 'exit 0'
      : variant.export === 'stall'
        ? 'exec sleep 60'
        : `printf 'RIFFfake-wav-bytes' > "$last"`
}
`;
  const path = join(directory, 'ffmpeg');
  writeFileSync(path, script);
  chmodSync(path, 0o755);
  return path;
};

/**
 * A stand-in for `ffprobe`: it answers with `counts` in call order and records each argv, so the
 * channel count and the number of probes stay observable.
 */
const standInFfprobe = (...counts: readonly (number | 'fail')[]): string => {
  const args = join(directory, 'ffprobe.args');
  const queue = join(directory, 'ffprobe.counts');
  writeFileSync(queue, `${counts.map(String).join('\n')}\n`);
  const script = `#!/bin/sh
printf '%s\\n' "$*" >> "${args}"
count="$(head -n 1 "${queue}")"
tail -n +2 "${queue}" > "${queue}.next"
mv "${queue}.next" "${queue}"
case "$count" in
  ''|fail) exit 1 ;;
  *) printf '%s\\n' "$count" ;;
esac
`;
  const path = join(directory, 'ffprobe');
  writeFileSync(path, script);
  chmodSync(path, 0o755);
  return path;
};

/** The argv of every `ffprobe` call, one line per probed track in declaration order. */
const ffprobeArgv = (): string[] => {
  const args = join(directory, 'ffprobe.args');
  return existsSync(args)
    ? readFileSync(args, 'utf8')
        .split('\n')
        .filter((line) => line !== '')
    : [];
};

/** Readable stand-ins for the sources: the exporter only stats and opens them. */
const audioFixture = (): { readonly first: string; readonly second: string } => {
  const source = join(directory, 'audio');
  mkdirSync(source);
  const first = join(source, 'clip-1.wav');
  const second = join(source, 'clip-2.wav');
  writeFileSync(first, 'RIFF');
  writeFileSync(second, 'RIFF');
  return { first, second };
};

const outputPath = (name = 'out.wav'): string => join(directory, name);

const exportRequest = (options: {
  readonly audio: readonly AudioTrack[];
  readonly output?: string;
  readonly from?: number;
  readonly to?: number;
  readonly durationSeconds?: number;
  readonly signal?: AbortSignal;
  readonly ffmpegPath: string;
  readonly ffprobePath?: string;
}) => ({
  compositionId: 'audio',
  audio: options.audio,
  projectRoot: directory,
  rate: rate(),
  range: { from: options.from ?? 0, to: options.to ?? 3 },
  durationSeconds: options.durationSeconds ?? 0.3,
  output: options.output ?? outputPath(),
  ffmpegPath: options.ffmpegPath,
  ...(options.ffprobePath === undefined ? {} : { ffprobePath: options.ffprobePath }),
  ...(options.signal === undefined ? {} : { signal: options.signal }),
});

/** Polls a fact the stand-in records; a child has no other progress signal. */
const waitFor = async (ready: () => boolean, timeoutMs: number): Promise<void> => {
  const started = currentDate().getTime();
  while (!ready()) {
    if (currentDate().getTime() - started > timeoutMs)
      throw new Error('timed out waiting for the child');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};

describe('exportAudio', () => {
  it('mixes the declared tracks into the target with no video input at all', async () => {
    const ffmpeg = standInFfmpeg();
    standInFfprobe(2, 1);
    audioFixture();
    const output = outputPath();
    const outcome = await exportAudio(
      exportRequest({
        audio: [
          { src: 'audio/clip-1.wav', startInFrames: 5 },
          {
            src: 'audio/clip-2.wav',
            startInFrames: 15,
            endInFrames: 25,
            offsetInFrames: 10,
            volume: 0.5,
          },
        ],
        ffmpegPath: ffmpeg,
        ffprobePath: join(directory, 'ffprobe'),
        // Three seconds of artifact: both declared clips fall inside it.
        from: 0,
        to: 30,
        durationSeconds: 1.1,
      }),
    );
    expect(outcome).toMatchObject({
      ok: true,
      value: {
        output,
        sampleRate: 48_000,
        channels: 2,
        bitDepth: 16,
        durationSeconds: 1.1,
        trackCount: 2,
      },
    });
    // No `-i pipe:0`, no video codec, no `-map 0:v:0`: the artifact is audio alone, so track `i`
    // is input `i` and the graph the encoder mixes the MP4's audio with is reused unchanged.
    const graph = [
      '[0:a]atrim=start=0.000000,asetpts=PTS-STARTPTS,volume=1,aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,adelay=500:all=1[a0]',
      '[1:a]atrim=start=1.000000:end=2.000000,asetpts=PTS-STARTPTS,volume=0.5,aresample=48000,aformat=sample_fmts=fltp,pan=stereo|c0=c0|c1=c0,adelay=1500:all=1[a1]',
      '[a0][a1]amix=inputs=2:duration=longest:normalize=0,asetpts=N/SR/TB,apad=whole_dur=1.100000,atrim=end=1.100000[aout]',
    ].join(';');
    expect(exportArgv()).toEqual([
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      join(directory, 'audio', 'clip-1.wav'),
      '-i',
      join(directory, 'audio', 'clip-2.wav'),
      '-filter_complex',
      graph,
      '-map',
      '[aout]',
      '-c:a',
      'pcm_s16le',
      '-ar',
      '48000',
      '-ac',
      '2',
      expect.stringMatching(/\/\.out\.[0-9a-f-]{36}\.part\.wav$/u),
    ]);
    // The temporary sibling is renamed onto the target; nothing else is left behind.
    expect(readFileSync(output, 'utf8')).toBe('RIFFfake-wav-bytes');
    expect(pathsLeftBehind(directory)).toEqual([]);
    expect(invocations()).toEqual(['version', 'export']);
  }, 60_000);

  it('does not need libx264, because the export encodes no video', async () => {
    const ffmpeg = standInFfmpeg();
    standInFfprobe(2);
    audioFixture();
    const outcome = await exportAudio(
      exportRequest({
        audio: [{ src: 'audio/clip-1.wav' }],
        ffmpegPath: ffmpeg,
        ffprobePath: join(directory, 'ffprobe'),
      }),
    );
    expect(outcome).toMatchObject({ ok: true });
    // The video encoder list is what the MP4 route needs; the audio route never asks for it.
    expect(invocations()).toEqual(['version', 'export']);
  }, 60_000);

  it('reports a Composition without declared audio as render.no-audio and spawns nothing', async () => {
    const ffmpeg = standInFfmpeg();
    const output = outputPath();
    const outcome = await exportAudio(exportRequest({ audio: [], output, ffmpegPath: ffmpeg }));
    expect(errorsOf(outcome)).toMatchObject([
      {
        code: 'render.no-audio',
        severity: 'error',
        location: { compositionId: 'audio' },
      },
    ]);
    expect(invocations()).toEqual([]);
    expect(existsSync(output)).toBe(false);
  }, 60_000);

  it('reports an unreadable src as asset.load-failed before any child or sibling exists', async () => {
    const ffmpeg = standInFfmpeg();
    const outcome = await exportAudio(
      exportRequest({
        audio: [{ src: 'audio/absent.wav' }],
        ffmpegPath: ffmpeg,
        ffprobePath: join(directory, 'ffprobe'),
      }),
    );
    expect(errorsOf(outcome)).toMatchObject([
      {
        code: 'asset.load-failed',
        location: { file: join(directory, 'audio', 'absent.wav') },
        details: {
          assets: [
            { kind: 'audio', source: join(directory, 'audio', 'absent.wav'), phase: 'open' },
          ],
        },
      },
    ]);
    expect(invocations()).not.toContain('export');
    expect(pathsLeftBehind(directory)).toEqual([]);
  }, 60_000);

  it('creates the destination directory only when the mix is going to be written', async () => {
    const ffmpeg = standInFfmpeg();
    audioFixture();
    // No declared audio: the failure is reported and the file system is untouched, so a caller
    // that fixes the Composition does not find a directory its failed run left behind.
    const silentOutput = join(directory, 'nested-silent', 'mix.wav');
    const silent = await exportAudio(
      exportRequest({ audio: [], output: silentOutput, ffmpegPath: ffmpeg }),
    );
    expect(errorsOf(silent)).toMatchObject([{ code: 'render.no-audio' }]);
    expect(existsSync(dirname(silentOutput))).toBe(false);

    // An unreadable src is the same: an export that cannot run creates nothing.
    const missingOutput = join(directory, 'nested-missing', 'mix.wav');
    const missing = await exportAudio(
      exportRequest({
        audio: [{ src: 'audio/absent.wav' }],
        output: missingOutput,
        ffmpegPath: ffmpeg,
        ffprobePath: join(directory, 'ffprobe'),
      }),
    );
    expect(errorsOf(missing)).toMatchObject([{ code: 'asset.load-failed' }]);
    expect(existsSync(dirname(missingOutput))).toBe(false);

    // A mix that runs creates the directory its target needs.
    standInFfprobe(2);
    const output = join(directory, 'nested-ok', 'mix.wav');
    const written = await exportAudio(
      exportRequest({
        audio: [{ src: 'audio/clip-1.wav' }],
        output,
        ffmpegPath: ffmpeg,
        ffprobePath: join(directory, 'ffprobe'),
      }),
    );
    expect(written).toMatchObject({ ok: true, value: { output } });
    expect(existsSync(output)).toBe(true);
  }, 60_000);

  it('reports a missing binary as encode.ffmpeg-not-found and an old one as unsupported', async () => {
    audioFixture();
    const missing = await exportAudio(
      exportRequest({
        audio: [{ src: 'audio/clip-1.wav' }],
        ffmpegPath: join(directory, 'absent-ffmpeg'),
      }),
    );
    expect(errorsOf(missing)).toMatchObject([{ code: 'encode.ffmpeg-not-found' }]);

    const old = standInFfmpeg({ version: 'ffmpeg version 4.4.2 Copyright (c) 2000-2021' });
    const unsupported = await exportAudio(
      exportRequest({ audio: [{ src: 'audio/clip-1.wav' }], ffmpegPath: old }),
    );
    expect(errorsOf(unsupported)).toMatchObject([{ code: 'encode.ffmpeg-unsupported' }]);
    expect(invocations()).toEqual(['version']);
  }, 60_000);

  it('reports a refused child as encode.ffmpeg-failed with its stderr tail', async () => {
    const ffmpeg = standInFfmpeg({ export: 'fail' });
    standInFfprobe(2);
    audioFixture();
    const outcome = await exportAudio(
      exportRequest({
        audio: [{ src: 'audio/clip-1.wav' }],
        ffmpegPath: ffmpeg,
        ffprobePath: join(directory, 'ffprobe'),
      }),
    );
    const errors = errorsOf(outcome);
    expect(errors).toMatchObject([{ code: 'encode.ffmpeg-failed', details: { exitCode: 1 } }]);
    expect(errors[0]?.details?.['stderrTail']).toEqual(expect.stringContaining('no such filter'));
    expect(pathsLeftBehind(directory)).toEqual([]);
    expect(existsSync(outputPath())).toBe(false);
  }, 60_000);

  it('reports a destination it cannot create as encode.output-invalid and spawns no child', async () => {
    const ffmpeg = standInFfmpeg();
    standInFfprobe(2);
    audioFixture();
    // A file where the target's directory belongs: the export cannot create the destination, so
    // it reports that observation and no child starts.
    const blocker = join(directory, 'blocker');
    writeFileSync(blocker, 'not a directory');
    const outcome = await exportAudio(
      exportRequest({
        audio: [{ src: 'audio/clip-1.wav' }],
        output: join(blocker, 'out.wav'),
        ffmpegPath: ffmpeg,
        ffprobePath: join(directory, 'ffprobe'),
      }),
    );
    expect(errorsOf(outcome)).toMatchObject([
      { code: 'encode.output-invalid', details: { reason: 'unwritable' } },
    ]);
    expect(invocations()).not.toContain('export');
  }, 60_000);

  it('reports a successful exit that wrote nothing as encode.output-invalid', async () => {
    const ffmpeg = standInFfmpeg({ export: 'empty' });
    standInFfprobe(2);
    audioFixture();
    const outcome = await exportAudio(
      exportRequest({
        audio: [{ src: 'audio/clip-1.wav' }],
        ffmpegPath: ffmpeg,
        ffprobePath: join(directory, 'ffprobe'),
      }),
    );
    expect(errorsOf(outcome)).toMatchObject([
      { code: 'encode.output-invalid', details: { reason: 'empty' } },
    ]);
    expect(pathsLeftBehind(directory)).toEqual([]);
  }, 60_000);

  it('clips the declared tracks against the range before mixing', async () => {
    const ffmpeg = standInFfmpeg();
    standInFfprobe(2);
    audioFixture();
    const outcome = await exportAudio(
      exportRequest({
        audio: [
          { src: 'audio/clip-1.wav', startInFrames: 0, offsetInFrames: 100, endInFrames: 40 },
          { src: 'audio/clip-2.wav', startInFrames: 80 },
        ],
        from: 10,
        to: 20,
        durationSeconds: 1,
        ffmpegPath: ffmpeg,
        ffprobePath: join(directory, 'ffprobe'),
      }),
    );
    expect(outcome).toMatchObject({ ok: true, value: { trackCount: 1 } });
    // The range enters the clip at timeline frame 10, so the source resumes at frame 110 and the
    // ten remaining frames of the clip (one second at 10 fps) end it at 12 s of source time: the
    // same clipping the MP4's audio gets from `clipAudioTracks`, not a second implementation.
    expect(exportArgv().join(' ')).toContain(
      '[0:a]atrim=start=11.000000:end=12.000000,asetpts=PTS-STARTPTS',
    );
    expect(exportArgv().join(' ')).toContain('adelay=0:all=1');
    expect(exportArgv()).not.toContain(join(directory, 'audio', 'clip-2.wav'));
    expect(ffprobeArgv()).toHaveLength(1);
  }, 60_000);

  it('emits one silent stream of the artifact duration when the range keeps no clip', async () => {
    const ffmpeg = standInFfmpeg();
    audioFixture();
    const outcome = await exportAudio(
      exportRequest({
        audio: [{ src: 'audio/clip-1.wav', startInFrames: 100 }],
        from: 0,
        to: 2,
        durationSeconds: 0.2,
        ffmpegPath: ffmpeg,
        ffprobePath: join(directory, 'ffprobe'),
      }),
    );
    expect(outcome).toMatchObject({ ok: true, value: { trackCount: 0 } });
    expect(exportArgv()).toEqual(
      expect.arrayContaining([
        '-filter_complex',
        'anullsrc=channel_layout=stereo:sample_rate=48000,atrim=end=0.200000[aout]',
        '-map',
        '[aout]',
        '-c:a',
        'pcm_s16le',
      ]),
    );
    // No kept track means no channel probe, exactly like the MP4 route.
    expect(ffprobeArgv()).toEqual([]);
  }, 60_000);

  it('returns aborted control flow and leaves no sibling when the caller cancels', async () => {
    const ffmpeg = standInFfmpeg({ export: 'stall' });
    standInFfprobe(2);
    audioFixture();
    const controller = new AbortController();
    const pending = exportAudio(
      exportRequest({
        audio: [{ src: 'audio/clip-1.wav' }],
        ffmpegPath: ffmpeg,
        ffprobePath: join(directory, 'ffprobe'),
        signal: controller.signal,
      }),
    );
    await waitFor(() => invocations().includes('export'), 20_000);
    controller.abort('SIGINT');
    expect(await pending).toEqual({ ok: false, aborted: true });
    expect(pathsLeftBehind(directory)).toEqual([]);
  }, 60_000);

  it('writes real 48 kHz stereo PCM of exactly the artifact duration', async () => {
    const source = join(directory, 'audio');
    mkdirSync(source);
    const clip = join(source, 'clip.wav');
    execFileSync('ffmpeg', [
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'lavfi',
      '-i',
      'aevalsrc=0.6*sin(2*PI*440*t):d=1:s=48000',
      '-c:a',
      'pcm_s16le',
      clip,
    ]);
    const output = outputPath();
    const outcome = await exportAudio({
      compositionId: 'audio',
      audio: [{ src: 'audio/clip.wav', startInFrames: 2 }],
      projectRoot: directory,
      rate: rate(),
      range: { from: 0, to: 5 },
      durationSeconds: 0.5,
      output,
    });
    expect(outcome).toMatchObject({ ok: true, value: { trackCount: 1 } });
    const probed = ProbeOutputSchema.parse(
      JSON.parse(
        execFileSync('ffprobe', [
          '-v',
          'error',
          '-select_streams',
          'a:0',
          '-show_entries',
          'stream=codec_name,sample_rate,channels,duration',
          '-of',
          'json',
          output,
        ]).toString(),
      ),
    );
    expect(probed.streams[0]).toMatchObject({
      codec_name: 'pcm_s16le',
      sample_rate: '48000',
      channels: 2,
    });
    // 0.5 s at 48 kHz is 24 000 samples; the graph's own atrim ends the stream there.
    expect(statSync(output).size).toBeGreaterThan(24_000 * 2 * 2);
    expect(statSync(output).size).toBeLessThan(24_000 * 2 * 2 + 1024);
  }, 60_000);
});
