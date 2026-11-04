import { execFile, execFileSync } from 'node:child_process';
import { mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { compositions as promoCompositions } from './entry.tsx';
import { placeScenes, promoStoryboard } from './plan.ts';

const execFileAsync = promisify(execFile);

// Every command runs from the repository root: the CLI's projectRoot is process.cwd(), and React,
// ReactDOM and Zod resolve against it (dev-docs/design-doc/20261025-reference-examples.md, "Running an
// example"). `pnpm test` builds dist/ first, so the shipped CLI is the thing under test.
const repositoryRoot = new URL('../../', import.meta.url).pathname;
const cli = join(repositoryRoot, 'dist', 'cli.js');

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
      frames: z.array(
        z.object({ output: z.string(), frame: z.number(), width: z.number(), height: z.number() }),
      ),
    })
    .nullable(),
});

const ffprobe = (file: string): string =>
  execFileSync('ffprobe', [
    '-v',
    'error',
    '-select_streams',
    'v:0',
    '-show_entries',
    'stream=codec_name,nb_frames,r_frame_rate,avg_frame_rate,duration,width,height',
    '-of',
    'default=noprint_wrappers=1',
    file,
  ]).toString();

describe('promo example', () => {
  it('declares the full promo and its CI twin at the documented sizes', () => {
    expect(promoCompositions.ok).toBe(true);
    if (!promoCompositions.ok) return;
    const descriptors = promoCompositions.value.listCompositions();
    expect(descriptors.map((item) => item.id)).toEqual(['promo', 'promo-ci']);
    const [full, ci] = descriptors;
    // 1920x1080 at 30 fps for 1371 frames (45.7 s): a local QA Check, never rendered in CI.
    expect(full).toMatchObject({ width: 1920, height: 1080, durationInFrames: 1371 });
    expect(full?.fps).toEqual({ numerator: 30, denominator: 1 });
    // The CI twin is half linear resolution and exactly 60 frames, per the CI policy.
    expect(ci).toMatchObject({ width: 960, height: 540, durationInFrames: 60 });
  });

  it('renders promo-ci through the CLI as a 60-frame 960x540 MP4 that decodes clean', async () => {
    const output = join(repositoryRoot, 'out', 'examples', 'promo-ci.mp4');
    mkdirSync(join(repositoryRoot, 'out', 'examples'), { recursive: true });
    const { stdout } = await execFileAsync(
      process.execPath,
      [
        cli,
        'render',
        'examples/promo/entry.tsx',
        '--composition',
        'promo-ci',
        '--out',
        output,
        '--json',
      ],
      { cwd: repositoryRoot, timeout: 120_000, maxBuffer: 16 * 1024 * 1024 },
    );
    const parsed: unknown = JSON.parse(stdout);
    const envelope = renderEnvelopeSchema.parse(parsed);
    expect(envelope).toMatchObject({ schemaVersion: 1, command: 'render', ok: true });
    expect(envelope.diagnostics).toEqual([]);
    expect(envelope.data).toMatchObject({
      output,
      format: 'mp4',
      width: 960,
      height: 540,
      frameCount: 60,
      fps: { numerator: 30, denominator: 1 },
    });
    expect(envelope.data?.durationSeconds).toBeCloseTo(2, 5);
    expect(statSync(output).size).toBeGreaterThan(0);

    const probed = ffprobe(output);
    expect(probed).toContain('codec_name=h264');
    expect(probed).toContain('width=960');
    expect(probed).toContain('height=540');
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
  }, 120_000);

  // `promo-ci` reaches only the first two scenes, so one still from each of the eight scenes of
  // the full promo proves every scene mounts and draws (the frames the README's stills loop uses).
  // The `three` scene draws WebGL, so the CLI gets `--software-webgl`: CI's Linux runner has no GPU.
  it('draws a still of every scene of the full promo', async () => {
    const scenes = placeScenes(promoStoryboard);
    const frames = [60, 170, 340, 520, 678, 818, 1185, 1301];
    expect(
      frames.map(
        (frame) => scenes.findLast((scene) => scene.startFrame + scene.enterFrames <= frame)?.kind,
      ),
    ).toEqual(scenes.map((scene) => scene.kind));

    const output = join(repositoryRoot, 'out', 'examples', 'promo-stills');
    mkdirSync(output, { recursive: true });
    const { stdout } = await execFileAsync(
      process.execPath,
      [
        cli,
        'frame',
        'examples/promo/entry.tsx',
        '--composition',
        'promo',
        '--frame',
        frames.join(','),
        '--software-webgl',
        '--out',
        output,
        '--json',
      ],
      { cwd: repositoryRoot, timeout: 120_000, maxBuffer: 16 * 1024 * 1024 },
    );
    const parsed: unknown = JSON.parse(stdout);
    const envelope = frameEnvelopeSchema.parse(parsed);
    expect(envelope).toMatchObject({ schemaVersion: 1, command: 'frame', ok: true });
    expect(envelope.diagnostics).toEqual([]);
    expect(envelope.data?.frames).toEqual(
      frames.map((frame) => ({
        output: join(output, `frame-${String(frame).padStart(5, '0')}.png`),
        frame,
        width: 1920,
        height: 1080,
      })),
    );
    for (const frame of envelope.data?.frames ?? [])
      expect(statSync(frame.output).size).toBeGreaterThan(0);
  }, 120_000);
});
