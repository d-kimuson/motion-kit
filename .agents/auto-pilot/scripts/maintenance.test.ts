import { describe, expect, it } from 'vitest';

import { dateFromIsoString } from '../../../src/lib/clock.ts';
import {
  type CountCommits,
  type Manifest,
  dueTasks,
  isLastRun,
  isTaskName,
  parseDuration,
  parseManifest,
} from './maintenance.ts';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const NOW = dateFromIsoString('2026-01-08T00:00:00.000Z');
const noCommits: CountCommits = () => 0;

describe('parseDuration', () => {
  it('reads hours and days', () => {
    expect(parseDuration('6h')).toBe(6 * HOUR);
    expect(parseDuration('7d')).toBe(7 * DAY);
  });

  it('rejects anything else', () => {
    for (const text of ['', '0d', '07d', '1w', '1.5d', 'd', ' 1d'])
      expect(parseDuration(text)).toBeNull();
  });
});

describe('parseManifest', () => {
  it('converts triggers', () => {
    expect(
      parseManifest({
        tasks: { a: { every: '7d' }, b: { afterCommits: 50 }, c: { every: '6h', afterCommits: 1 } },
      }),
    ).toEqual({
      kind: 'ok',
      manifest: {
        tasks: {
          a: { every: 7 * DAY },
          b: { afterCommits: 50 },
          c: { every: 6 * HOUR, afterCommits: 1 },
        },
      },
    });
  });

  it('reports every invalid task', () => {
    expect(
      parseManifest({
        tasks: { a: {}, b: { every: '1w' }, c: { afterCommits: 0 }, d: { afterCommits: 1.5 } },
      }),
    ).toEqual({
      kind: 'error',
      errors: [
        'a: set `every` or `afterCommits`',
        'b: `every` must be like 6h or 7d',
        'c: `afterCommits` must be a positive integer',
        'd: `afterCommits` must be a positive integer',
      ],
    });
  });

  it('requires `tasks` to be an object', () => {
    expect(parseManifest({ tasks: [] })).toEqual({
      kind: 'error',
      errors: ['`tasks` must be an object'],
    });
    expect(parseManifest(null)).toEqual({ kind: 'error', errors: ['`tasks` must be an object'] });
  });
});

describe('isLastRun', () => {
  it('accepts entries with an ISO date and a commit', () => {
    expect(isLastRun({})).toBe(true);
    expect(isLastRun({ a: { at: '2026-01-01T00:00:00.000Z', commit: 'abc' } })).toBe(true);
  });

  it('rejects an invalid date or a missing field', () => {
    expect(isLastRun({ a: { at: 'yesterday', commit: 'abc' } })).toBe(false);
    expect(isLastRun({ a: { at: '2026-01-01T00:00:00.000Z' } })).toBe(false);
    expect(isLastRun([])).toBe(false);
  });
});

describe('isTaskName', () => {
  const manifest: Manifest = { tasks: { a: { every: DAY } } };

  it('accepts only the tasks in the manifest', () => {
    expect(isTaskName(manifest, 'a')).toBe(true);
    for (const name of ['b', 'toString', 'constructor', '__proto__', 'hasOwnProperty'])
      expect(isTaskName(manifest, name)).toBe(false);
  });
});

describe('dueTasks', () => {
  // An ISO timestamp `daysAgo` (0 to 7) days before NOW
  const at = (daysAgo: number): string => `2026-01-0${8 - daysAgo}T00:00:00.000Z`;

  it('lists a task that never ran', () => {
    expect(dueTasks({ tasks: { a: { every: DAY } } }, {}, NOW, noCommits)).toEqual([
      { name: 'a', reasons: [{ kind: 'never-run' }] },
    ]);
  });

  it('lists a task once its interval has passed', () => {
    const manifest: Manifest = { tasks: { a: { every: 7 * DAY } } };
    expect(dueTasks(manifest, { a: { at: at(6), commit: 'c' } }, NOW, noCommits)).toEqual([]);
    expect(dueTasks(manifest, { a: { at: at(7), commit: 'c' } }, NOW, noCommits)).toEqual([
      { name: 'a', reasons: [{ kind: 'elapsed', since: at(7) }] },
    ]);
  });

  it('lists a task once enough commits landed', () => {
    const manifest: Manifest = { tasks: { a: { afterCommits: 50 } } };
    const lastRun = { a: { at: at(0), commit: 'c' } };
    expect(dueTasks(manifest, lastRun, NOW, () => 49)).toEqual([]);
    expect(dueTasks(manifest, lastRun, NOW, () => 50)).toEqual([
      { name: 'a', reasons: [{ kind: 'commits', count: 50 }] },
    ]);
  });

  it('lists a task whose last commit is not in the history', () => {
    expect(
      dueTasks(
        { tasks: { a: { afterCommits: 1 } } },
        { a: { at: at(0), commit: 'gone' } },
        NOW,
        () => null,
      ),
    ).toEqual([{ name: 'a', reasons: [{ kind: 'commit-unknown', commit: 'gone' }] }]);
  });

  it('gives every reached trigger, in manifest order', () => {
    const manifest: Manifest = { tasks: { b: { every: DAY, afterCommits: 1 }, a: { every: DAY } } };
    expect(dueTasks(manifest, { b: { at: at(2), commit: 'c' } }, NOW, () => 3)).toEqual([
      {
        name: 'b',
        reasons: [
          { kind: 'elapsed', since: at(2) },
          { kind: 'commits', count: 3 },
        ],
      },
      { name: 'a', reasons: [{ kind: 'never-run' }] },
    ]);
  });
});
