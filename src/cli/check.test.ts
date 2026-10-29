import { Ajv2020 } from 'ajv/dist/2020.js';
import { execFile } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import committedSchema from '../../docs/contexts/agent/schema/cli-output.v1.schema.json' with { type: 'json' };
import { EnvelopeSchema, type Envelope } from '../agent/cli-output.ts';
import { runCli } from './cli.ts';

const require = createRequire(import.meta.url);
const execFileAsync = promisify(execFile);
const bin = new URL('./main.js', import.meta.url).pathname;
const validateJson = new Ajv2020({ strictTypes: false }).compile(committedSchema);
const fixtureModule = new URL('../render/check/fixtures/traversal.tsx', import.meta.url).pathname;
const registryModule = new URL('../core/composition/registry.ts', import.meta.url).pathname;

let projectRoot: string;

beforeAll(() => {
  projectRoot = mkdtempSync(join(tmpdir(), 'motion-kit-check-cli-'));
  mkdirSync(join(projectRoot, 'node_modules'));
  for (const name of ['react', 'react-dom', 'zod'])
    symlinkSync(
      dirname(require.resolve(`${name}/package.json`)),
      join(projectRoot, 'node_modules', name),
    );
  writeFileSync(join(projectRoot, 'package.json'), '{"type":"module"}');
  writeFileSync(
    join(projectRoot, 'entry.tsx'),
    `export {compositions} from ${JSON.stringify(fixtureModule)};`,
  );
  // A range too long to sweep: the checker must read `frameCount` from the descriptor and
  // capture only the sampled frames, never the whole video.
  writeFileSync(
    join(projectRoot, 'entry-long.tsx'),
    `import { z } from 'zod';
import { defineComposition, defineCompositions } from ${JSON.stringify(registryModule)};
const Scene = () => <div style={{ width: 160, height: 90, background: '#123456' }} />;
export const compositions = defineCompositions([
  defineComposition({ id: 'long', schema: z.object({}), component: Scene, width: 160, height: 90, fps: { numerator: 30, denominator: 1 }, durationInFrames: 600 }),
]);`,
  );
});

afterAll(() => {
  rmSync(projectRoot, { recursive: true, force: true });
});

type RunResult = {
  readonly code: number;
  readonly envelope?: Envelope;
  readonly stdout: string;
  readonly stderr: string;
};

/** Runs `runCli` in-process, capturing the one document and the human diagnostics. */
const runDirect = async (
  argv: readonly string[],
  options: { readonly signal?: AbortSignal } = {},
): Promise<RunResult> => {
  let stdout = '';
  let stderr = '';
  const out = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
    stdout += String(chunk);
    return true;
  });
  const err = vi.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array) => {
    stderr += String(chunk);
    return true;
  });
  try {
    const code = await runCli(argv, options.signal === undefined ? {} : { signal: options.signal });
    const trimmed = stdout.trim();
    const envelope =
      argv.includes('--json') && trimmed !== ''
        ? EnvelopeSchema.parse(JSON.parse(trimmed))
        : undefined;
    return { code, envelope, stdout, stderr };
  } finally {
    out.mockRestore();
    err.mockRestore();
  }
};

/** Runs the shipped bin from the temporary project. */
const runBin = async (
  args: readonly string[],
  options: { readonly envelope?: false } = {},
): Promise<RunResult> => {
  let stdout = '';
  let stderr = '';
  let code = 0;
  try {
    const result = await execFileAsync(process.execPath, [bin, ...args], {
      cwd: projectRoot,
      timeout: 120_000,
      maxBuffer: 64 * 1024 * 1024,
    });
    stdout = result.stdout;
    stderr = result.stderr;
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
      'stderr' in error &&
      typeof error.stderr === 'string'
    )
      stderr = error.stderr;
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
    options.envelope !== false && args.includes('--json') && trimmed !== ''
      ? EnvelopeSchema.parse(JSON.parse(trimmed))
      : undefined;
  return { code, envelope, stdout, stderr };
};

const assertValidEnvelope = (result: RunResult): Envelope => {
  const envelope = result.envelope;
  expect(envelope).toBeDefined();
  if (envelope === undefined) throw new Error('Envelope missing');
  expect(validateJson(envelope)).toBe(true);
  return envelope;
};

const checkArgs = (args: readonly string[]): string[] => [
  'check',
  'entry.tsx',
  '--project-root',
  projectRoot,
  ...args,
];

describe('check CLI with the traversal fixture', () => {
  it('passes the frame-independent fixture and emits a valid v1 envelope', async () => {
    const result = await runDirect(
      checkArgs(['--composition', 'traversal-fixed', '--frame', '2,6', '--json']),
    );
    expect(result.code).toBe(0);
    const envelope = assertValidEnvelope(result);
    expect(envelope).toMatchObject({
      schemaVersion: 1,
      command: 'check',
      ok: true,
      diagnostics: [],
    });
    if (envelope.command !== 'check' || envelope.data === null)
      throw new Error('expected check data');
    expect(envelope.data).toMatchObject({
      format: 'check',
      composition: 'traversal-fixed',
      width: 160,
      height: 90,
      frameCount: 12,
    });
    expect(envelope.data.samples.map((sample) => sample.frame)).toEqual([2, 6]);
    for (const sample of envelope.data.samples)
      expect(sample.histories[0]).toMatchObject({
        history: 'cold',
        predecessor: null,
        status: 'reference',
        difference: null,
      });
    expect(result.stdout.trim().split('\n')).toHaveLength(1);
  }, 180_000);

  it('fails the traversal-dependent fixture with check.frame-differs and retains data', async () => {
    const result = await runDirect(
      checkArgs(['--composition', 'traversal-dependent', '--frame', '2,6', '--json']),
    );
    expect(result.code).toBe(1);
    const envelope = assertValidEnvelope(result);
    expect(envelope).toMatchObject({ command: 'check', ok: false });
    expect(envelope.data).not.toBeNull();
    const diagnostic = envelope.diagnostics.find((item) => item.code === 'check.frame-differs');
    if (diagnostic === undefined) throw new Error('expected a check.frame-differs diagnostic');
    expect([2, 6]).toContain(diagnostic.location?.frame);
    const details = diagnostic.details as
      | { histories?: readonly { history?: string; status?: string }[] }
      | undefined;
    expect(details?.histories?.length).toBeGreaterThan(0);
    for (const history of details?.histories ?? []) {
      expect(history.status).toBe('differs');
      expect(history.history).not.toBe('cold');
    }
    expect(
      details?.histories?.some((history) =>
        ['after-earlier', 'after-later', 'pool'].includes(history.history ?? ''),
      ),
    ).toBe(true);
    if (envelope.command !== 'check' || envelope.data === null)
      throw new Error('expected retained check data');
    expect(envelope.data.samples).toHaveLength(2);
    expect(result.stdout.trim().split('\n')).toHaveLength(1);
  }, 180_000);

  it('prints the dependent fixture failure on stderr without --json', async () => {
    const result = await runDirect(
      checkArgs([
        '--composition',
        'traversal-dependent',
        '--frame',
        '2',
        '--predecessor',
        '1',
        '--history',
        'after-earlier',
      ]),
    );
    expect(result.code).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('check.frame-differs');
    expect(result.stderr).toContain('frame 2 differs in after-earlier');
  }, 180_000);

  it('fails the dependent fixture under --exact with an exact difference', async () => {
    const result = await runDirect(
      checkArgs([
        '--composition',
        'traversal-dependent',
        '--frame',
        '6',
        '--predecessor',
        '5',
        '--history',
        'after-earlier',
        '--exact',
        '--json',
      ]),
    );
    expect(result.code).toBe(1);
    const envelope = assertValidEnvelope(result);
    expect(envelope).toMatchObject({ command: 'check', ok: false });
    const diagnostic = envelope.diagnostics.find((item) => item.code === 'check.frame-differs');
    const details = diagnostic?.details as
      | {
          histories?: readonly {
            history?: string;
            difference?: { mode?: string } | null;
          }[];
        }
      | undefined;
    expect(details?.histories?.[0]).toMatchObject({
      history: 'after-earlier',
      difference: { mode: 'exact' },
    });
    if (envelope.command !== 'check' || envelope.data === null)
      throw new Error('expected retained check data');
    expect(envelope.data.comparison).toEqual({ mode: 'exact' });
  }, 180_000);

  it('emits the same check envelope through the shipped bin', async () => {
    const result = await runBin([
      'check',
      'entry.tsx',
      '--composition',
      'traversal-fixed',
      '--frame',
      '2',
      '--predecessor',
      '1',
      '--history',
      'after-earlier',
      '--json',
    ]);
    expect(result.code).toBe(0);
    const envelope = assertValidEnvelope(result);
    expect(envelope).toMatchObject({ command: 'check', ok: true, diagnostics: [] });
    if (envelope.command !== 'check' || envelope.data === null)
      throw new Error('expected check data');
    expect(envelope.data.samples[0]).toMatchObject({
      frame: 2,
      histories: [
        { history: 'cold', predecessor: null, status: 'reference' },
        { history: 'after-earlier', predecessor: 1, status: 'identical' },
      ],
    });
    expect(result.stdout.trim().split('\n')).toHaveLength(1);
  }, 180_000);

  it('plans first and last frame samples without an impossible history', async () => {
    const result = await runDirect(
      checkArgs(['--composition', 'traversal-fixed', '--frame', '0,11', '--json']),
    );
    expect(result.code).toBe(0);
    const envelope = assertValidEnvelope(result);
    if (envelope.command !== 'check' || envelope.data === null)
      throw new Error('expected check data');
    const [first, last] = envelope.data.samples;
    const histories = (sample: typeof first): string[] =>
      (sample?.histories ?? []).map((history) => history.history);
    // Frame 0 has no earlier frame, so after-earlier cannot run; frame 11 has no later frame.
    expect(histories(first)).toEqual(['cold', 'after-later', 'pool']);
    expect(histories(last)).toEqual(['cold', 'after-earlier', 'pool']);
    expect(histories(first)).not.toContain('after-earlier');
    expect(histories(last)).not.toContain('after-later');
    expect(first?.histories.every((history) => history.status !== 'differs')).toBe(true);
    expect(last?.histories.every((history) => history.status !== 'differs')).toBe(true);
  }, 180_000);

  it('uses an explicit predecessor and drops the default neighbours', async () => {
    const result = await runDirect(
      checkArgs([
        '--composition',
        'traversal-fixed',
        '--frame',
        '3',
        '--predecessor',
        '9',
        '--json',
      ]),
    );
    expect(result.code).toBe(0);
    const envelope = assertValidEnvelope(result);
    if (envelope.command !== 'check' || envelope.data === null)
      throw new Error('expected check data');
    expect(
      envelope.data.samples[0]?.histories.map((history) => ({
        history: history.history,
        predecessor: history.predecessor,
      })),
    ).toEqual([
      { history: 'cold', predecessor: null },
      { history: 'after-later', predecessor: 9 },
      { history: 'pool', predecessor: 1 },
    ]);
  }, 180_000);

  it('reports the pool actual predecessor when the requested one is later than the sample', async () => {
    const result = await runDirect(
      checkArgs([
        '--composition',
        'traversal-fixed',
        '--frame',
        '2',
        '--predecessor',
        '3',
        '--json',
      ]),
    );
    expect(result.code).toBe(0);
    const envelope = assertValidEnvelope(result);
    if (envelope.command !== 'check' || envelope.data === null)
      throw new Error('expected check data');
    expect(
      envelope.data.samples[0]?.histories.map((history) => ({
        history: history.history,
        predecessor: history.predecessor,
      })),
    ).toEqual([
      { history: 'cold', predecessor: null },
      { history: 'after-later', predecessor: 3 },
      { history: 'pool', predecessor: 0 },
    ]);
  }, 180_000);

  it('reports no pool predecessor when the sample is below frame 2', async () => {
    const result = await runDirect(
      checkArgs(['--composition', 'traversal-fixed', '--frame', '1', '--json']),
    );
    expect(result.code).toBe(0);
    const envelope = assertValidEnvelope(result);
    if (envelope.command !== 'check' || envelope.data === null)
      throw new Error('expected check data');
    const pool = envelope.data.samples[0]?.histories.find((history) => history.history === 'pool');
    expect(pool).toMatchObject({ history: 'pool', predecessor: null });
  }, 180_000);

  it('exits 1 with composition.props-invalid for an out-of-range frame', async () => {
    const result = await runDirect(
      checkArgs(['--composition', 'traversal-fixed', '--frame', '99', '--json']),
    );
    expect(result.code).toBe(1);
    const envelope = assertValidEnvelope(result);
    expect(envelope).toMatchObject({
      command: 'check',
      ok: false,
      data: null,
      diagnostics: [{ code: 'composition.props-invalid', location: { frame: 99 } }],
    });
  }, 180_000);

  it('reports a requested history the frame cannot support', async () => {
    const result = await runDirect(
      checkArgs([
        '--composition',
        'traversal-fixed',
        '--frame',
        '0',
        '--history',
        'after-earlier',
        '--json',
      ]),
    );
    expect(result.code).toBe(1);
    const envelope = assertValidEnvelope(result);
    expect(envelope).toMatchObject({ command: 'check', ok: false });
    const diagnostic = envelope.diagnostics.find((item) => item.code === 'check.history-not-run');
    expect(diagnostic).toMatchObject({
      severity: 'error',
      location: { frame: 0 },
      details: { history: 'after-earlier', reason: 'no-valid-predecessor' },
    });
    expect(envelope.data).not.toBeNull();
  }, 180_000);

  it('emits no document and exits 130 when the caller cancels', async () => {
    const result = await runDirect(
      checkArgs(['--composition', 'traversal-fixed', '--frame', '2', '--json']),
      { signal: AbortSignal.abort() },
    );
    expect(result.code).toBe(130);
    expect(result.stdout).toBe('');
  }, 30_000);

  it('samples a long composition without sweeping its frame range', async () => {
    const result = await runDirect([
      'check',
      'entry-long.tsx',
      '--project-root',
      projectRoot,
      '--composition',
      'long',
      '--frame',
      '320',
      '--predecessor',
      '300',
      '--history',
      'after-earlier',
      '--json',
    ]);
    expect(result.code).toBe(0);
    const envelope = assertValidEnvelope(result);
    expect(envelope).toMatchObject({ command: 'check', ok: true });
    if (envelope.command !== 'check' || envelope.data === null)
      throw new Error('expected check data');
    expect(envelope.data.frameCount).toBe(600);
    expect(envelope.data.samples.map((sample) => sample.frame)).toEqual([320]);
    expect(envelope.data.samples[0]?.histories.map((history) => history.history)).toEqual([
      'cold',
      'after-earlier',
    ]);
  }, 180_000);
});
