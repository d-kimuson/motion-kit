// The license policy shared by scripts/check-licenses.ts (the production dependency check) and
// scripts/third-party-licenses.ts (the notice shipped in the package). The package is MIT, so every
// production dependency has to carry a license that permits redistribution under MIT-compatible
// terms. Optional tooling such as FFmpeg binaries is not a package dependency; its license is
// reviewed by hand (REVIEW.md, Dependencies).

export const ALLOWED: ReadonlySet<string> = new Set([
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
export const EXCEPTIONS: Readonly<Record<string, string>> = {};

const stripParens = (expression: string): string => expression.replace(/[()]/g, '').trim();

// SPDX expression: `A OR B` passes when either side passes; `A AND B` passes when both sides pass.
export const isAllowed = (expression: string): boolean => {
  const normalized = stripParens(expression);
  if (normalized.includes(' OR ')) return normalized.split(' OR ').some((part) => isAllowed(part));
  if (normalized.includes(' AND '))
    return normalized.split(' AND ').every((part) => isAllowed(part));
  return ALLOWED.has(normalized);
};
