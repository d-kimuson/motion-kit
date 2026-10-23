// Checks that every production dependency carries a license on the allowlist (design.md §14.2: MIT-compatible
// licenses only, so that the package can ship under MIT). Run with Node.js 24.2+ from the repository root:
//
//   node scripts/check-licenses.ts
//
// Exits 1 and lists the offending packages when a license is missing from the allowlist. Optional tooling such as
// FFmpeg binaries is not a package dependency; its license is reviewed by hand (REVIEW.md, Dependencies).
import { spawnSync } from 'node:child_process';

const ALLOWED: ReadonlySet<string> = new Set([
  'MIT',
  'ISC',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'Apache-2.0',
  '0BSD',
  'CC0-1.0',
  'Unlicense',
  'BlueOak-1.0.0',
  'MIT-0',
  'Python-2.0',
]);

// Packages whose license field is missing or non-standard but whose license was checked by hand.
// Key: package name. Value: the reason, with the license actually found.
const EXCEPTIONS: Readonly<Record<string, string>> = {};

type LicenseEntry = {
  readonly name: string;
  readonly versions?: readonly string[];
  readonly license?: string;
};

// `pnpm licenses list --json` groups packages by license expression.
type LicenseReport = Readonly<Record<string, readonly LicenseEntry[]>>;

const isLicenseEntry = (value: unknown): value is LicenseEntry =>
  typeof value === 'object' && value !== null && 'name' in value && typeof value.name === 'string';

const isLicenseReport = (value: unknown): value is LicenseReport =>
  typeof value === 'object' &&
  value !== null &&
  Object.values(value).every((entries) => Array.isArray(entries) && entries.every(isLicenseEntry));

const stripParens = (expression: string): string => expression.replace(/[()]/g, '').trim();

// SPDX expression: `A OR B` passes when either side passes; `A AND B` passes when both sides pass.
const isAllowed = (expression: string): boolean => {
  const normalized = stripParens(expression);
  if (normalized.includes(' OR ')) return normalized.split(' OR ').some((part) => isAllowed(part));
  if (normalized.includes(' AND '))
    return normalized.split(' AND ').every((part) => isAllowed(part));
  return ALLOWED.has(normalized);
};

const readReport = (): LicenseReport => {
  const result = spawnSync('pnpm', ['licenses', 'list', '--prod', '--json'], { encoding: 'utf8' });
  if (result.error !== undefined) throw result.error;
  const stdout = result.stdout.trim();
  // With no production dependencies pnpm prints a notice instead of JSON.
  if (!stdout.startsWith('{')) {
    if (result.status === 0 || /No licenses found/i.test(stdout + result.stderr)) return {};
    throw new Error(`pnpm licenses failed (${String(result.status)}): ${result.stderr}${stdout}`);
  }
  const parsed: unknown = JSON.parse(stdout);
  if (!isLicenseReport(parsed)) throw new Error('unexpected output from pnpm licenses list --json');
  return parsed;
};

const main = (): void => {
  const report = readReport();
  const problems: string[] = [];
  for (const [expression, entries] of Object.entries(report)) {
    if (isAllowed(expression)) continue;
    for (const entry of entries) {
      if (entry.name in EXCEPTIONS) continue;
      const versions = entry.versions?.join(', ') ?? '';
      problems.push(`${entry.name}@${versions}: ${expression}`);
    }
  }
  if (problems.length > 0) {
    process.stderr.write(
      `Dependencies with a license outside the allowlist (scripts/check-licenses.ts):\n${problems.map((p) => `  ${p}\n`).join('')}` +
        'Replace the dependency, or add it to EXCEPTIONS with the reason after checking its license by hand.\n',
    );
    process.exit(1);
  }
};

main();
