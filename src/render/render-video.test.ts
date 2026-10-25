import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { type FrameCaptureResult } from './capture/frame.ts';
import { type EncodeProgress } from './encoding/encoder.ts';
import { renderVideo } from './render-video.ts';
import { createRenderer, type Renderer } from './renderer.ts';

const require = createRequire(import.meta.url);
const renderers: Renderer[] = [];
let directory: string;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'motion-kit-video-'));
  mkdirSync(join(directory, 'node_modules'));
  for (const name of ['react', 'react-dom', 'zod'])
    symlinkSync(
      dirname(require.resolve(`${name}/package.json`)),
      join(directory, 'node_modules', name),
    );
  writeFileSync(join(directory, 'package.json'), '{"type":"module"}');
  writeFileSync(
    join(directory, 'entry.ts'),
    `export {compositions} from ${JSON.stringify(
      new URL('./encoding/fixtures/video.tsx', import.meta.url).pathname,
    )};`,
  );
});

afterEach(async () => {
  for (const renderer of renderers.splice(0)) await renderer.dispose();
  rmSync(directory, { recursive: true, force: true });
});

const open = async (): Promise<Renderer> => {
  const result = await createRenderer({
    projectRoot: directory,
    entry: 'entry.ts',
    compositionId: 'video',
    frameTimeoutMs: 10_000,
  });
  if (!result.ok) throw new Error(`Renderer creation failed: ${JSON.stringify(result)}`);
  renderers.push(result.value);
  return result.value;
};

/** ffprobe's JSON, narrowed once at the process boundary so no `any` reaches an assertion. */
const ProbeOutputSchema = z.object({
  streams: z.array(z.record(z.string(), z.unknown())).min(1),
});

/** ffprobe as values: the integration test asserts the file, not the encoder's own receipt. */
const probe = (path: string): Record<string, unknown> => {
  const stdout = execFileSync('ffprobe', [
    '-v',
    'error',
    '-select_streams',
    'v:0',
    '-show_entries',
    'stream=codec_name,width,height,r_frame_rate,avg_frame_rate,nb_frames,duration,format_name',
    '-of',
    'json',
    path,
  ]).toString();
  const parsed = ProbeOutputSchema.parse(JSON.parse(stdout));
  const stream = parsed.streams[0];
  if (stream === undefined) throw new Error('ffprobe reported no video stream');
  return stream;
};

const decodeToRgb = (path: string): Buffer =>
  execFileSync(
    'ffmpeg',
    [
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      path,
      '-f',
      'rawvideo',
      '-pix_fmt',
      'rgb24',
      '-',
    ],
    { maxBuffer: 64 * 1024 * 1024 },
  );

const extractFrame = (video: string, frame: number, target: string): void => {
  execFileSync('ffmpeg', [
    '-y',
    '-hide_banner',
    '-loglevel',
    'error',
    '-i',
    video,
    '-vf',
    `select=eq(n\\,${String(frame)})`,
    '-fps_mode',
    'passthrough',
    '-frames:v',
    '1',
    target,
  ]);
};

/** Mean and worst channel difference between two equal-sized RGB buffers. */
const compare = (a: Buffer, b: Buffer): { mean: number; max: number } => {
  expect(a.length).toBe(b.length);
  let total = 0;
  let max = 0;
  for (let index = 0; index < a.length; index++) {
    const difference = Math.abs((a[index] ?? 0) - (b[index] ?? 0));
    total += difference;
    if (difference > max) max = difference;
  }
  return { mean: total / a.length, max };
};

const asyncIterableOf = <T>(items: readonly T[]): AsyncIterable<T> => ({
  [Symbol.asyncIterator]: () => {
    const iterator = items[Symbol.iterator]();
    return { next: () => Promise.resolve(iterator.next()) };
  },
});

describe('renderVideo', () => {
  it('encodes a 2-second Composition to H.264 MP4 without a PNG directory', async () => {
    const renderer = await open();
    const descriptor = renderer.descriptor();
    const output = join(directory, 'video.mp4');
    const progress: EncodeProgress[] = [];
    const outcome = await renderVideo({
      composition: renderer,
      output,
      onProgress: (item) => progress.push(item),
    });
    expect(outcome).toMatchObject({
      ok: true,
      value: {
        output,
        frameCount: 40,
        width: 160,
        height: 120,
        fps: { numerator: 20, denominator: 1 },
        durationSeconds: 2,
      },
    });
    expect(descriptor.fps).toEqual({ numerator: 20, denominator: 1 });
    expect(existsSync(output)).toBe(true);
    // No intermediate PNG sequence, and no temporary sibling left anywhere.
    expect(readdirSync(directory).filter((name) => name.endsWith('.png'))).toEqual([]);
    expect(readdirSync(directory).filter((name) => name.includes('.part'))).toEqual([]);
    expect(progress.at(-1)).toEqual({ encodedFrames: 40, frameCount: 40 });

    const stream = probe(output);
    expect(stream).toMatchObject({
      codec_name: 'h264',
      width: 160,
      height: 120,
      r_frame_rate: '20/1',
      nb_frames: '40',
    });
    expect(Number(stream['duration'])).toBeCloseTo(2, 1);

    // The first and last decoded frames are the captured PNGs within an encoding tolerance.
    for (const frame of [0, descriptor.durationInFrames - 1]) {
      const captured = await renderer.renderFrame({ frame });
      if (!captured.ok) throw new Error(`Capture of frame ${String(frame)} failed`);
      const capturedPath = join(directory, `captured-${String(frame)}.png`);
      writeFileSync(capturedPath, captured.value.png);
      const decodedPath = join(directory, `decoded-${String(frame)}.png`);
      extractFrame(output, frame, decodedPath);
      const capturedRgb = decodeToRgb(capturedPath);
      const decodedRgb = decodeToRgb(decodedPath);
      // Both sides are real pixels at the descriptor's size, not empty buffers.
      expect(capturedRgb.length).toBe(descriptor.width * descriptor.height * 3);
      expect(decodedRgb.length).toBe(capturedRgb.length);
      const difference = compare(capturedRgb, decodedRgb);
      // H.264 is lossy and the output is chroma-subsampled, so exact bytes cannot be expected.
      expect(difference.mean).toBeLessThan(3);
      expect(difference.max).toBeLessThan(48);
    }
  }, 180_000);

  it('probes the encoder before rendering any frame', async () => {
    let rendered = 0;
    const frames: AsyncIterable<FrameCaptureResult> = (() => {
      const source = asyncIterableOf<FrameCaptureResult>([]);
      return {
        [Symbol.asyncIterator]: () => {
          const iterator = source[Symbol.asyncIterator]();
          return {
            next: () => {
              rendered += 1;
              return iterator.next();
            },
          };
        },
      };
    })();
    const outcome = await renderVideo({
      composition: {
        descriptor: () => ({
          id: 'absent',
          width: 16,
          height: 16,
          fps: { numerator: 30, denominator: 1 },
          durationInFrames: 1,
        }),
        renderFrames: () => frames,
      },
      output: join(directory, 'absent.mp4'),
      ffmpegPath: join(directory, 'no-such-ffmpeg'),
    });
    expect(outcome).toMatchObject({
      ok: false,
      error: [{ code: 'encode.ffmpeg-not-found' }],
    });
    expect(rendered).toBe(0);
    expect(existsSync(join(directory, 'absent.mp4'))).toBe(false);
  });
});
