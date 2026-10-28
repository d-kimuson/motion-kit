import { createRendererPool, type RendererPool } from '@kimuson/motion-kit/render';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createRenderer } from './renderer.ts';

const require = createRequire(import.meta.url);
const pools: RendererPool[] = [];
let directory: string;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'motion-kit-pool-'));
  mkdirSync(join(directory, 'node_modules'));
  for (const name of ['react', 'react-dom', 'zod'])
    symlinkSync(
      dirname(require.resolve(`${name}/package.json`)),
      join(directory, 'node_modules', name),
    );
  writeFileSync(join(directory, 'package.json'), '{"type":"module"}');
  writeFileSync(
    join(directory, 'entry.ts'),
    `export {compositions} from ${JSON.stringify(new URL('../core/runtime/fixtures/capture.tsx', import.meta.url).pathname)};`,
  );
});
afterEach(async () => {
  for (const pool of pools.splice(0)) await pool.dispose();
  rmSync(directory, { recursive: true, force: true });
});
const options = (mode: string) => ({
  projectRoot: directory,
  entry: 'entry.ts',
  compositionId: 'one',
  props: { mode },
  frameTimeoutMs: 5000,
});
const open = async (concurrency: number, mode = 'normal') => {
  const result = await createRendererPool({ ...options(mode), concurrency });
  if (!result.ok) throw new Error('Pool creation failed');
  pools.push(result.value);
  return result.value;
};
const collect = async (pool: RendererPool, from: number, to: number) => {
  const results = [];
  for await (const result of pool.renderFrames({ from, to })) results.push(result);
  return results;
};

describe('renderer pool', () => {
  it('rejects a concurrency that is not a positive integer before opening a renderer', async () => {
    for (const concurrency of [0, -1, 1.5, Number.NaN])
      expect(await createRendererPool({ ...options('normal'), concurrency })).toMatchObject({
        ok: false,
        error: { code: 'cli.invalid-arguments' },
      });
  });

  it('yields every frame in order with the bytes a single renderer captures', async () => {
    const single = await createRenderer(options('normal'));
    if (!single.ok) throw new Error('Renderer creation failed');
    const expected: Buffer[] = [];
    try {
      for await (const result of single.value.renderFrames({ from: 0, to: 6 })) {
        if (!result.ok) throw new Error('Capture failed');
        expected.push(result.value.image);
      }
    } finally {
      await single.value.dispose();
    }
    const pool = await open(3);
    const results = await collect(pool, 0, 6);
    expect(results.map((result) => (result.ok ? result.value.frame : -1))).toEqual([
      0, 1, 2, 3, 4, 5,
    ]);
    expect(
      results.map(
        (result, index) =>
          result.ok && result.value.image.equals(expected[index] ?? Buffer.alloc(0)),
      ),
    ).toEqual([true, true, true, true, true, true]);
  });

  it('captures JPEG frames when asked to', async () => {
    const pool = await open(2);
    for await (const result of pool.renderFrames({
      from: 0,
      to: 2,
      format: { type: 'jpeg', quality: 95 },
    })) {
      if (!result.ok) throw new Error('Capture failed');
      expect(result.value.format).toBe('jpeg');
      // Every JPEG starts with the SOI marker.
      expect([...result.value.image.subarray(0, 2)]).toEqual([0xff, 0xd8]);
    }
  });

  it('stops at the first failed frame and yields nothing after it', async () => {
    const pool = await open(2, 'failed');
    const results = await collect(pool, 0, 6);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ ok: false, error: [{ code: 'asset.load-failed' }] });
  });

  it('reports an out-of-range request as one failure', async () => {
    const pool = await open(2);
    const results = await collect(pool, 4, 9);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ ok: false });
  });
});
