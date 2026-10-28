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
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { currentDate } from '../../lib/clock.ts';
import { type Diagnostic } from '../../lib/diagnostic.ts';
import { type AudioTrack } from '../../lib/loading-protocol.ts';
import { type FrameCaptureResult } from '../capture/frame.ts';
import {
  type EncodeOutcome,
  type EncodeProbeOutcome,
  type EncodeProgress,
  type Encoder,
} from './encoder.ts';
import { createFfmpegEncoder } from './ffmpeg.ts';

let directory: string;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'motion-kit-encoding-'));
});
afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
});

const pathsLeftBehind = (path: string): string[] =>
  readdirSync(path).filter((name) => name.endsWith('.part') || name.startsWith('.'));

/** Frames from a real FFmpeg fixture, as PNG (the default input) or JPEG bytes. */
const pngFrames = (count: number, extension: 'png' | 'jpg' = 'png'): Buffer[] => {
  const target = join(directory, `source-%04d.${extension}`);
  execFileSync('ffmpeg', [
    '-y',
    '-hide_banner',
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    `testsrc=size=64x64:rate=${count}:duration=1`,
    '-frames:v',
    String(count),
    target,
  ]);
  const names = readdirSync(directory)
    .filter((name) => name.startsWith('source-'))
    .sort();
  const pngs = names.map((name) => readFileSync(join(directory, name)));
  for (const name of names) rmSync(join(directory, name));
  return pngs;
};

const frameOf = (
  pngs: readonly Buffer[],
  index: number,
  size = { width: 64, height: 64 },
  format: 'png' | 'jpeg' = 'png',
): FrameCaptureResult => {
  const png = pngs[index];
  if (png === undefined) throw new Error(`frame ${String(index)} is missing`);
  return { ok: true, value: { frame: index, ...size, format, image: png, diagnostics: [] } };
};

/** A captured frame carrying warnings, which is what a Tier C Composition produces. */
const withDiagnostics = (
  frame: FrameCaptureResult,
  diagnostics: readonly Diagnostic[],
): FrameCaptureResult => {
  if (!frame.ok) throw new Error('expected a captured frame');
  return { ok: true, value: { ...frame.value, diagnostics } };
};

/** The Encoder port only needs async iteration; a frame list is the simplest scripted source. */
const asyncIterableOf = <T>(items: readonly T[]): AsyncIterable<T> => ({
  [Symbol.asyncIterator]: () => {
    const iterator = items[Symbol.iterator]();
    return { next: () => Promise.resolve(iterator.next()) };
  },
});

const streamOf = (
  pngs: readonly Buffer[],
  size = { width: 64, height: 64 },
): AsyncIterable<FrameCaptureResult> =>
  asyncIterableOf(pngs.map((_, index) => frameOf(pngs, index, size)));

type FakeVariant = {
  /** The first line `ffmpeg -version` prints; `undefined` prints nothing parseable. */
  readonly version?: string;
  /** Makes `-version` a child that never answers, so a probe cancellation is observable. */
  readonly versionStall?: boolean;
  /** Whether `-encoders` lists libx264. */
  readonly libx264?: boolean;
  /** What the encode invocation does after draining stdin. */
  readonly encode?: 'ok' | 'fail' | 'empty' | 'stall' | 'stall-after-eof';
};

/**
 * A stand-in for the binary, so the probe matrix and every post-probe failure is exercised
 * without a real FFmpeg build for each case. Each invocation appends its role to `log`.
 */
const fakeFfmpeg = (variant: FakeVariant): string => {
  const log = join(directory, 'invocations.log');
  const argv = join(directory, 'invocations.args');
  const pid = join(directory, 'encode.pid');
  const eof = join(directory, 'stdin.eof');
  const script = `#!/bin/sh
log="${log}"
argv="${argv}"
pid="${pid}"
eof="${eof}"
case "$1" in
  -version)
    echo version >> "$log"
    ${
      variant.versionStall === true
        ? 'exec sleep 60'
        : `${variant.version === undefined ? '' : `printf '%s\\n' "${variant.version}"`}
    exit 0`
    }
    ;;
  -hide_banner)
    echo encoders >> "$log"
    printf 'Encoders:\\n'
    ${variant.libx264 === false ? '' : `printf ' V....D libx264              libx264 H.264 / AVC\\n'`}
    exit 0
    ;;
esac
echo encode >> "$log"
printf '%s\\n' "$*" > "$argv"
printf '%s' "$$" > "$pid"
last=""
for argument in "$@"; do last="$argument"; done
${
  variant.encode === 'stall'
    ? // A reader that never drains stdin and never exits, so a write stays blocked.
      `exec sleep 60`
    : variant.encode === 'stall-after-eof'
      ? // Drains stdin to EOF, records it, then outlives the last frame the way a real
        // FFmpeg does while it finishes writing the file.
        `cat > /dev/null\nprintf 'eof' > "$eof"\nexec sleep 60`
      : 'cat > /dev/null'
}
${
  variant.encode === 'fail'
    ? `printf 'boom: the encoder exploded\\n' >&2\nexit 1`
    : variant.encode === 'empty'
      ? 'exit 0'
      : variant.encode === 'stall' || variant.encode === 'stall-after-eof'
        ? ''
        : `printf 'fake-mp4-bytes' > "$last"`
}
`;
  const path = join(directory, 'ffmpeg');
  writeFileSync(path, script);
  chmodSync(path, 0o755);
  return path;
};

const invocations = (): string[] => {
  const log = join(directory, 'invocations.log');
  return existsSync(log)
    ? readFileSync(log, 'utf8')
        .split('\n')
        .filter((line) => line !== '')
    : [];
};

/**
 * A stand-in for `ffprobe`, which is where a declared track's channel count comes from. It answers
 * with `counts` in call order (one per track, declaration order), records each argv, and exits
 * non-zero when the queue says `fail`. Both the count and the number of probes stay observable.
 */
const fakeFfprobe = (...counts: readonly (number | 'fail')[]): string => {
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

/** The argv of every `ffprobe` call, one line per track in declaration order. */
const ffprobeArgv = (): string[] => {
  const args = join(directory, 'ffprobe.args');
  return existsSync(args)
    ? readFileSync(args, 'utf8')
        .split('\n')
        .filter((line) => line !== '')
    : [];
};

/** The argv the stand-in binary saw on its encode invocation, so the flag contract is pinned. */
const encodeArgv = (): string[] => {
  const args = join(directory, 'invocations.args');
  if (!existsSync(args)) return [];
  return readFileSync(args, 'utf8')
    .trim()
    .split(' ')
    .filter((word) => word !== '');
};

const outputPath = (name = 'out.mp4'): string => join(directory, name);

/** The encode child's PID, recorded by the stand-in so an orphan child is observable. */
const encodePid = (): number => Number(readFileSync(join(directory, 'encode.pid'), 'utf8'));

const childGone = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return false;
  } catch {
    return true;
  }
};

/** Polls a fact the stand-in binary records; a child's progress has no other signal. */
const waitFor = async (ready: () => boolean, timeoutMs: number): Promise<void> => {
  const started = currentDate().getTime();
  while (!ready()) {
    if (currentDate().getTime() - started > timeoutMs)
      throw new Error('timed out waiting for the child');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};

const request = (options: {
  frames: AsyncIterable<FrameCaptureResult>;
  frameCount: number;
  output?: string;
  fps?: { numerator: number; denominator: number };
  signal?: AbortSignal;
  onProgress?: (progress: EncodeProgress) => void;
  audio?: readonly AudioTrack[];
  projectRoot?: string;
  imageFormat?: 'png' | 'jpeg';
}) => ({
  frames: options.frames,
  fps: options.fps ?? { numerator: 10, denominator: 1 },
  frameCount: options.frameCount,
  output: options.output ?? outputPath(),
  ...(options.signal === undefined ? {} : { signal: options.signal }),
  ...(options.onProgress === undefined ? {} : { onProgress: options.onProgress }),
  ...(options.audio === undefined ? {} : { audio: options.audio }),
  ...(options.projectRoot === undefined ? {} : { projectRoot: options.projectRoot }),
  ...(options.imageFormat === undefined ? {} : { imageFormat: options.imageFormat }),
});

const openEncoder = async (ffmpegPath: string): Promise<Encoder> => {
  const probed = await createFfmpegEncoder({ ffmpegPath });
  if (!probed.ok) throw new Error(`probe failed: ${JSON.stringify(probed)}`);
  return probed.value;
};

const errorsOf = (outcome: EncodeOutcome) => {
  if (outcome.ok || !('error' in outcome)) throw new Error('expected a diagnostic failure');
  return outcome.error;
};

const probeErrorsOf = (outcome: EncodeProbeOutcome) => {
  if (outcome.ok) throw new Error('expected a probe failure');
  if ('aborted' in outcome) throw new Error('expected a probe Diagnostic, not an abort');
  return outcome.error;
};

describe('createFfmpegEncoder probe', () => {
  it('reports a missing binary as encode.ffmpeg-not-found', async () => {
    const result = await createFfmpegEncoder({ ffmpegPath: join(directory, 'absent-ffmpeg') });
    expect(result.ok).toBe(false);
    expect(probeErrorsOf(result)).toMatchObject({
      code: 'encode.ffmpeg-not-found',
      severity: 'error',
      details: { binary: join(directory, 'absent-ffmpeg') },
    });
    expect(probeErrorsOf(result).hint).toBeTruthy();
  });

  it('reports a version below the floor as encode.ffmpeg-unsupported', async () => {
    const binary = fakeFfmpeg({
      version: 'ffmpeg version 4.4.2 Copyright (c) 2000-2021 the FFmpeg developers',
      encode: 'fail',
    });
    const result = await createFfmpegEncoder({ ffmpegPath: binary });
    expect(result.ok).toBe(false);
    expect(probeErrorsOf(result)).toMatchObject({
      code: 'encode.ffmpeg-unsupported',
      details: { found: '4.4.2', required: '6.0', missing: [] },
    });
  });

  it('reports a build without libx264 as encode.ffmpeg-unsupported', async () => {
    const binary = fakeFfmpeg({
      version: 'ffmpeg version 9.0.1 Copyright (c) 2000-2026 the FFmpeg developers',
      libx264: false,
    });
    const result = await createFfmpegEncoder({ ffmpegPath: binary });
    expect(result.ok).toBe(false);
    expect(probeErrorsOf(result)).toMatchObject({
      code: 'encode.ffmpeg-unsupported',
      details: { found: '9.0.1', required: '6.0', missing: ['libx264'] },
    });
  });

  it('reports an unparseable version line as encode.ffmpeg-unsupported', async () => {
    const binary = fakeFfmpeg({ encode: 'fail' });
    const result = await createFfmpegEncoder({ ffmpegPath: binary });
    expect(result.ok).toBe(false);
    expect(probeErrorsOf(result)).toMatchObject({ code: 'encode.ffmpeg-unsupported' });
  });

  it('ends a cancelled probe as aborted control flow, without a Diagnostic', async () => {
    const binary = fakeFfmpeg({ versionStall: true });
    const controller = new AbortController();
    const pending = createFfmpegEncoder({ ffmpegPath: binary, signal: controller.signal });
    // The child is inside `-version`; cancelling now is the probe's only way out.
    await waitFor(() => invocations().includes('version'), 10_000);
    controller.abort();
    expect(await pending).toEqual({ ok: false, aborted: true });
    // The probe stopped at `-version`; the cancel is not a licence to run `-encoders`.
    expect(invocations()).toEqual(['version']);
  }, 10_000);

  it('probes once per encoder and never re-probes for the frames it encodes', async () => {
    const binary = fakeFfmpeg({
      version: 'ffmpeg version 9.0.1 Copyright (c) 2000-2026 the FFmpeg developers',
    });
    const encoder = await openEncoder(binary);
    const outcome = await encoder.encode(
      request({ frames: streamOf(pngFrames(3)), frameCount: 3 }),
    );
    expect(outcome).toMatchObject({ ok: true });
    expect(invocations()).toEqual(['version', 'encoders', 'encode']);
  });
});

describe('FfmpegEncoder.encode', () => {
  it('writes an H.264 file and reports a receipt for the whole range', async () => {
    const pngs = pngFrames(10);
    const progress: EncodeProgress[] = [];
    const encoder = await openEncoder('ffmpeg');
    const output = outputPath();
    const outcome = await encoder.encode(
      request({
        frames: streamOf(pngs),
        frameCount: pngs.length,
        output,
        onProgress: (item) => progress.push(item),
      }),
    );
    expect(outcome).toMatchObject({
      ok: true,
      value: {
        output,
        frameCount: 10,
        width: 64,
        height: 64,
        fps: { numerator: 10, denominator: 1 },
        durationSeconds: 1,
      },
    });
    expect(existsSync(output)).toBe(true);
    expect(pathsLeftBehind(directory)).toEqual([]);
    expect(progress.map((item) => item.encodedFrames)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(progress.every((item) => item.frameCount === 10)).toBe(true);
    const probed = execFileSync('ffprobe', [
      '-v',
      'error',
      '-select_streams',
      'v:0',
      '-show_entries',
      'stream=codec_name,nb_frames',
      '-of',
      'default=noprint_wrappers=1',
      output,
    ]).toString();
    expect(probed).toContain('codec_name=h264');
    expect(probed).toContain('nb_frames=10');
  }, 60_000);

  it('encodes JPEG frames through the mjpeg input codec, in the limited range a PNG input gets', async () => {
    const jpegs = pngFrames(5, 'jpg');
    const encoder = await openEncoder('ffmpeg');
    const output = outputPath();
    const outcome = await encoder.encode(
      request({
        frames: asyncIterableOf(jpegs.map((_, index) => frameOf(jpegs, index, undefined, 'jpeg'))),
        frameCount: jpegs.length,
        output,
        imageFormat: 'jpeg',
      }),
    );
    expect(outcome).toMatchObject({ ok: true, value: { frameCount: 5, width: 64, height: 64 } });
    const probed = execFileSync('ffprobe', [
      '-v',
      'error',
      '-select_streams',
      'v:0',
      '-show_entries',
      'stream=codec_name,nb_frames,pix_fmt,color_range',
      '-of',
      'default=noprint_wrappers=1',
      output,
    ]).toString();
    expect(probed).toContain('codec_name=h264');
    expect(probed).toContain('nb_frames=5');
    // mjpeg decodes to full-range yuvj420p; the MP4 must not inherit it.
    expect(probed).toContain('pix_fmt=yuv420p\n');
    expect(probed).toContain('color_range=tv');
  }, 60_000);

  it('treats a frame in another format than the request names as internal.unexpected', async () => {
    const binary = fakeFfmpeg({
      version: 'ffmpeg version 9.0.1 Copyright (c) 2000-2026 the FFmpeg developers',
    });
    const encoder = await openEncoder(binary);
    const output = outputPath();
    const pngs = pngFrames(2);
    const outcome = await encoder.encode(
      request({ frames: streamOf(pngs), frameCount: 2, output, imageFormat: 'jpeg' }),
    );
    expect(errorsOf(outcome)[0]).toMatchObject({ code: 'internal.unexpected' });
    expect(existsSync(output)).toBe(false);
    expect(pathsLeftBehind(directory)).toEqual([]);
  });

  it('reports a non-zero exit after a frame as encode.ffmpeg-failed with the stderr tail', async () => {
    const binary = fakeFfmpeg({
      version: 'ffmpeg version 9.0.1 Copyright (c) 2000-2026 the FFmpeg developers',
      encode: 'fail',
    });
    const encoder = await openEncoder(binary);
    const output = outputPath();
    const outcome = await encoder.encode(
      request({ frames: streamOf(pngFrames(2)), frameCount: 2, output }),
    );
    const errors = errorsOf(outcome);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({
      code: 'encode.ffmpeg-failed',
      details: { exitCode: 1, signal: null },
    });
    const stderrTail = errors[0]?.details?.['stderrTail'];
    expect(
      typeof stderrTail === 'string' && stderrTail.includes('boom: the encoder exploded'),
    ).toBe(true);
    expect(existsSync(output)).toBe(false);
    expect(pathsLeftBehind(directory)).toEqual([]);
  });

  it('passes the rational rate to -framerate and -r and writes only the sibling', async () => {
    const binary = fakeFfmpeg({
      version: 'ffmpeg version 9.0.1 Copyright (c) 2000-2026 the FFmpeg developers',
    });
    const encoder = await openEncoder(binary);
    const output = outputPath('rational.mp4');
    const outcome = await encoder.encode(
      request({
        frames: streamOf(pngFrames(2)),
        frameCount: 2,
        output,
        fps: { numerator: 30000, denominator: 1001 },
      }),
    );
    expect(outcome).toMatchObject({ ok: true });
    const argv = encodeArgv();
    expect(argv).toEqual([
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'image2pipe',
      '-framerate',
      '30000/1001',
      '-c:v',
      'png',
      '-i',
      'pipe:0',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-r',
      '30000/1001',
      // The last argument is the temporary sibling, never the target.
      expect.stringMatching(/\/\.rational\.[0-9a-f-]{36}\.part\.mp4$/u),
    ]);
    // Both rates cross as the rational; a float would break the exact-duration guarantee.
    expect(argv.filter((argument) => /^\d+\.\d+$/u.test(argument))).toEqual([]);
  });

  it('fails before FFmpeg runs when the target directory cannot take the sibling', async () => {
    const binary = fakeFfmpeg({
      version: 'ffmpeg version 9.0.1 Copyright (c) 2000-2026 the FFmpeg developers',
    });
    const encoder = await openEncoder(binary);
    const missing = join(directory, 'absent-directory');
    const output = join(missing, 'out.mp4');
    const outcome = await encoder.encode(
      request({ frames: streamOf(pngFrames(2)), frameCount: 2, output }),
    );
    expect(errorsOf(outcome)[0]).toMatchObject({
      code: 'encode.output-invalid',
      details: { output, reason: 'unwritable' },
    });
    expect(invocations()).toEqual(['version', 'encoders']);
    expect(existsSync(missing)).toBe(false);
  });

  it('never starts a child for a zero-frame composition', async () => {
    const binary = fakeFfmpeg({
      version: 'ffmpeg version 9.0.1 Copyright (c) 2000-2026 the FFmpeg developers',
    });
    const encoder = await openEncoder(binary);
    const output = outputPath();
    const outcome = await encoder.encode(request({ frames: streamOf([]), frameCount: 0, output }));
    expect(errorsOf(outcome)[0]).toMatchObject({
      code: 'encode.output-invalid',
      details: { output, reason: 'no-frames' },
    });
    expect(invocations()).toEqual(['version', 'encoders']);
    expect(existsSync(output)).toBe(false);
  });

  it('reports a refused rename as internal.unexpected, not as a pre-spawn unwritable target', async () => {
    const binary = fakeFfmpeg({
      version: 'ffmpeg version 9.0.1 Copyright (c) 2000-2026 the FFmpeg developers',
    });
    const encoder = await openEncoder(binary);
    // A directory at the target path: the sibling is created and the child writes it, then the
    // rename onto `output` is refused. `unwritable` means "no child was started", so not this.
    const output = outputPath('target.mp4');
    mkdirSync(output);
    const outcome = await encoder.encode(
      request({ frames: streamOf(pngFrames(2)), frameCount: 2, output }),
    );
    expect(errorsOf(outcome)[0]).toMatchObject({ code: 'internal.unexpected' });
    expect(statSync(output).isDirectory()).toBe(true);
    expect(pathsLeftBehind(directory)).toEqual([]);
  });

  it('reports a zero-byte sibling after a successful exit as encode.output-invalid', async () => {
    const binary = fakeFfmpeg({
      version: 'ffmpeg version 9.0.1 Copyright (c) 2000-2026 the FFmpeg developers',
      encode: 'empty',
    });
    const encoder = await openEncoder(binary);
    const output = outputPath();
    const outcome = await encoder.encode(
      request({ frames: streamOf(pngFrames(2)), frameCount: 2, output }),
    );
    expect(errorsOf(outcome)[0]).toMatchObject({
      code: 'encode.output-invalid',
      details: { output, reason: 'empty' },
    });
    expect(existsSync(output)).toBe(false);
    expect(pathsLeftBehind(directory)).toEqual([]);
  });

  it('reports a stream shorter than frameCount as internal.unexpected, not as success', async () => {
    const encoder = await openEncoder('ffmpeg');
    const output = outputPath();
    const outcome = await encoder.encode(
      request({ frames: streamOf(pngFrames(2)), frameCount: 5, output }),
    );
    expect(errorsOf(outcome)[0]).toMatchObject({ code: 'internal.unexpected' });
    expect(existsSync(output)).toBe(false);
    expect(pathsLeftBehind(directory)).toEqual([]);
  }, 60_000);

  it('ends as aborted control flow for an aborted element, with no Diagnostic', async () => {
    const encoder = await openEncoder('ffmpeg');
    const output = outputPath();
    const pngs = pngFrames(2);
    const frames = asyncIterableOf<FrameCaptureResult>([
      frameOf(pngs, 0),
      { ok: false, aborted: true },
    ]);
    const outcome = await encoder.encode(request({ frames, frameCount: 2, output }));
    expect(outcome).toEqual({ ok: false, aborted: true });
    expect(existsSync(output)).toBe(false);
    expect(pathsLeftBehind(directory)).toEqual([]);
  }, 60_000);

  it('forwards a failed frame’s Diagnostics unchanged', async () => {
    const binary = fakeFfmpeg({
      version: 'ffmpeg version 9.0.1 Copyright (c) 2000-2026 the FFmpeg developers',
    });
    const encoder = await openEncoder(binary);
    const output = outputPath();
    const captureDiagnostic = {
      code: 'render.page-error' as const,
      severity: 'error' as const,
      message: 'Capture failed.',
      hint: 'Fix the page.',
    };
    const frames = asyncIterableOf<FrameCaptureResult>([{ ok: false, error: [captureDiagnostic] }]);
    const outcome = await encoder.encode(request({ frames, frameCount: 1, output }));
    expect(errorsOf(outcome)).toEqual([captureDiagnostic]);
    expect(existsSync(output)).toBe(false);
    expect(pathsLeftBehind(directory)).toEqual([]);
  });

  it('treats a frame whose dimensions differ from the first as internal.unexpected', async () => {
    const binary = fakeFfmpeg({
      version: 'ffmpeg version 9.0.1 Copyright (c) 2000-2026 the FFmpeg developers',
    });
    const encoder = await openEncoder(binary);
    const output = outputPath();
    const pngs = pngFrames(2);
    const frames = asyncIterableOf<FrameCaptureResult>([
      frameOf(pngs, 0),
      frameOf(pngs, 1, { width: 32, height: 32 }),
    ]);
    const outcome = await encoder.encode(request({ frames, frameCount: 2, output }));
    expect(errorsOf(outcome)[0]).toMatchObject({ code: 'internal.unexpected' });
    expect(existsSync(output)).toBe(false);
    expect(pathsLeftBehind(directory)).toEqual([]);
  });

  it('carries the captured warnings into the receipt of a successful encode', async () => {
    const binary = fakeFfmpeg({
      version: 'ffmpeg version 9.0.1 Copyright (c) 2000-2026 the FFmpeg developers',
    });
    const encoder = await openEncoder(binary);
    const output = outputPath();
    const pngs = pngFrames(2);
    const warning = {
      code: 'seek.uncontrolled' as const,
      severity: 'warning' as const,
      message: 'An integration has uncontrolled time or history-dependent state.',
      hint: 'Use a qualified absolute-time integration.',
      location: { frame: 1 },
    };
    const frames = asyncIterableOf<FrameCaptureResult>([
      frameOf(pngs, 0),
      withDiagnostics(frameOf(pngs, 1), [warning]),
    ]);
    const outcome = await encoder.encode(request({ frames, frameCount: 2, output }));
    expect(outcome).toMatchObject({ ok: true, value: { diagnostics: [warning] } });
    expect(existsSync(output)).toBe(true);
  });

  it('observes a caller cancellation while a stdin write is blocked', async () => {
    const binary = fakeFfmpeg({
      version: 'ffmpeg version 9.0.1 Copyright (c) 2000-2026 the FFmpeg developers',
      encode: 'stall',
    });
    const encoder = await openEncoder(binary);
    const output = outputPath();
    const controller = new AbortController();
    // Larger than the pipe buffer, so the first write never completes against a stalled reader.
    const png = Buffer.alloc(512 * 1024, 7);
    const frames = asyncIterableOf<FrameCaptureResult>(
      Array.from({ length: 4 }, (_, index) => ({
        ok: true as const,
        value: {
          frame: index,
          width: 64,
          height: 64,
          format: 'png' as const,
          image: png,
          diagnostics: [],
        },
      })),
    );
    const pending = encoder.encode(
      request({ frames, frameCount: 4, output, signal: controller.signal }),
    );
    setTimeout(() => controller.abort(), 100);
    expect(await pending).toEqual({ ok: false, aborted: true });
    expect(existsSync(output)).toBe(false);
    expect(pathsLeftBehind(directory)).toEqual([]);
  }, 10_000);

  it('kills a child that outlives the last frame when a cancel arrives', async () => {
    const binary = fakeFfmpeg({
      version: 'ffmpeg version 9.0.1 Copyright (c) 2000-2026 the FFmpeg developers',
      encode: 'stall-after-eof',
    });
    const encoder = await openEncoder(binary);
    const output = outputPath();
    const controller = new AbortController();
    const pending = encoder.encode(
      request({
        frames: streamOf(pngFrames(1)),
        frameCount: 1,
        output,
        signal: controller.signal,
      }),
    );
    // stdin reached EOF, so every frame was handed over and the encode is waiting for the
    // child alone; cancelling there must kill it instead of waiting for it to finish.
    await waitFor(() => existsSync(join(directory, 'stdin.eof')), 10_000);
    controller.abort();
    expect(await pending).toEqual({ ok: false, aborted: true });
    expect(existsSync(output)).toBe(false);
    expect(pathsLeftBehind(directory)).toEqual([]);
    expect(childGone(encodePid())).toBe(true);
  }, 10_000);

  it('kills the child, removes the sibling and aborts on a caller cancellation', async () => {
    const binary = fakeFfmpeg({
      version: 'ffmpeg version 9.0.1 Copyright (c) 2000-2026 the FFmpeg developers',
    });
    const encoder = await openEncoder(binary);
    const output = outputPath();
    const pngs = pngFrames(4);
    const controller = new AbortController();
    const frames = (async function* () {
      for (const [index, png] of pngs.entries()) {
        if (index === 2) controller.abort();
        await new Promise((resolve) => setTimeout(resolve, 10));
        yield {
          ok: true as const,
          value: {
            frame: index,
            width: 64,
            height: 64,
            format: 'png' as const,
            image: png,
            diagnostics: [],
          },
        };
      }
    })();
    const outcome = await encoder.encode(
      request({ frames, frameCount: 4, output, signal: controller.signal }),
    );
    expect(outcome).toEqual({ ok: false, aborted: true });
    expect(existsSync(output)).toBe(false);
    expect(pathsLeftBehind(directory)).toEqual([]);
  }, 60_000);
});

describe('declared audio', () => {
  const fakeBinary = (): string =>
    fakeFfmpeg({ version: 'ffmpeg version 9.0.1 Copyright (c) 2000-2026 the FFmpeg developers' });

  /** Two readable stand-ins: the encoder only stats them; the stand-in binary writes no audio. */
  const audioFixture = (): { readonly first: string; readonly second: string } => {
    const source = join(directory, 'audio');
    mkdirSync(source);
    const first = join(source, 'clip-1.wav');
    const second = join(source, 'clip-2.wav');
    writeFileSync(first, 'RIFF');
    writeFileSync(second, 'RIFF');
    return { first, second };
  };

  it('keeps the video-only vector when no audio is declared (the silent path is unchanged)', async () => {
    const encoder = await openEncoder(fakeBinary());
    const outcome = await encoder.encode(
      request({ frames: streamOf(pngFrames(2)), frameCount: 2, audio: [] }),
    );
    expect(outcome).toMatchObject({ ok: true });
    // Exactly TASK-159's arguments: no -i for audio, no filter graph, no -map, no audio codec.
    expect(encodeArgv()).toEqual([
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'image2pipe',
      '-framerate',
      '10/1',
      '-c:v',
      'png',
      '-i',
      'pipe:0',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-r',
      '10/1',
      expect.stringMatching(/\/\.out\.[0-9a-f-]{36}\.part\.mp4$/u),
    ]);
  });

  it('adds one input per track and a mix graph on the frame timebase', async () => {
    const encoder = await openEncoder(fakeBinary());
    fakeFfprobe(2, 2);
    const { first, second } = audioFixture();
    const output = outputPath('audio.mp4');
    const pngs = pngFrames(30);
    const outcome = await encoder.encode(
      request({
        frames: streamOf(pngs),
        frameCount: pngs.length,
        output,
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
        projectRoot: directory,
      }),
    );
    expect(outcome).toMatchObject({ ok: true });
    // Relative sources resolve against the project root; the graph places each frame-derived
    // offset and the output duration is the Composition's own end.
    const graph = [
      '[1:a]atrim=start=0.000000,asetpts=PTS-STARTPTS,volume=1,aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,adelay=500:all=1[a0]',
      '[2:a]atrim=start=1.000000:end=2.000000,asetpts=PTS-STARTPTS,volume=0.5,aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,adelay=1500:all=1[a1]',
      '[a0][a1]amix=inputs=2:duration=longest:normalize=0,apad[aout]',
    ].join(';');
    expect(encodeArgv()).toEqual([
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'image2pipe',
      '-framerate',
      '10/1',
      '-c:v',
      'png',
      '-i',
      'pipe:0',
      '-i',
      first,
      '-i',
      second,
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-r',
      '10/1',
      '-filter_complex',
      graph,
      '-map',
      '0:v:0',
      '-map',
      '[aout]',
      '-c:a',
      'aac',
      '-b:a',
      '192k',
      '-ar',
      '48000',
      '-t',
      '3.000000',
      expect.stringMatching(/\/\.audio\.[0-9a-f-]{36}\.part\.mp4$/u),
    ]);
    // One channel probe per track, in declaration order: the count is what the graph depends on.
    expect(ffprobeArgv()).toEqual([
      `-v error -select_streams a:0 -show_entries stream=channels -of csv=p=0 ${first}`,
      `-v error -select_streams a:0 -show_entries stream=channels -of csv=p=0 ${second}`,
    ]);
  });

  it('duplicates a mono source at unity gain instead of the constant-power matrix', async () => {
    const encoder = await openEncoder(fakeBinary());
    fakeFfprobe(1);
    audioFixture();
    const pngs = pngFrames(4);
    const outcome = await encoder.encode(
      request({
        frames: streamOf(pngs),
        frameCount: pngs.length,
        audio: [{ src: 'audio/clip-1.wav' }],
        projectRoot: directory,
      }),
    );
    expect(outcome).toMatchObject({ ok: true });
    // `aformat=…:channel_layouts=stereo` would apply FFmpeg's 0.7071 mono→stereo matrix and make
    // the same file render 3.01 dB quieter as mono than as stereo; `pan` keeps every sample.
    const graph = encodeArgv()[encodeArgv().indexOf('-filter_complex') + 1] ?? '';
    expect(graph).toBe(
      '[1:a]atrim=start=0.000000,asetpts=PTS-STARTPTS,volume=1,aresample=48000,aformat=sample_fmts=fltp,pan=stereo|c0=c0|c1=c0,adelay=0:all=1[a0];[a0]amix=inputs=1:duration=longest:normalize=0,apad[aout]',
    );
    expect(graph).not.toContain('channel_layouts=stereo');
  });

  it('chooses the conversion per track, so one mono clip cannot change another', async () => {
    const encoder = await openEncoder(fakeBinary());
    audioFixture();
    // The probe answers per source: the first track is mono, the second is stereo.
    fakeFfprobe(1, 2);
    const pngs = pngFrames(4);
    const outcome = await encoder.encode(
      request({
        frames: streamOf(pngs),
        frameCount: pngs.length,
        audio: [{ src: 'audio/clip-1.wav' }, { src: 'audio/clip-2.wav', startInFrames: 2 }],
        projectRoot: directory,
      }),
    );
    expect(outcome).toMatchObject({ ok: true });
    expect(ffprobeArgv()).toHaveLength(2);
    const graph = encodeArgv()[encodeArgv().indexOf('-filter_complex') + 1] ?? '';
    expect(graph).toContain(
      '[1:a]atrim=start=0.000000,asetpts=PTS-STARTPTS,volume=1,aresample=48000,aformat=sample_fmts=fltp,pan=stereo|c0=c0|c1=c0,adelay=0:all=1[a0]',
    );
    expect(graph).toContain(
      '[2:a]atrim=start=0.000000,asetpts=PTS-STARTPTS,volume=1,aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,adelay=200:all=1[a1]',
    );
  });

  it('reports a missing ffprobe as encode.ffmpeg-not-found and writes no MP4', async () => {
    const encoder = await openEncoder(fakeBinary());
    audioFixture();
    const output = outputPath();
    const outcome = await encoder.encode(
      request({
        frames: streamOf([]),
        frameCount: 2,
        output,
        audio: [{ src: 'audio/clip-1.wav' }],
        projectRoot: directory,
      }),
    );
    // No channel count means no trustworthy mono conversion: the install, not the track, is wrong.
    expect(errorsOf(outcome)[0]).toMatchObject({
      code: 'encode.ffmpeg-not-found',
      details: { binary: join(directory, 'ffprobe') },
    });
    expect(invocations()).toEqual(['version', 'encoders']);
    expect(existsSync(output)).toBe(false);
    expect(pathsLeftBehind(directory)).toEqual([]);
  });

  it('falls back to the layout conversion when the probe reports no count', async () => {
    const encoder = await openEncoder(fakeBinary());
    fakeFfprobe('fail');
    audioFixture();
    const pngs = pngFrames(4);
    const outcome = await encoder.encode(
      request({
        frames: streamOf(pngs),
        frameCount: pngs.length,
        audio: [{ src: 'audio/clip-1.wav' }],
        projectRoot: directory,
      }),
    );
    // A file whose stream cannot be read stays the encoder's own failure, with its stderr tail.
    expect(outcome).toMatchObject({ ok: true });
    expect(encodeArgv().join(' ')).toContain('aformat=sample_fmts=fltp:channel_layouts=stereo');
  });

  it('reports a track the process may not read as asset.load-failed', async () => {
    // Root ignores the mode bits, so the check cannot be exercised there.
    if (process.getuid?.() === 0) return;
    const encoder = await openEncoder(fakeBinary());
    const output = outputPath();
    const { first } = audioFixture();
    chmodSync(first, 0o000);
    const outcome = await encoder.encode(
      request({
        frames: streamOf([]),
        frameCount: 2,
        output,
        audio: [{ src: 'audio/clip-1.wav' }],
        projectRoot: directory,
      }),
    );
    // `statSync` accepts the file; opening it is what turns a mode into an input failure, before
    // the encode child runs and before any frame is piped.
    expect(errorsOf(outcome)[0]).toMatchObject({
      code: 'asset.load-failed',
      location: { file: first },
      details: { assets: [{ kind: 'audio', source: first, phase: 'open' }] },
    });
    expect(invocations()).toEqual(['version', 'encoders']);
    expect(ffprobeArgv()).toEqual([]);
    expect(existsSync(output)).toBe(false);
    expect(pathsLeftBehind(directory)).toEqual([]);
  });

  it('reports a URL-shaped src as asset.load-failed with its query redacted', async () => {
    const encoder = await openEncoder(fakeBinary());
    const output = outputPath();
    const source = 'https://cdn.example.com/voice.mp3?X-Amz-Signature=deadbeef&Expires=1';
    const resolved = ` ${join(directory, 'https:/cdn.example.com/voice.mp3')}`;
    const outcome = await encoder.encode(
      request({
        frames: streamOf([]),
        frameCount: 2,
        output,
        audio: [{ src: source }],
        projectRoot: directory,
      }),
    );
    const [diagnostic] = errorsOf(outcome);
    // The path is reported, the signed query is not: one redacting producer decides both fields.
    expect(diagnostic).toMatchObject({
      code: 'asset.load-failed',
      message: `The declared audio file "${resolved.trim()} (+2 query parameters, redacted)" could not be read.`,
      location: { file: `${resolved.trim()} (+2 query parameters, redacted)` },
      details: {
        assets: [
          {
            kind: 'audio',
            source: `${resolved.trim()} (+2 query parameters, redacted)`,
            phase: 'open',
          },
        ],
      },
    });
    expect(JSON.stringify(diagnostic)).not.toContain('deadbeef');
    expect(JSON.stringify(diagnostic)).not.toContain('X-Amz-Signature');
  });

  it('reports a missing audio file as asset.load-failed and spawns no encode child', async () => {
    const encoder = await openEncoder(fakeBinary());
    const output = outputPath();
    const outcome = await encoder.encode(
      request({
        frames: streamOf([]),
        frameCount: 2,
        output,
        audio: [{ src: 'absent.wav' }],
        projectRoot: directory,
      }),
    );
    const missing = join(directory, 'absent.wav');
    expect(errorsOf(outcome)).toHaveLength(1);
    expect(errorsOf(outcome)[0]).toMatchObject({
      code: 'asset.load-failed',
      severity: 'error',
      location: { file: missing },
      details: { assets: [{ kind: 'audio', source: missing, phase: 'open' }] },
    });
    expect(invocations()).toEqual(['version', 'encoders']);
    expect(existsSync(output)).toBe(false);
    expect(pathsLeftBehind(directory)).toEqual([]);
  });

  it('stops at the first unreadable track, before creating the temporary sibling', async () => {
    const encoder = await openEncoder(fakeBinary());
    const output = outputPath();
    audioFixture();
    // A directory is not a file: the same input failure, reported before FFmpeg runs.
    mkdirSync(join(directory, 'audio', 'directory.wav'));
    const outcome = await encoder.encode(
      request({
        frames: streamOf([]),
        frameCount: 2,
        output,
        audio: [{ src: 'audio/clip-1.wav' }, { src: 'audio/directory.wav' }],
        projectRoot: directory,
      }),
    );
    expect(errorsOf(outcome)[0]).toMatchObject({
      code: 'asset.load-failed',
      location: { file: join(directory, 'audio', 'directory.wav') },
    });
    expect(invocations()).toEqual(['version', 'encoders']);
    expect(existsSync(output)).toBe(false);
    expect(pathsLeftBehind(directory)).toEqual([]);
  });
});
