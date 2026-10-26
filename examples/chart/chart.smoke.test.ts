import { execFile, execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { chartProps, compositions as chartCompositions } from './entry.tsx';
import { compositions as probeCompositions } from './probe.tsx';

const execFileAsync = promisify(execFile);

// Every command runs from the repository root: the CLI's projectRoot is process.cwd(), and React,
// ReactDOM and Zod resolve against it (docs/design-doc/20261025-reference-examples.md, "Running an
// example"). `pnpm test` builds dist/ first, so the shipped CLI is the thing under test.
const repositoryRoot = new URL('../../', import.meta.url).pathname;
const cli = join(repositoryRoot, 'dist', 'cli.js');
const secondDataset = join(repositoryRoot, 'examples', 'chart', 'data', 'index-20y.json');
const firstDataset = join(repositoryRoot, 'examples', 'chart', 'data', 'index-30y.json');

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

// A failed render carries the diagnostic and its path: this example's whole point is that the props
// schema, not the component, is what rejects a missing `series`.
const failureEnvelopeSchema = z.object({
  schemaVersion: z.literal(1),
  command: z.literal('render'),
  ok: z.literal(false),
  data: z.null(),
  diagnostics: z.array(
    z.object({
      code: z.string(),
      severity: z.string(),
      details: z
        .object({
          issues: z.array(z.object({ path: z.array(z.union([z.string(), z.number()])) })),
        })
        .optional(),
    }),
  ),
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

describe('chart example', () => {
  it('declares the full chart, its CI twin and its probe at the documented sizes', () => {
    expect(chartCompositions.ok).toBe(true);
    expect(probeCompositions.ok).toBe(true);
    if (!chartCompositions.ok || !probeCompositions.ok) return;
    const descriptors = chartCompositions.value.listCompositions();
    expect(descriptors.map((item) => item.id)).toEqual(['chart', 'chart-ci']);
    const [full, ci] = descriptors;
    // 1920x1080 at 30 fps for 600 frames (20 s): a local QA Check, never rendered in CI.
    expect(full).toMatchObject({ width: 1920, height: 1080, durationInFrames: 600 });
    expect(full?.fps).toEqual({ numerator: 30, denominator: 1 });
    // The CI twin is half linear resolution and exactly 60 frames, per the CI policy.
    expect(ci).toMatchObject({ width: 960, height: 540, durationInFrames: 60 });
    expect(probeCompositions.value.listCompositions()).toMatchObject([
      { id: 'chart-probe', width: 480, height: 270, durationInFrames: 30 },
    ]);
  });

  it('accepts both committed datasets and defaults the fields they omit', () => {
    for (const file of [firstDataset, secondDataset]) {
      const parsed = chartProps.safeParse(JSON.parse(readFileSync(file, 'utf8')));
      expect(parsed.success).toBe(true);
    }
    const thirtyYear = chartProps.parse(JSON.parse(readFileSync(firstDataset, 'utf8')));
    // 1995-2024: the from/to range is derived from the points, never declared twice.
    expect(thirtyYear.series[0]?.points[0]?.year).toBe(1995);
    expect(thirtyYear.series[0]?.points.at(-1)?.year).toBe(2024);
    expect(thirtyYear.series[0]?.points).toHaveLength(30);
    const twentyYear = chartProps.parse(JSON.parse(readFileSync(secondDataset, 'utf8')));
    expect(twentyYear.series[0]?.points[0]?.year).toBe(2005);
    expect(twentyYear.series[0]?.points).toHaveLength(20);
    // `title`, `unit` and `source` default; `series` does not, so a bare object is invalid at its path.
    const seriesOnly = chartProps.parse({
      series: [
        {
          label: 'x',
          points: [
            { year: 2000, value: 1 },
            { year: 2001, value: 2 },
          ],
        },
      ],
    });
    expect(seriesOnly).toMatchObject({
      title: '30 years of an index',
      unit: 'index points',
      source: '',
    });
    const missing = chartProps.safeParse({ title: 'no series' });
    expect(missing.success).toBe(false);
    expect(missing.error?.issues[0]?.path).toEqual(['series']);
  });

  it('rejects a render that omits the required series through composition.props-invalid', () => {
    const result = spawnSync(
      process.execPath,
      [
        cli,
        'render',
        'examples/chart/entry.tsx',
        '--composition',
        'chart',
        '--out',
        join(repositoryRoot, 'out', 'examples', 'chart-no-props.mp4'),
        '--json',
      ],
      { cwd: repositoryRoot, encoding: 'utf8', timeout: 120_000 },
    );
    expect(result.status).toBe(1);
    const envelope = failureEnvelopeSchema.parse(JSON.parse(result.stdout));
    expect(envelope.diagnostics[0]).toMatchObject({
      code: 'composition.props-invalid',
      severity: 'error',
      details: { issues: [{ path: ['series'] }] },
    });
  }, 120_000);

  it('renders chart-ci with the second dataset as a 60-frame 960x540 MP4 that decodes clean', async () => {
    const output = join(repositoryRoot, 'out', 'examples', 'chart-ci.mp4');
    mkdirSync(join(repositoryRoot, 'out', 'examples'), { recursive: true });
    const { stdout } = await execFileAsync(
      process.execPath,
      [
        cli,
        'render',
        'examples/chart/entry.tsx',
        '--composition',
        'chart-ci',
        '--props',
        readFileSync(secondDataset, 'utf8'),
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
