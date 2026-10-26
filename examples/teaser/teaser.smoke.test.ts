import { execFile, execFileSync } from 'node:child_process';
import { mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { compositions as teaserCompositions } from './entry.tsx';
import { compositions as probeCompositions } from './probe.tsx';

const execFileAsync = promisify(execFile);

// Every command runs from the repository root: the CLI's projectRoot is process.cwd(), and React,
// ReactDOM and Zod resolve against it (docs/design-doc/20261025-reference-examples.md, "Running an
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

describe('teaser example', () => {
  it('declares the full teaser, its CI twin and its probe at the documented sizes', () => {
    expect(teaserCompositions.ok).toBe(true);
    expect(probeCompositions.ok).toBe(true);
    if (!teaserCompositions.ok || !probeCompositions.ok) return;
    const descriptors = teaserCompositions.value.listCompositions();
    expect(descriptors.map((item) => item.id)).toEqual(['teaser', 'teaser-ci']);
    const [full, ci] = descriptors;
    // 1920x1080 at 30 fps for 450-900 frames (15-30 s): a local QA Check, never rendered in CI.
    expect(full).toMatchObject({ width: 1920, height: 1080, durationInFrames: 720 });
    expect(full?.fps).toEqual({ numerator: 30, denominator: 1 });
    expect(full?.durationInFrames).toBeGreaterThanOrEqual(450);
    expect(full?.durationInFrames).toBeLessThanOrEqual(900);
    // The CI twin is half linear resolution and exactly 60 frames, per the CI policy.
    expect(ci).toMatchObject({ width: 960, height: 540, durationInFrames: 60 });
    expect(probeCompositions.value.listCompositions()).toMatchObject([
      { id: 'teaser-probe', width: 480, height: 270, durationInFrames: 30 },
    ]);
  });

  it('renders teaser-ci through the CLI as a 60-frame 960x540 MP4 that decodes clean', async () => {
    const output = join(repositoryRoot, 'out', 'examples', 'teaser-ci.mp4');
    mkdirSync(join(repositoryRoot, 'out', 'examples'), { recursive: true });
    const { stdout } = await execFileAsync(
      process.execPath,
      [
        cli,
        'render',
        'examples/teaser/entry.tsx',
        '--composition',
        'teaser-ci',
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
});
