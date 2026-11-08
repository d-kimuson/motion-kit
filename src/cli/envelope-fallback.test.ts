import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ inspect: vi.fn() }));
vi.mock('../render/inspect/inspect.ts', () => ({ inspectComposition: mocks.inspect }));

import { runCli } from './cli.ts';

const directory = mkdtempSync(join(tmpdir(), 'motion-kit-fallback-'));
afterEach(() => {
  vi.restoreAllMocks();
});

it('turns data that breaks the envelope contract into one internal.unexpected envelope', async () => {
  writeFileSync(join(directory, 'entry.ts'), '');
  // A fractional frame is a bug in whatever produced the report: the schema only allows integers.
  mocks.inspect.mockResolvedValue({
    ok: true,
    value: {
      composition: {
        id: 'broken',
        width: 16,
        height: 16,
        fps: { numerator: 30, denominator: 1 },
        durationInFrames: 30,
        durationSeconds: 1,
      },
      sequences: [
        {
          name: 'a',
          path: ['a'],
          startFrame: 1.5,
          endFrame: 3,
          startSeconds: 0.05,
          endSeconds: 0.1,
        },
      ],
      audio: [],
    },
  });
  const stdout: string[] = [];
  const stderr: string[] = [];
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    stdout.push(String(chunk));
    return true;
  });
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    stderr.push(String(chunk));
    return true;
  });

  const code = await runCli(['inspect', 'entry.ts', '--project-root', directory, '--json']);
  rmSync(directory, { recursive: true, force: true });

  expect(code).toBe(3);
  expect(stdout).toHaveLength(1);
  const stderrHint: unknown = expect.stringContaining('validation issues were written to stderr');
  const envelope: unknown = JSON.parse(stdout.join(''));
  expect(envelope).toMatchObject({
    command: 'inspect',
    ok: false,
    data: null,
    diagnostics: [
      {
        code: 'internal.unexpected',
        hint: stderrHint,
      },
    ],
  });
  expect(JSON.stringify(envelope)).not.toContain('stack trace');
  const issues = stderr.join('');
  expect(issues).toContain('output broke the envelope contract');
  expect(issues).toContain('startFrame');
});
