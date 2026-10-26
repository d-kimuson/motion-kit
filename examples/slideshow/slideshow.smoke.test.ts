import { execFile, execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { compositions as slideshowCompositions } from './entry.tsx';
import { generatePlaceholders } from './fetch-assets.ts';
import { compositions as probeCompositions } from './probe.tsx';

const execFileAsync = promisify(execFile);

// Every command runs from the repository root: the CLI's projectRoot is process.cwd(), and React,
// ReactDOM and Zod resolve against it (docs/design-doc/20261025-reference-examples.md, "Running an
// example"). `pnpm test` builds dist/ first, so the shipped CLI is the thing under test.
const repositoryRoot = new URL('../../', import.meta.url).pathname;
const cli = join(repositoryRoot, 'dist', 'cli.js');
const outDirectory = join(repositoryRoot, 'out', 'examples');

// The CLI's own envelope contract, re-stated here so the assertion is checked rather than cast.
const renderEnvelopeSchema = z.object({
  schemaVersion: z.literal(1),
  command: z.literal('render'),
  ok: z.boolean(),
  diagnostics: z.array(z.unknown()),
  data: z
    .object({
      output: z.string(),
      format: z.string(),
      width: z.number(),
      height: z.number(),
      frameCount: z.number(),
      fps: z.object({ numerator: z.number(), denominator: z.number() }),
      durationSeconds: z.number(),
    })
    .nullable(),
});

const frameEnvelopeSchema = z.object({
  schemaVersion: z.literal(1),
  command: z.literal('frame'),
  ok: z.boolean(),
  diagnostics: z.array(z.unknown()),
  data: z
    .object({
      output: z.string(),
      format: z.literal('png'),
      frame: z.number(),
      timeSeconds: z.number(),
      width: z.number(),
      height: z.number(),
    })
    .nullable(),
});

const ffprobe = (file: string, entries: string): string =>
  execFileSync('ffprobe', [
    '-v',
    'error',
    '-select_streams',
    'v:0',
    '-show_entries',
    entries,
    '-of',
    'default=noprint_wrappers=1',
    file,
  ]).toString();

describe('slideshow example', () => {
  // The smoke test is its own setup: CI has no committed media and no network, so the FFmpeg
  // placeholders are generated here, before the render that needs them
  // (docs/design-doc/20261025-reference-examples.md, "Assets and provenance").
  beforeAll(async () => {
    mkdirSync(outDirectory, { recursive: true });
    await generatePlaceholders({ report: (message) => console.info(message) });
  }, 180_000);

  it('declares the vertical slideshow, its 16:9 twin, its CI twin and its probe', () => {
    expect(slideshowCompositions.ok).toBe(true);
    expect(probeCompositions.ok).toBe(true);
    if (!slideshowCompositions.ok || !probeCompositions.ok) return;
    const descriptors = slideshowCompositions.value.listCompositions();
    expect(descriptors.map((item) => item.id)).toEqual([
      'slideshow',
      'slideshow-landscape',
      'slideshow-ci',
    ]);
    const [vertical, landscape, ci] = descriptors;
    // 1080x1920 at 30 fps for 600-1200 frames (20-40 s): a local QA Check, never rendered in CI.
    expect(vertical).toMatchObject({ width: 1080, height: 1920 });
    expect(vertical?.fps).toEqual({ numerator: 30, denominator: 1 });
    expect(vertical?.durationInFrames).toBeGreaterThanOrEqual(600);
    expect(vertical?.durationInFrames).toBeLessThanOrEqual(1200);
    // The same scene components at 16:9, with the same timeline length: only the frame differs.
    expect(landscape).toMatchObject({
      width: 1920,
      height: 1080,
      durationInFrames: vertical?.durationInFrames,
    });
    expect(landscape?.fps).toEqual({ numerator: 30, denominator: 1 });
    // The CI twin is half linear resolution and exactly 60 frames, per the CI policy.
    expect(ci).toMatchObject({ width: 540, height: 960, durationInFrames: 60 });
    expect(probeCompositions.value.listCompositions()).toMatchObject([
      { id: 'slideshow-probe', width: 480, height: 270, durationInFrames: 30 },
    ]);
  });

  it('renders slideshow-ci through the CLI as a 60-frame 540x960 MP4 that decodes clean', async () => {
    const output = join(outDirectory, 'slideshow-ci.mp4');
    const { stdout } = await execFileAsync(
      process.execPath,
      [
        cli,
        'render',
        'examples/slideshow/entry.tsx',
        '--composition',
        'slideshow-ci',
        '--out',
        output,
        '--json',
      ],
      { cwd: repositoryRoot, timeout: 120_000, maxBuffer: 16 * 1024 * 1024 },
    );
    const parsed: unknown = JSON.parse(stdout);
    const envelope = renderEnvelopeSchema.parse(parsed);
    // A missing photo fails the render with `asset.load-failed` rather than encoding a blank frame,
    // so `ok` here is also the assertion that the generated placeholders loaded.
    expect(envelope).toMatchObject({ schemaVersion: 1, command: 'render', ok: true });
    expect(envelope.diagnostics).toEqual([]);
    expect(envelope.data).toMatchObject({
      output,
      format: 'mp4',
      width: 540,
      height: 960,
      frameCount: 60,
      fps: { numerator: 30, denominator: 1 },
    });
    expect(envelope.data?.durationSeconds).toBeCloseTo(2, 5);
    expect(statSync(output).size).toBeGreaterThan(0);

    const probed = ffprobe(
      output,
      'stream=codec_name,nb_frames,r_frame_rate,avg_frame_rate,duration,width,height',
    );
    expect(probed).toContain('codec_name=h264');
    expect(probed).toContain('width=540');
    expect(probed).toContain('height=960');
    expect(probed).toContain('nb_frames=60');
    expect(probed).toContain('r_frame_rate=30/1');
    expect(probed).toContain('avg_frame_rate=30/1');
    expect(probed).toContain('duration=2.000000');

    // A clean decode: FFmpeg reports nothing at `error` level for the whole stream.
    const decoded = execFileSync('ffmpeg', ['-v', 'error', '-i', output, '-f', 'null', '-'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    expect(decoded).toBe('');
  }, 180_000);

  it('cross-dissolves between its slides instead of fading from black', () => {
    // The regression this guards is invisible in an envelope: a slide carried its ink ground on the
    // *root* of its frame, so the upper of a crossfade's two stacked frames painted an opaque
    // rectangle over the picture below it. Every fade then went dark-then-light — the mean luma of the
    // `slideshow-ci` render fell from 108 to 25 in one frame — and every assertion above still passed.
    // Here nothing but pictures is on screen for the whole 60 frames, so a dissolve can only move the
    // luma by a few points per frame; the bug moves it by the whole range. It reads the MP4 the test
    // above rendered, in the same file and therefore in the same order.
    const output = join(outDirectory, 'slideshow-ci.mp4');
    expect(statSync(output).size).toBeGreaterThan(0);
    const stats = join(outDirectory, 'slideshow-ci-luma.txt');
    execFileSync(
      'ffmpeg',
      [
        '-v',
        'error',
        '-y',
        '-i',
        output,
        '-vf',
        `signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=${stats}`,
        '-f',
        'null',
        '-',
      ],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
    const lines = readFileSync(stats, 'utf8').split('\n');
    const luma: number[] = [];
    for (let index = 0; index < lines.length; index += 1) {
      if (!(lines[index] ?? '').startsWith('frame:')) continue;
      const match = /YAVG=([0-9.]+)/.exec(lines[index + 1] ?? '');
      const value = match?.[1];
      if (value !== undefined) luma.push(Number(value));
    }
    expect(luma).toHaveLength(60);
    const brightest = Math.max(...luma);
    const darkest = Math.min(...luma);
    // The three placeholder photos really are different pictures, so this is not comparing blanks.
    expect(brightest - darkest).toBeGreaterThan(20);
    const steps = luma.slice(1).map((value, index) => Math.abs(value - (luma[index] ?? value)));
    expect(Math.max(...steps)).toBeLessThan((brightest - darkest) * 0.25);
  });

  it('renders one slideshow-landscape still at 1920x1080', async () => {
    // The landscape variant is checked by its descriptor above plus one still here, never by a full
    // render: its job is to prove the components read `useTimeline().width/height`, and a still from
    // the middle of a slide is enough to see the caption inside the wider safe area. Frame 400 is
    // inside the fourth slide and outside every crossfade, so the still shows one picture at full
    // opacity.
    const output = join(outDirectory, 'slideshow-landscape-400.png');
    const { stdout } = await execFileAsync(
      process.execPath,
      [
        cli,
        'frame',
        'examples/slideshow/entry.tsx',
        '--composition',
        'slideshow-landscape',
        '--frame',
        '400',
        '--out',
        output,
        '--json',
      ],
      { cwd: repositoryRoot, timeout: 120_000, maxBuffer: 16 * 1024 * 1024 },
    );
    const envelope = frameEnvelopeSchema.parse(JSON.parse(stdout));
    expect(envelope).toMatchObject({ schemaVersion: 1, command: 'frame', ok: true });
    expect(envelope.diagnostics).toEqual([]);
    expect(envelope.data).toMatchObject({
      output,
      format: 'png',
      frame: 400,
      width: 1920,
      height: 1080,
    });
    expect(envelope.data?.timeSeconds).toBeCloseTo(400 / 30, 5);
    expect(statSync(output).size).toBeGreaterThan(1000);

    const probed = ffprobe(output, 'stream=width,height');
    expect(probed).toContain('width=1920');
    expect(probed).toContain('height=1080');
  }, 180_000);
});
