// Checks that every TypeScript file in the repository is part of the tsconfig.json program. A file outside `include`
// passes `pnpm typecheck` unchecked, and type-aware oxlint rules cannot resolve its types. Run with Node.js 24.2+
// from the repository root:
//
//   node scripts/check-tsconfig-coverage.ts
//
// Exits 1 and lists the files `tsc -p . --listFilesOnly` does not list. Fix it by adding the path to `include`.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { relative } from 'node:path';

const TS_FILE = /\.(?:ts|tsx|mts|cts)$/;

/** The TypeScript files of `repositoryFiles` that are missing from `programFiles` (both relative to the repository root). */
export const findUncoveredFiles = (
  repositoryFiles: readonly string[],
  programFiles: readonly string[],
): string[] => {
  const covered = new Set(programFiles);
  return repositoryFiles.filter((file) => TS_FILE.test(file) && !covered.has(file));
};

const run = (command: string, args: readonly string[]): string[] => {
  const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(' ')} failed (${String(result.status)}): ${result.stderr}`,
    );
  }
  return result.stdout.split('\n').filter((line) => line !== '');
};

const main = (): void => {
  // Tracked files plus untracked, non-ignored ones, so that a new file is caught before it is staged.
  const repositoryFiles = run('git', [
    'ls-files',
    '--cached',
    '--others',
    '--exclude-standard',
  ]).filter((file) => existsSync(file));
  const programFiles = run('pnpm', ['exec', 'tsc', '-p', '.', '--listFilesOnly']).map((file) =>
    relative(process.cwd(), file),
  );
  const uncovered = findUncoveredFiles(repositoryFiles, programFiles);
  if (uncovered.length > 0) {
    process.stderr.write(
      `TypeScript files outside the tsconfig.json program (scripts/check-tsconfig-coverage.ts):\n${uncovered.map((file) => `  ${file}\n`).join('')}` +
        'Add them to "include" in tsconfig.json so that typecheck and type-aware lint cover them.\n',
    );
    process.exit(1);
  }
};

if (import.meta.main) main();
