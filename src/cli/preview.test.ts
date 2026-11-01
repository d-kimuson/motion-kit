import { Ajv2020 } from 'ajv/dist/2020.js';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import committedSchema from '../../docs/contexts/agent/schema/cli-output.v1.schema.json' with { type: 'json' };
import { EnvelopeSchema, type Envelope } from '../agent/cli-output.ts';
import { parsePreviewQuery } from '../preview/query.ts';
import { runCli } from './cli.ts';

const require = createRequire(import.meta.url);
const bin = new URL('./main.js', import.meta.url).pathname;
const validateJson = new Ajv2020({ strictTypes: false }).compile(committedSchema);
const registryModule = new URL('../core/composition/registry.ts', import.meta.url).pathname;

let projectRoot: string;

beforeAll(() => {
  projectRoot = mkdtempSync(join(tmpdir(), 'motion-kit-preview-cli-'));
  mkdirSync(join(projectRoot, 'node_modules'));
  for (const name of ['react', 'react-dom', 'zod'])
    symlinkSync(
      dirname(require.resolve(`${name}/package.json`)),
      join(projectRoot, 'node_modules', name),
    );
  writeFileSync(join(projectRoot, 'package.json'), '{"type":"module"}');
  writeFileSync(
    join(projectRoot, 'entry.tsx'),
    `import { z } from 'zod';
import { defineComposition, defineCompositions } from ${JSON.stringify(registryModule)};
const Scene = ({ text }: { text: string }) => <div>{text}</div>;
export const compositions = defineCompositions([
  defineComposition({ id: 'one', schema: z.object({ text: z.string().default('hello') }), component: Scene, width: 32, height: 32, fps: { numerator: 30, denominator: 1 }, durationInFrames: 3 }),
]);`,
  );
});

afterAll(() => {
  rmSync(projectRoot, { recursive: true, force: true });
});

type Output = { stdout: string; stderr: string };

/** Captures what `runCli` writes while `body` runs; the run itself may outlive the capture. */
const capture = (): Output & { restore: () => void } => {
  const output = { stdout: '', stderr: '' };
  const out = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
    output.stdout += String(chunk);
    return true;
  });
  const err = vi.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array) => {
    output.stderr += String(chunk);
    return true;
  });
  return Object.assign(output, {
    restore: () => {
      out.mockRestore();
      err.mockRestore();
    },
  });
};

const envelopeOf = (stdout: string): Envelope => {
  const value: unknown = JSON.parse(stdout.trim());
  expect(validateJson(value)).toBe(true);
  return EnvelopeSchema.parse(value);
};

/** Resolves once `read()` returns a value, polling the way a caller watches stdout. */
const until = async <T>(read: () => T | undefined, timeoutMs = 60_000): Promise<T> => {
  const deadline = process.hrtime.bigint() + BigInt(timeoutMs) * 1_000_000n;
  for (;;) {
    const value = read();
    if (value !== undefined) return value;
    if (process.hrtime.bigint() > deadline) throw new Error('Timed out waiting for the preview');
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
};

const runToEnd = async (argv: readonly string[], signal?: AbortSignal) => {
  const output = capture();
  try {
    const code = await runCli(argv, signal === undefined ? {} : { signal });
    return { code, ...output };
  } finally {
    output.restore();
  }
};

describe('motion-kit preview', () => {
  it('announces readiness with the host URL carrying the selection, then serves until stopped', async () => {
    const controller = new AbortController();
    const output = capture();
    try {
      const run = runCli(
        [
          'preview',
          join(projectRoot, 'entry.tsx'),
          '--project-root',
          projectRoot,
          '--composition',
          'one',
          '--props',
          '{"text":"hi"}',
          '--preview-fps',
          '8',
          '--json',
        ],
        { signal: controller.signal },
      );
      const stdout = await until(() => (output.stdout.includes('\n') ? output.stdout : undefined));
      const envelope = envelopeOf(stdout);
      expect(envelope).toMatchObject({
        command: 'preview',
        ok: true,
        diagnostics: [],
        data: { format: 'preview' },
      });
      const data = envelope.command === 'preview' ? envelope.data : null;
      const url = new URL(data?.url ?? '');
      expect(url.hostname).toBe('127.0.0.1');
      expect(parsePreviewQuery(url.search)).toEqual({
        ok: true,
        value: { compositionId: 'one', props: { text: 'hi' }, fps: 8 },
      });
      const page = await fetch(url);
      expect(page.status).toBe(200);
      expect(await page.text()).toContain('motion-kit-preview');

      controller.abort('SIGINT');
      // Stopping a preview that is serving is its normal end, not a cancellation.
      expect(await run).toBe(0);
      expect(output.stderr).not.toContain('aborted');
      await expect(fetch(url)).rejects.toThrow('fetch failed');
    } finally {
      output.restore();
    }
  });

  it('ends a run stopped before readiness as a cancellation', async () => {
    const controller = new AbortController();
    controller.abort('SIGTERM');
    const result = await runToEnd(
      ['preview', join(projectRoot, 'entry.tsx'), '--project-root', projectRoot, '--json'],
      controller.signal,
    );
    expect(result.code).toBe(143);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('preview aborted; nothing is being served\n');
  });

  it('exits 2 with cli.entry-not-found for a missing entry', async () => {
    const result = await runToEnd([
      'preview',
      'missing.tsx',
      '--project-root',
      projectRoot,
      '--json',
    ]);
    expect(result.code).toBe(2);
    expect(envelopeOf(result.stdout)).toMatchObject({
      command: 'preview',
      ok: false,
      data: null,
      diagnostics: [{ code: 'cli.entry-not-found' }],
    });
  });

  it.each([
    ['--preview-fps', '0', 'Use --preview-fps with an integer from 1 to 60.'],
    ['--preview-fps', '61', 'Use --preview-fps with an integer from 1 to 60.'],
    ['--preview-fps', '1.5', 'Use --preview-fps with an integer from 1 to 60.'],
    ['--port', '65536', 'Use --port with an integer from 0 to 65535.'],
    ['--port', 'http', 'Use --port with an integer from 0 to 65535.'],
  ])('exits 2 with cli.invalid-arguments for %s %s', async (flag, value, hint) => {
    const result = await runToEnd(['preview', 'entry.tsx', flag, value, '--json']);
    expect(result.code).toBe(2);
    expect(envelopeOf(result.stdout)).toMatchObject({
      command: 'preview',
      ok: false,
      diagnostics: [{ code: 'cli.invalid-arguments', hint }],
    });
  });

  it('prints the URL for a person and exits 0 on SIGINT through the shipped bin', async () => {
    const child = spawn(process.execPath, [bin, 'preview', 'entry.tsx'], { cwd: projectRoot });
    const output = { stdout: '', stderr: '' };
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      output.stdout += chunk;
    });
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
      output.stderr += chunk;
    });
    const exit = new Promise<number | null>((resolve) => child.once('exit', resolve));
    try {
      const line = await until(() => /serving (\S+) \(Ctrl-C to stop\)/u.exec(output.stdout)?.[1]);
      expect((await fetch(line)).status).toBe(200);
      child.kill('SIGINT');
      expect(await exit).toBe(0);
      expect(output.stderr).not.toContain('aborted');
    } finally {
      child.kill('SIGKILL');
    }
  });
});
