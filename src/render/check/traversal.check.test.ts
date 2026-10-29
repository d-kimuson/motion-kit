import {
  checkComposition,
  checkReportPassed,
  type CheckCompositionOptions,
} from '@kimuson/motion-kit/render';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const fixtureModule = new URL('./fixtures/traversal.tsx', import.meta.url).pathname;

let directory: string;

/**
 * The temporary project `src/render/check/check.test.ts` builds, pointed at the traversal fixture
 * instead: no assets, only a workspace with module resolution and an entry.
 */
beforeAll(() => {
  directory = mkdtempSync(join(tmpdir(), 'motion-kit-traversal-'));
  mkdirSync(join(directory, 'node_modules'));
  for (const name of ['react', 'react-dom', 'zod'])
    symlinkSync(
      dirname(require.resolve(`${name}/package.json`)),
      join(directory, 'node_modules', name),
    );
  writeFileSync(join(directory, 'package.json'), '{"type":"module"}');
  writeFileSync(
    join(directory, 'entry.ts'),
    `export {compositions} from ${JSON.stringify(fixtureModule)};`,
  );
});

afterAll(() => {
  rmSync(directory, { recursive: true, force: true });
});

const check = (
  options: Partial<CheckCompositionOptions> & Pick<CheckCompositionOptions, 'frames'>,
) =>
  checkComposition({
    projectRoot: directory,
    entry: 'entry.ts',
    compositionId: 'traversal-dependent',
    frameTimeoutMs: 20_000,
    ...options,
  });

/** The status of every compared history, sample by sample, in plan order. */
const verdict = (report: {
  readonly samples: readonly {
    readonly histories: readonly { readonly status: string }[];
  }[];
}): string[][] => report.samples.map((sample) => sample.histories.map((history) => history.status));

describe('traversal fixture', () => {
  it('detects a fit that reads the frame-dependent marker on a warm realm', async () => {
    const result = await check({ frames: [2, 6] });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('The check failed to produce a report');
    const report = result.value;
    expect(checkReportPassed(report)).toBe(false);
    expect(report.composition.id).toBe('traversal-dependent');

    // Every sample compares its warm captures against a cold reference, so a differing status is
    // evidence that the histories are genuinely distinct and not the same capture twice.
    for (const sample of report.samples) {
      expect(sample.histories[0]).toMatchObject({
        history: 'cold',
        predecessor: null,
        status: 'reference',
        difference: null,
      });
      const warm = sample.histories.slice(1);
      expect(warm.length).toBeGreaterThan(0);
      expect(warm.every((history) => history.status === 'reference')).toBe(false);
      expect(warm.some((history) => history.status === 'differs')).toBe(true);
      expect(sample.histories.find((history) => history.status === 'differs')?.difference).not.toBe(
        null,
      );
    }

    const differing = report.diagnostics.filter(
      (diagnostic) => diagnostic.code === 'check.frame-differs',
    );
    expect(differing.map((diagnostic) => diagnostic.location?.frame)).toEqual([2, 6]);
    for (const diagnostic of differing) {
      const details = diagnostic.details as
        | {
            histories?: readonly {
              history?: string;
              predecessor?: number | null;
              status?: string;
              difference?: { mode?: string } | null;
            }[];
          }
        | undefined;
      expect(details?.histories).not.toHaveLength(0);
      for (const history of details?.histories ?? []) {
        expect(history.status).toBe('differs');
        expect(history.history).not.toBe('cold');
        expect(history.difference?.mode).toBe('pixels');
      }
    }
  }, 180_000);

  it('passes the same scene once the fit reads only frame-independent styles', async () => {
    const result = await check({ frames: [0, 6], compositionId: 'traversal-fixed' });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('The check failed to produce a report');
    expect(result.value.diagnostics).toEqual([]);
    expect(checkReportPassed(result.value)).toBe(true);
    // Frame 0 has no earlier frame, so its plan is cold, after-later and pool; frame 6 has all
    // four histories.
    expect(verdict(result.value)).toEqual([
      ['reference', 'identical', 'identical'],
      ['reference', 'identical', 'identical', 'identical'],
    ]);
  }, 180_000);

  it('repeats the same verdict for the dependent fixture', async () => {
    const first = await check({ frames: [2] });
    const second = await check({ frames: [2] });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) throw new Error('A repeat check failed to produce a report');
    // The checker is repeatable: the same frame and histories produce the same verdict, whatever
    // the pixels happen to be.
    expect(verdict(second.value)).toEqual(verdict(first.value));
    expect(checkReportPassed(first.value)).toBe(false);
    expect(checkReportPassed(second.value)).toBe(false);
    expect(first.value.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(
      second.value.diagnostics.map((diagnostic) => diagnostic.code),
    );
  }, 180_000);
});
