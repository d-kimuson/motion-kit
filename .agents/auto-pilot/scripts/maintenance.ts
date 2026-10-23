// Tells which maintenance tasks are due. Run with Node.js 24.2+ from the repository root:
//
//   node .agents/auto-pilot/scripts/maintenance.ts due                      the due tasks, each with why and its procedure
//   node .agents/auto-pilot/scripts/maintenance.ts done <name> [<commit>]   record that <name> ran now, at <commit> (default HEAD)
//
// Triggers live in maintenance-tasks/manifest.json (tracked): `every` ("6h", "7d") and `afterCommits`
// (first-parent commits on HEAD since the last run). A task is due when it never ran or any trigger is reached.
// Last runs live in maintenance-tasks/last-run.json (ignored by Git).

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { currentDate, currentTimestamp, dateFromIsoString } from '../../../src/lib/clock.ts';

export type Trigger = { readonly every?: number; readonly afterCommits?: number };
export type Manifest = { readonly tasks: Readonly<Record<string, Trigger>> };
export type LastRun = Readonly<Record<string, { readonly at: string; readonly commit: string }>>;

export type Reason =
  | { readonly kind: 'never-run' }
  | { readonly kind: 'elapsed'; readonly since: string }
  | { readonly kind: 'commits'; readonly count: number }
  | { readonly kind: 'commit-unknown'; readonly commit: string };

export type Due = { readonly name: string; readonly reasons: readonly Reason[] };

// Commits on HEAD's first-parent line since `commit`, or null when `commit` is not in the history
export type CountCommits = (commit: string) => number | null;

const UNIT_MS = { h: 60 * 60 * 1000, d: 24 * 60 * 60 * 1000 } as const;

export const parseDuration = (text: string): number | null => {
  const match = /^([1-9]\d*)([hd])$/.exec(text);
  if (match === null) return null;
  return Number(match[1]) * (match[2] === 'h' ? UNIT_MS.h : UNIT_MS.d);
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const parseManifest = (
  value: unknown,
):
  | { readonly kind: 'ok'; readonly manifest: Manifest }
  | { readonly kind: 'error'; readonly errors: readonly string[] } => {
  if (!isRecord(value) || !isRecord(value['tasks']))
    return { kind: 'error', errors: ['`tasks` must be an object'] };

  const tasks: Record<string, Trigger> = {};
  const errors: string[] = [];
  for (const [name, raw] of Object.entries(value['tasks'])) {
    const trigger = isRecord(raw) ? raw : {};
    const rawEvery = trigger['every'];
    const rawAfterCommits = trigger['afterCommits'];

    if (rawEvery === undefined && rawAfterCommits === undefined) {
      errors.push(`${name}: set \`every\` or \`afterCommits\``);
      continue;
    }
    const every = typeof rawEvery === 'string' ? parseDuration(rawEvery) : null;
    if (rawEvery !== undefined && every === null) {
      errors.push(`${name}: \`every\` must be like 6h or 7d`);
      continue;
    }
    const afterCommits =
      typeof rawAfterCommits === 'number' &&
      Number.isInteger(rawAfterCommits) &&
      rawAfterCommits > 0
        ? rawAfterCommits
        : null;
    if (rawAfterCommits !== undefined && afterCommits === null) {
      errors.push(`${name}: \`afterCommits\` must be a positive integer`);
      continue;
    }
    tasks[name] = {
      ...(every === null ? {} : { every }),
      ...(afterCommits === null ? {} : { afterCommits }),
    };
  }

  return errors.length > 0 ? { kind: 'error', errors } : { kind: 'ok', manifest: { tasks } };
};

const isIsoDate = (text: string): boolean => {
  try {
    dateFromIsoString(text);
    return true;
  } catch {
    return false;
  }
};

export const isLastRun = (value: unknown): value is LastRun =>
  isRecord(value) &&
  Object.values(value).every(
    (entry) =>
      isRecord(entry) &&
      typeof entry['at'] === 'string' &&
      isIsoDate(entry['at']) &&
      typeof entry['commit'] === 'string',
  );

export const isTaskName = (manifest: Manifest, name: string): boolean =>
  Object.hasOwn(manifest.tasks, name);

const reasonsFor = (
  trigger: Trigger,
  last: LastRun[string] | undefined,
  now: Date,
  countCommits: CountCommits,
): Reason[] => {
  if (last === undefined) return [{ kind: 'never-run' }];

  const reasons: Reason[] = [];
  if (
    trigger.every !== undefined &&
    now.getTime() - dateFromIsoString(last.at).getTime() >= trigger.every
  ) {
    reasons.push({ kind: 'elapsed', since: last.at });
  }
  if (trigger.afterCommits !== undefined) {
    const count = countCommits(last.commit);
    if (count === null) reasons.push({ kind: 'commit-unknown', commit: last.commit });
    else if (count >= trigger.afterCommits) reasons.push({ kind: 'commits', count });
  }
  return reasons;
};

export const dueTasks = (
  manifest: Manifest,
  lastRun: LastRun,
  now: Date,
  countCommits: CountCommits,
): Due[] =>
  Object.entries(manifest.tasks)
    .map(([name, trigger]) => ({
      name,
      reasons: reasonsFor(
        trigger,
        Object.hasOwn(lastRun, name) ? lastRun[name] : undefined,
        now,
        countCommits,
      ),
    }))
    .filter((due) => due.reasons.length > 0);

const describeReason = (reason: Reason): string => {
  switch (reason.kind) {
    case 'never-run':
      return 'never run';
    case 'elapsed':
      return `interval passed since ${reason.since}`;
    case 'commits':
      return `${reason.count} commits since the last run`;
    case 'commit-unknown':
      return `the last run's commit ${reason.commit} is not in the history`;
    default: {
      const unreachable: never = reason;
      return unreachable;
    }
  }
};

const DIRECTORY = join('.agents', 'auto-pilot', 'maintenance-tasks');
const MANIFEST = join(DIRECTORY, 'manifest.json');
const LAST_RUN = join(DIRECTORY, 'last-run.json');

// stderr is captured so that an expected failure (an unknown commit) does not print git's message
const git = (...args: string[]): string =>
  execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

const countCommits: CountCommits = (commit) => {
  try {
    git('merge-base', '--is-ancestor', commit, 'HEAD');
    return Number(git('rev-list', '--count', '--first-parent', `${commit}..HEAD`));
  } catch {
    return null;
  }
};

const resolveCommit = (revision: string): string | null => {
  try {
    return git('rev-parse', '--verify', `${revision}^{commit}`);
  } catch {
    return null;
  }
};

const fail = (message: string, code: number): never => {
  process.stderr.write(`${message}\n`);
  process.exit(code);
};

const readJson = (path: string): unknown => {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    return fail(`${path}: ${error instanceof Error ? error.message : String(error)}`, 1);
  }
};

const readManifest = (): Manifest => {
  const parsed = parseManifest(readJson(MANIFEST));
  if (parsed.kind === 'error')
    return fail(`${MANIFEST}:\n${parsed.errors.map((error) => `  ${error}`).join('\n')}`, 1);
  return parsed.manifest;
};

const readLastRun = (): LastRun => {
  if (!existsSync(LAST_RUN)) return {};
  const parsed = readJson(LAST_RUN);
  if (!isLastRun(parsed))
    return fail(`${LAST_RUN}: each task must have an ISO date \`at\` and a string \`commit\``, 1);
  return parsed;
};

const main = (args: readonly string[]): void => {
  const [command, name, revision = 'HEAD'] = args;
  switch (command) {
    case 'due': {
      const due = dueTasks(readManifest(), readLastRun(), currentDate(), countCommits);
      if (due.length === 0) process.stdout.write('no maintenance task is due\n');
      for (const task of due) {
        const reasons = task.reasons.map(describeReason).join(', ');
        process.stdout.write(
          `${task.name}: ${reasons} -> ${join(DIRECTORY, task.name, 'index.md')}\n`,
        );
      }
      return;
    }
    case 'done': {
      if (name === undefined || !isTaskName(readManifest(), name))
        return fail(`unknown task: ${name ?? '(none)'}`, 2);
      const commit = resolveCommit(revision) ?? fail(`unknown commit: ${revision}`, 2);
      const lastRun = { ...readLastRun(), [name]: { at: currentTimestamp(), commit } };
      writeFileSync(LAST_RUN, `${JSON.stringify(lastRun, null, 2)}\n`);
      return;
    }
    case undefined:
    default:
      return fail(
        'usage: node .agents/auto-pilot/scripts/maintenance.ts due | done <name> [<commit>]',
        2,
      );
  }
};

if (import.meta.main) main(process.argv.slice(2));
