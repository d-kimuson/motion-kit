import { Ajv2020 } from 'ajv/dist/2020.js';
import { execFile, execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import committedSchema from '../../docs/contexts/agent/schema/cli-output.v1.schema.json' with { type: 'json' };
import { EnvelopeSchema, type Envelope } from '../agent/cli-output.ts';

const require = createRequire(import.meta.url);
const execFileAsync = promisify(execFile);
// The shipped bin, exercised as the entry script with plain Node.
const bin = new URL('./main.js', import.meta.url).pathname;
const validateJson = new Ajv2020({ strictTypes: false }).compile(committedSchema);

let projectRoot: string;
let outputRoot: string;

beforeAll(() => {
  projectRoot = mkdtempSync(join(tmpdir(), 'motion-kit-cli-'));
  outputRoot = mkdtempSync(join(tmpdir(), 'motion-kit-cli-output-'));
  mkdirSync(join(projectRoot, 'node_modules'));
  for (const name of ['react', 'react-dom', 'zod'])
    symlinkSync(
      dirname(require.resolve(`${name}/package.json`)),
      join(projectRoot, 'node_modules', name),
    );
  writeFileSync(join(projectRoot, 'package.json'), '{"type":"module"}');
  writeFileSync(
    join(projectRoot, 'entry.ts'),
    `export {compositions} from ${JSON.stringify(
      new URL('../core/runtime/fixtures/capture.tsx', import.meta.url).pathname,
    )};`,
  );
  writeFileSync(
    join(projectRoot, 'entry-required.tsx'),
    `import { defineComposition, defineCompositions } from ${JSON.stringify(
      new URL('../core/composition/registry.ts', import.meta.url).pathname,
    )};
import { z } from 'zod';
const Scene = ({ text }: { text: string }) => <div>{text}</div>;
export const compositions = defineCompositions([
  defineComposition({ id: 'one', schema: z.object({ text: z.string().default('hello') }), component: Scene, width: 32, height: 32, fps: { numerator: 30, denominator: 1 }, durationInFrames: 3 }),
  defineComposition({ id: 'two', schema: z.object({ text: z.string() }), component: Scene, width: 32, height: 32, fps: { numerator: 30, denominator: 1 }, durationInFrames: 3 }),
]);`,
  );
});

afterAll(() => {
  rmSync(projectRoot, { recursive: true, force: true });
  rmSync(outputRoot, { recursive: true, force: true });
});

type RunResult = { readonly code: number; readonly envelope?: Envelope; readonly stdout: string };

const run = async (args: readonly string[], env?: Record<string, string>): Promise<RunResult> => {
  let stdout = '';
  let code = 0;
  try {
    const result = await execFileAsync(process.execPath, [bin, ...args], {
      cwd: projectRoot,
      timeout: 120_000,
      maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env, ...env },
    });
    stdout = result.stdout;
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'stdout' in error &&
      typeof error.stdout === 'string'
    )
      stdout = error.stdout;
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      typeof error.code === 'number'
    )
      code = error.code;
  }
  const trimmed = stdout.trim();
  const envelope =
    args.includes('--json') && trimmed !== ''
      ? EnvelopeSchema.parse(JSON.parse(trimmed))
      : undefined;
  return { code, envelope, stdout };
};

const assertValidEnvelope = (result: RunResult): Envelope => {
  const envelope = result.envelope;
  expect(envelope).toBeDefined();
  if (envelope === undefined) throw new Error('Envelope missing');
  expect(validateJson(envelope)).toBe(true);
  return envelope;
};

describe('motion-kit CLI', () => {
  it('captures one frame to a PNG with the v1 frame envelope', async () => {
    const output = join(outputRoot, 'frame.png');
    const result = await run([
      'frame',
      'entry.ts',
      '--composition',
      'one',
      '--frame',
      '2',
      '--out',
      output,
      '--json',
    ]);
    expect(result.code).toBe(0);
    const envelope = assertValidEnvelope(result);
    expect(envelope).toMatchObject({
      schemaVersion: 1,
      command: 'frame',
      ok: true,
      diagnostics: [],
      data: { output, format: 'png', frame: 2, width: 64, height: 64 },
    });
    expect(statSync(output).isFile()).toBe(true);
    expect(readFileSync(output).length).toBeGreaterThan(0);
  }, 60_000);

  it('renders a frame sequence and manifest with the v1 render envelope', async () => {
    const output = join(outputRoot, 'frames');
    const result = await run([
      'render',
      'entry.ts',
      '--composition',
      'one',
      '--out',
      output,
      '--json',
    ]);
    expect(result.code).toBe(0);
    const envelope = assertValidEnvelope(result);
    expect(envelope).toMatchObject({
      schemaVersion: 1,
      command: 'render',
      ok: true,
      data: { output, format: 'frames', frameCount: 6, width: 64, height: 64 },
    });
    if (envelope.command !== 'render') throw new Error('expected render envelope');
    const data = envelope.data;
    if (data === null || data.format !== 'frames') throw new Error('render data missing');
    expect(data.manifest).toBe(join(output, 'manifest.json'));
    expect(existsSync(data.manifest)).toBe(true);
    for (let frame = 0; frame < 6; frame++)
      expect(existsSync(join(output, `frame-${String(frame).padStart(5, '0')}.png`))).toBe(true);
  }, 60_000);

  it('renders a Composition to an MP4 with the v1 mp4 render envelope', async () => {
    const output = join(outputRoot, 'video.mp4');
    const result = await run([
      'render',
      'entry.ts',
      '--composition',
      'one',
      '--out',
      output,
      '--json',
    ]);
    expect(result.code).toBe(0);
    const envelope = assertValidEnvelope(result);
    expect(envelope).toMatchObject({
      schemaVersion: 1,
      command: 'render',
      ok: true,
      data: {
        output,
        format: 'mp4',
        frameCount: 6,
        width: 64,
        height: 64,
        fps: { numerator: 30000, denominator: 1001 },
      },
    });
    if (envelope.command !== 'render') throw new Error('expected render envelope');
    const data = envelope.data;
    if (data === null || data.format !== 'mp4') throw new Error('mp4 data missing');
    expect(data.durationSeconds).toBeCloseTo(6 / (30000 / 1001), 3);
    expect(statSync(output).size).toBeGreaterThan(0);
    // The temporary sibling is renamed onto the target, never left behind.
    expect(readdirSync(outputRoot).filter((name) => name.includes('.part'))).toEqual([]);
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
    expect(probed).toContain('nb_frames=6');
  }, 120_000);

  it('prints usage and exits 0 for --help', async () => {
    const result = await run(['--help']);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Usage: motion-kit');
  });

  it('prints a human summary instead of JSON when --json is absent', async () => {
    const output = join(outputRoot, 'human.png');
    const result = await run([
      'frame',
      'entry.ts',
      '--composition',
      'one',
      '--frame',
      '0',
      '--out',
      output,
    ]);
    expect(result.code).toBe(0);
    expect(result.stdout.trim()).not.toBe('');
    expect(() => {
      JSON.parse(result.stdout);
    }).toThrow('Unexpected token');
    expect(statSync(output).isFile()).toBe(true);
  }, 60_000);

  it('exits 2 with cli.entry-not-found for a missing entry file', async () => {
    const result = await run([
      'frame',
      'missing.ts',
      '--frame',
      '0',
      '--out',
      join(outputRoot, 'x.png'),
      '--json',
    ]);
    expect(result.code).toBe(2);
    const envelope = assertValidEnvelope(result);
    expect(envelope).toMatchObject({
      ok: false,
      data: null,
      diagnostics: [{ code: 'cli.entry-not-found', severity: 'error' }],
    });
  });

  it('exits 2 with cli.invalid-arguments and the ids in details when the id is omitted', async () => {
    const result = await run([
      'frame',
      'entry.ts',
      '--frame',
      '0',
      '--out',
      join(outputRoot, 'x.png'),
      '--json',
    ]);
    expect(result.code).toBe(2);
    const envelope = assertValidEnvelope(result);
    expect(envelope.ok).toBe(false);
    expect(envelope.diagnostics[0]?.code).toBe('cli.invalid-arguments');
    expect(envelope.diagnostics[0]?.details).toEqual({ ids: ['one', 'two'] });
  }, 60_000);

  it('exits 2 with cli.composition-not-found for an unknown id', async () => {
    const result = await run([
      'frame',
      'entry.ts',
      '--composition',
      'nope',
      '--frame',
      '0',
      '--out',
      join(outputRoot, 'x.png'),
      '--json',
    ]);
    expect(result.code).toBe(2);
    const envelope = assertValidEnvelope(result);
    expect(envelope).toMatchObject({
      ok: false,
      data: null,
      diagnostics: [{ code: 'cli.composition-not-found', severity: 'error' }],
    });
  }, 60_000);

  it('exits 1 with composition.props-invalid for props that fail the schema', async () => {
    const result = await run([
      'render',
      'entry.ts',
      '--composition',
      'one',
      '--props',
      '{"mode":"bogus"}',
      '--out',
      join(outputRoot, 'bad'),
      '--json',
    ]);
    expect(result.code).toBe(1);
    const envelope = assertValidEnvelope(result);
    expect(envelope).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'composition.props-invalid', severity: 'error' }],
    });
  }, 60_000);

  it('exits 1 with render.browser-launch-failed when Chromium is missing', async () => {
    const empty = mkdtempSync(join(tmpdir(), 'motion-kit-no-browser-'));
    try {
      const result = await run(
        [
          'frame',
          'entry.ts',
          '--composition',
          'one',
          '--frame',
          '0',
          '--out',
          join(outputRoot, 'x.png'),
          '--json',
        ],
        { PLAYWRIGHT_BROWSERS_PATH: empty },
      );
      expect(result.code).toBe(1);
      const envelope = assertValidEnvelope(result);
      expect(envelope).toMatchObject({
        ok: false,
        diagnostics: [{ code: 'render.browser-launch-failed', severity: 'error' }],
      });
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  }, 60_000);

  it('rejects an unknown flag with exit 2 and cli.invalid-arguments', async () => {
    const result = await run([
      'frame',
      'entry.ts',
      '--bogus',
      '--frame',
      '0',
      '--out',
      join(outputRoot, 'x.png'),
      '--json',
    ]);
    expect(result.code).toBe(2);
    const envelope = assertValidEnvelope(result);
    expect(envelope.ok).toBe(false);
    expect(envelope.diagnostics[0]?.code).toBe('cli.invalid-arguments');
  });

  it('renders a composition when an unselected sibling requires a prop', async () => {
    const result = await run([
      'frame',
      'entry-required.tsx',
      '--composition',
      'one',
      '--frame',
      '0',
      '--out',
      join(outputRoot, 'required-other.png'),
      '--json',
    ]);
    expect(result.code).toBe(0);
    const envelope = assertValidEnvelope(result);
    expect(envelope).toMatchObject({ ok: true, data: { format: 'png', frame: 0 } });
    expect(statSync(join(outputRoot, 'required-other.png')).isFile()).toBe(true);
  }, 60_000);

  it('renders a selected required-prop composition when the prop is supplied', async () => {
    const result = await run([
      'render',
      'entry-required.tsx',
      '--composition',
      'two',
      '--props',
      '{"text":"x"}',
      '--out',
      join(outputRoot, 'required-frames'),
      '--json',
    ]);
    expect(result.code).toBe(0);
    const envelope = assertValidEnvelope(result);
    expect(envelope).toMatchObject({ ok: true, data: { frameCount: 3 } });
  }, 60_000);

  it('rejects a selected required-prop composition without the prop', async () => {
    const result = await run([
      'frame',
      'entry-required.tsx',
      '--composition',
      'two',
      '--frame',
      '0',
      '--out',
      join(outputRoot, 'required-missing.png'),
      '--json',
    ]);
    expect(result.code).toBe(1);
    const envelope = assertValidEnvelope(result);
    expect(envelope).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'composition.props-invalid', location: { compositionId: 'two' } }],
    });
  }, 60_000);

  it('renders full sequences with output inside the project root several times', async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const output = join(projectRoot, `frames-in-root-${attempt}`);
      const result = await run([
        'render',
        'entry.ts',
        '--composition',
        'one',
        '--out',
        output,
        '--json',
      ]);
      expect(result.code).toBe(0);
      const envelope = assertValidEnvelope(result);
      expect(envelope).toMatchObject({ ok: true, data: { frameCount: 6 } });
      for (let frame = 0; frame < 6; frame++)
        expect(existsSync(join(output, `frame-${String(frame).padStart(5, '0')}.png`))).toBe(true);
      expect(existsSync(join(output, 'manifest.json'))).toBe(true);
    }
  }, 120_000);
});
