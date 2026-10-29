import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ open: vi.fn() }));
vi.mock('../render/renderer.ts', () => ({
  createRenderer: mocks.open,
  frameRangeDiagnostic: () => undefined,
}));

import { runCli } from './cli.ts';

const directory = mkdtempSync(join(tmpdir(), 'motion-kit-propagation-'));
afterEach(() => {
  vi.restoreAllMocks();
  rmSync(directory, { recursive: true, force: true });
});

it('passes configuration to every renderer in the pool and to frame', async () => {
  const entry = join(directory, 'entry.ts');
  const config = join(directory, 'custom.ts');
  writeFileSync(entry, '');
  writeFileSync(config, '');
  const renderer = {
    descriptor: () => ({
      id: 'one',
      width: 1,
      height: 1,
      fps: { numerator: 30, denominator: 1 },
      durationInFrames: 2,
    }),
    renderFrame: ({ frame }: { frame: number }) =>
      Promise.resolve({
        ok: true,
        value: { frame, width: 1, height: 1, image: Buffer.from('image'), diagnostics: [] },
      }),
    dispose: () => Promise.resolve({ ok: true, value: undefined }),
  };
  mocks.open.mockResolvedValue({ ok: true, value: renderer });
  vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  const common = [
    'entry.ts',
    '--project-root',
    directory,
    '--vite-config',
    config,
    '--software-webgl',
    '--disable-sandbox',
    '--json',
  ];
  expect(
    await runCli(['render', ...common, '--concurrency', '2', '--out', join(directory, 'frames')]),
  ).toBe(0);
  expect(mocks.open).toHaveBeenCalledTimes(2);
  expect(
    await runCli(['frame', ...common, '--frame', '0', '--out', join(directory, 'frame.png')]),
  ).toBe(0);
  expect(mocks.open).toHaveBeenCalledTimes(3);
  for (const [options] of mocks.open.mock.calls) {
    expect(options as unknown).toMatchObject({
      projectRoot: directory,
      viteConfig: config,
      softwareWebGL: true,
      disableSandbox: true,
    });
  }
});
