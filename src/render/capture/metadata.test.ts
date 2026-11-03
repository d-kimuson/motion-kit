import { createRenderer, type Renderer } from '@kimuson/motion-kit/render';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { checkComposition } from '../check/check.ts';
import { type Selection } from '../loading/session.ts';

const require = createRequire(import.meta.url);
let directory: string;
const renderers: Renderer[] = [];

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'motion-kit-metadata-'));
  mkdirSync(join(directory, 'node_modules'));
  for (const name of ['react', 'react-dom', 'zod'])
    symlinkSync(
      dirname(require.resolve(`${name}/package.json`)),
      join(directory, 'node_modules', name),
    );
  writeFileSync(join(directory, 'package.json'), '{"type":"module"}');
  writeFileSync(
    join(directory, 'entry.ts'),
    `export {compositions} from ${JSON.stringify(new URL('../../core/runtime/fixtures/derived.tsx', import.meta.url).pathname)};`,
  );
});
afterEach(async () => {
  for (const renderer of renderers.splice(0)) await renderer.dispose();
  rmSync(directory, { recursive: true, force: true });
});

const open = async (props: NonNullable<Selection['props']>) => {
  const result = await createRenderer({
    projectRoot: directory,
    entry: 'entry.ts',
    compositionId: 'derived',
    props,
  });
  if (!result.ok)
    throw new Error(
      'aborted' in result
        ? 'Renderer creation aborted'
        : `Renderer creation failed: ${result.error.message}`,
    );
  renderers.push(result.value);
  return result.value;
};
const beyond = {
  ok: false,
  error: [{ code: 'composition.props-invalid', location: { frame: 3 } }],
};

describe('props-derived Composition metadata', () => {
  it('runs the mounted descriptor on the duration the props derive', async () => {
    const short = await open({ frames: 3 });
    // The declaration says one frame; the resolved metadata is what every consumer reads.
    expect(short.descriptor().durationInFrames).toBe(3);
    expect(short.descriptor()).toMatchObject({
      width: 32,
      height: 32,
      fps: { numerator: 30, denominator: 1 },
    });
    expect(await short.renderFrame({ frame: 2 })).toMatchObject({ ok: true, value: { frame: 2 } });
    expect(await short.renderFrame({ frame: 3 })).toMatchObject(beyond);

    const long = await open({ frames: 8 });
    expect(long.descriptor().durationInFrames).toBe(8);
    expect(await long.renderFrame({ frame: 7 })).toMatchObject({ ok: true, value: { frame: 7 } });
    expect(await long.renderFrame({ frame: 8 })).toMatchObject({
      ok: false,
      error: [{ code: 'composition.props-invalid', location: { frame: 8 } }],
    });
  }, 120_000);

  it('rejects a range past the resolved end and renders the resolved range', async () => {
    const renderer = await open({ frames: 3 });
    const rendered = [];
    for await (const result of renderer.renderFrames({ from: 0, to: 3 })) rendered.push(result);
    expect(rendered.map((result) => result.ok)).toEqual([true, true, true]);
    const results = [];
    for await (const result of renderer.renderFrames({ from: 1, to: 5 })) results.push(result);
    // The range is validated against the resolved duration before any frame is captured.
    expect(results).toMatchObject([{ ok: false, error: [{ code: 'composition.props-invalid' }] }]);
  }, 120_000);

  it('rejects a check sample past the resolved end with the same Diagnostic', async () => {
    const result = await checkComposition({
      projectRoot: directory,
      entry: 'entry.ts',
      compositionId: 'derived',
      props: { frames: 3 },
      frames: [2, 3],
    });
    expect(result).toMatchObject({ ok: false, error: [beyond.error[0]] });
  }, 180_000);

  it('reports a failing resolver as the mount Diagnostic and never opens a page', async () => {
    expect(
      await createRenderer({
        projectRoot: directory,
        entry: 'entry.ts',
        compositionId: 'derived',
        props: { fail: 'reported' },
      }),
    ).toMatchObject({
      ok: false,
      error: {
        code: 'render.page-error',
        message: 'The generated script could not be read.',
        location: { compositionId: 'derived' },
      },
    });
  }, 120_000);

  it('keeps a thrown resolver text out of the Diagnostic', async () => {
    const result = await createRenderer({
      projectRoot: directory,
      entry: 'entry.ts',
      compositionId: 'derived',
      props: { fail: 'thrown' },
    });
    expect(result).toMatchObject({ ok: false, error: { code: 'render.page-error' } });
    expect(JSON.stringify(result)).not.toContain('generated script unavailable');
  }, 120_000);
});
