import {
  checkComposition,
  checkReportPassed,
  type CheckCompositionOptions,
} from '@kimuson/motion-kit/render';
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as loading from '../loading/session.ts';
import * as pool from '../pool.ts';
import * as renderer from '../renderer.ts';

const require = createRequire(import.meta.url);
const fixtureModule = new URL('../determinism/fixtures/references.tsx', import.meta.url).pathname;
const sessions: loading.LoadingSession[] = [];
let directory: string;

/**
 * The same temporary project `src/render/determinism/suite.ts` builds, without the font and image
 * files: these compositions only need the workspace, its module resolution and the entry.
 */
const prepareProject = (): string => {
  const created = mkdtempSync(join(tmpdir(), 'motion-kit-check-'));
  mkdirSync(join(created, 'node_modules'));
  for (const name of ['react', 'react-dom', 'zod'])
    symlinkSync(
      dirname(require.resolve(`${name}/package.json`)),
      join(created, 'node_modules', name),
    );
  writeFileSync(join(created, 'package.json'), '{"type":"module"}');
  writeFileSync(
    join(created, 'entry.ts'),
    `export {compositions} from ${JSON.stringify(fixtureModule)};`,
  );
  return created;
};

beforeEach(() => {
  directory = prepareProject();
  const original = loading.openLoadingSession;
  vi.spyOn(loading, 'openLoadingSession').mockImplementation(async (options) => {
    const result = await original(options);
    if (result.ok) sessions.push(result.value);
    return result;
  });
});

afterEach(async () => {
  for (const session of sessions.splice(0)) await session.dispose();
  vi.restoreAllMocks();
  rmSync(directory, { recursive: true, force: true });
});

const check = (
  options: Partial<CheckCompositionOptions> & Pick<CheckCompositionOptions, 'frames'>,
) =>
  checkComposition({
    projectRoot: directory,
    entry: 'entry.ts',
    compositionId: 'css-transform',
    frameTimeoutMs: 10_000,
    ...options,
  });

describe('checkComposition', () => {
  it('rejects invalid arguments before opening a browser', async () => {
    const openRenderer = vi.spyOn(renderer, 'createRenderer');
    const openPool = vi.spyOn(pool, 'createRendererPool');

    const duplicateFrames = await check({ frames: [1, 1] });
    expect(duplicateFrames).toMatchObject({
      ok: false,
      error: [{ code: 'cli.invalid-arguments' }],
    });

    const sampleAsPredecessor = await check({ frames: [2], predecessors: [2] });
    expect(sampleAsPredecessor).toMatchObject({
      ok: false,
      error: [{ code: 'cli.invalid-arguments' }],
    });

    const emptyHistories = await check({ frames: [2], histories: [] });
    expect(emptyHistories).toMatchObject({
      ok: false,
      error: [{ code: 'cli.invalid-arguments' }],
    });

    const invalidComparison = await check({
      frames: [2],
      comparison: {
        mode: 'pixels',
        channelTolerance: 256,
        maxChangedRatio: 0.002,
        alpha: 'ignore',
      },
    });
    expect(invalidComparison).toMatchObject({
      ok: false,
      error: [{ code: 'cli.invalid-arguments' }],
    });

    expect(openRenderer).not.toHaveBeenCalled();
    expect(openPool).not.toHaveBeenCalled();
    expect(sessions).toHaveLength(0);
  }, 30_000);

  it('rejects frames and predecessors outside the mounted frame count', async () => {
    // The references fixture is 6 frames long; 7 is a sample and 6 is only a predecessor, so both
    // range checks report without the sample/predecessor overlap check firing first.
    const result = await check({ frames: [0, 7], predecessors: [6] });
    expect(result.ok).toBe(false);
    if (result.ok || 'aborted' in result) throw new Error('The out-of-range check did not fail');
    expect(result.error.map((diagnostic) => diagnostic.code)).toEqual([
      'composition.props-invalid',
      'composition.props-invalid',
    ]);
    expect(result.error.map((diagnostic) => diagnostic.location?.frame)).toEqual([7, 6]);
  }, 60_000);

  it('reports a requested history that cannot run on the first frame', async () => {
    const result = await check({ frames: [0], histories: ['after-earlier'] });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('The check failed to produce a report');
    expect(checkReportPassed(result.value)).toBe(false);
    expect(result.value.diagnostics).toMatchObject([
      {
        code: 'check.history-not-run',
        severity: 'error',
        location: { frame: 0 },
        details: { frame: 0, history: 'after-earlier', reason: 'no-valid-predecessor' },
      },
    ]);
    expect(result.value.samples).toHaveLength(1);
    expect(result.value.samples[0]?.histories.map((history) => history.status)).toEqual([
      'reference',
    ]);
  }, 60_000);

  it('passes a deterministic composition across cold and warm histories', async () => {
    const result = await check({ frames: [0, 5] });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('The check failed to produce a report');
    expect(result.value.diagnostics).toEqual([]);
    expect(checkReportPassed(result.value)).toBe(true);
    expect(result.value.samples.map((sample) => sample.frame)).toEqual([0, 5]);
    expect(
      result.value.samples.map((sample) => sample.histories.map((item) => item.status)),
    ).toEqual([
      ['reference', 'identical', 'identical'],
      ['reference', 'identical', 'identical'],
    ]);
    expect(result.value.composition).toMatchObject({
      id: 'css-transform',
      width: 64,
      height: 64,
      durationInFrames: 6,
    });
  }, 90_000);

  it('fails a nondeterministic composition with check.frame-differs', async () => {
    const result = await check({
      compositionId: 'nondeterministic',
      frames: [1],
      histories: ['after-later'],
      comparison: { mode: 'exact' },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('The check failed to produce a report');
    expect(checkReportPassed(result.value)).toBe(false);
    expect(result.value.diagnostics).toMatchObject([
      {
        code: 'check.frame-differs',
        severity: 'error',
        location: { frame: 1 },
        details: {
          frame: 1,
          histories: [
            {
              history: 'after-later',
              predecessor: 2,
              status: 'differs',
              difference: { mode: 'exact' },
            },
          ],
        },
      },
    ]);
    expect(result.value.samples[0]?.histories.map((history) => history.status)).toEqual([
      'reference',
      'differs',
    ]);
  }, 60_000);

  it('disposes every renderer when the caller aborts', async () => {
    const controller = new AbortController();
    const running = check({ frames: [0, 5], signal: controller.signal });
    for (let attempt = 0; attempt < 1000 && sessions.length === 0; attempt += 1)
      await new Promise((resolve) => setTimeout(resolve, 20));
    expect(sessions.length).toBeGreaterThan(0);
    controller.abort();
    expect(await running).toEqual({ ok: false, aborted: true });
    for (const session of sessions) {
      expect(() => process.kill(session.servicePid, 0)).toThrow(/ESRCH/);
      expect(() => process.kill(session.browserPid, 0)).toThrow(/ESRCH/);
      expect(existsSync(session.workspace)).toBe(false);
    }
  }, 60_000);
});
