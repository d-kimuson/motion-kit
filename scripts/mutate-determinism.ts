import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

/** Opt-in destructive negative controls for the Phase 1 determinism suite.
 * Run alone in a clean, disposable worktree; every source is restored in finally.
 * A survivor or a test infrastructure error fails. Do not run alongside other tests.
 */
const suite = 'src/render/determinism/phase1.determinism.test.ts';
const mutants = [
  {
    name: 'compare-only-frame-lengths',
    file: 'src/render/determinism/compare.ts',
    before: '    ? actual.equals(expected)',
    after: '    ? actual.length === expected.length',
    test: 'compares exact PNG bytes unless a cross-environment tolerance is explicit',
  },
  {
    name: 'skip-fresh-renderer-mode',
    file: 'src/render/determinism/suite.ts',
    before: `    modes.push(
      await compareOrder(fresh, baseline, [focus], name, 'fresh-renderer', suite.tolerance),
    );`,
    after: '    // MUTATION: the fresh-renderer mode never runs',
    test: 'captures DOM text identically across sequential, fresh, random, reverse, repeated and held modes',
  },
];
for (const mutant of mutants) {
  const original = readFileSync(mutant.file, 'utf8');
  if (original.split(mutant.before).length !== 2)
    throw new Error(`Mutation anchor changed: ${mutant.name}`);
  try {
    writeFileSync(mutant.file, original.replace(mutant.before, mutant.after));
    const result = spawnSync(
      'pnpm',
      ['vitest', 'run', suite, '-t', mutant.test, '--reporter=verbose'],
      { encoding: 'utf8', timeout: 120_000, maxBuffer: 4 * 1024 * 1024 },
    );
    const output = result.stdout + result.stderr;
    if (
      result.status !== 1 ||
      !output.includes('AssertionError') ||
      !output.includes(mutant.test)
    ) {
      process.stderr.write(output);
      throw new Error(`Survivor or invalid mutation run: ${mutant.name} (exit ${result.status})`);
    }
    process.stdout.write(`KILLED ${mutant.name}: ${mutant.test}\n`);
  } finally {
    writeFileSync(mutant.file, original);
  }
}
