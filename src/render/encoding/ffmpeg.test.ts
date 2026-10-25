import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { type Diagnostic } from '../../lib/diagnostic.ts';
import { type FrameCaptureResult } from '../capture/frame.ts';
import { type EncodeOutcome, type EncodeProgress, type Encoder } from './encoder.ts';
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

/** PNG frames from a real FFmpeg fixture; the encoder's input contract is PNG bytes. */
const pngFrames = (count: number): Buffer[] => {
  const target = join(directory, 'source-%04d.png');
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
): FrameCaptureResult => {
  const png = pngs[index];
  if (png === undefined) throw new Error(`frame ${String(index)} is missing`);
  return { ok: true, value: { frame: index, ...size, png, diagnostics: [] } };
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
  /** Whether `-encoders` lists libx264. */
  readonly libx264?: boolean;
  /** What the encode invocation does after draining stdin. */
  readonly encode?: 'ok' | 'fail' | 'empty' | 'stall';
};

/**
 * A stand-in for the binary, so the probe matrix and every post-probe failure is exercised
 * without a real FFmpeg build for each case. Each invocation appends its role to `log`.
 */
const fakeFfmpeg = (variant: FakeVariant): string => {
  const log = join(directory, 'invocations.log');
  const script = `#!/bin/sh
log="${log}"
case "$1" in
  -version)
    echo version >> "$log"
    ${variant.version === undefined ? '' : `printf '%s\\n' "${variant.version}"`}
    exit 0
    ;;
  -hide_banner)
    echo encoders >> "$log"
    printf 'Encoders:\\n'
    ${variant.libx264 === false ? '' : `printf ' V....D libx264              libx264 H.264 / AVC\\n'`}
    exit 0
    ;;
esac
echo encode >> "$log"
last=""
for argument in "$@"; do last="$argument"; done
${
  variant.encode === 'stall'
    ? // A reader that never drains stdin and never exits, so a write stays blocked.
      `exec sleep 60`
    : 'cat > /dev/null'
}
${
  variant.encode === 'fail'
    ? `printf 'boom: the encoder exploded\\n' >&2\nexit 1`
    : variant.encode === 'empty'
      ? 'exit 0'
      : variant.encode === 'stall'
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

const outputPath = (name = 'out.mp4'): string => join(directory, name);

const request = (options: {
  frames: AsyncIterable<FrameCaptureResult>;
  frameCount: number;
  output?: string;
  signal?: AbortSignal;
  onProgress?: (progress: EncodeProgress) => void;
}) => ({
  frames: options.frames,
  fps: { numerator: 10, denominator: 1 },
  frameCount: options.frameCount,
  output: options.output ?? outputPath(),
  ...(options.signal === undefined ? {} : { signal: options.signal }),
  ...(options.onProgress === undefined ? {} : { onProgress: options.onProgress }),
});

const openEncoder = async (ffmpegPath: string): Promise<Encoder> => {
  const probed = await createFfmpegEncoder({ ffmpegPath });
  if (!probed.ok) throw new Error(`probe failed: ${JSON.stringify(probed.error)}`);
  return probed.value;
};

const errorsOf = (outcome: EncodeOutcome) => {
  if (outcome.ok || !('error' in outcome)) throw new Error('expected a diagnostic failure');
  return outcome.error;
};

describe('createFfmpegEncoder probe', () => {
  it('reports a missing binary as encode.ffmpeg-not-found', async () => {
    const result = await createFfmpegEncoder({ ffmpegPath: join(directory, 'absent-ffmpeg') });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected a probe failure');
    expect(result.error).toMatchObject({
      code: 'encode.ffmpeg-not-found',
      severity: 'error',
      details: { binary: join(directory, 'absent-ffmpeg') },
    });
    expect(result.error.hint).toBeTruthy();
  });

  it('reports a version below the floor as encode.ffmpeg-unsupported', async () => {
    const binary = fakeFfmpeg({
      version: 'ffmpeg version 4.4.2 Copyright (c) 2000-2021 the FFmpeg developers',
      encode: 'fail',
    });
    const result = await createFfmpegEncoder({ ffmpegPath: binary });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected a probe failure');
    expect(result.error).toMatchObject({
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
    if (result.ok) throw new Error('expected a probe failure');
    expect(result.error).toMatchObject({
      code: 'encode.ffmpeg-unsupported',
      details: { found: '9.0.1', required: '6.0', missing: ['libx264'] },
    });
  });

  it('reports an unparseable version line as encode.ffmpeg-unsupported', async () => {
    const binary = fakeFfmpeg({ encode: 'fail' });
    const result = await createFfmpegEncoder({ ffmpegPath: binary });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected a probe failure');
    expect(result.error).toMatchObject({ code: 'encode.ffmpeg-unsupported' });
  });

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
        value: { frame: index, width: 64, height: 64, png, diagnostics: [] },
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
          value: { frame: index, width: 64, height: 64, png, diagnostics: [] },
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
