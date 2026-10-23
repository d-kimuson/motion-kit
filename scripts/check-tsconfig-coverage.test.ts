import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it, onTestFinished } from 'vitest';

import { findUncoveredFiles } from './check-tsconfig-coverage.ts';

const project = (files: readonly string[]): { readonly root: string; readonly link: string } => {
  const temporary = mkdtempSync(join(tmpdir(), 'tsconfig-coverage-'));
  onTestFinished(() => rmSync(temporary, { recursive: true, force: true }));
  const root = join(realpathSync(temporary), 'project');
  const link = join(temporary, 'linked-project');
  mkdirSync(root);
  symlinkSync(root, link, 'dir');
  for (const file of files) {
    const path = join(root, file);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, '');
  }
  return { root, link };
};

describe('findUncoveredFiles', () => {
  it('reports TypeScript files missing from the program', () => {
    const files = ['src/a.ts', 'tools/b.ts', 'tools/c.tsx', 'tools/d.mts', 'tools/e.cts'];
    const { root } = project(files);
    expect(findUncoveredFiles(files, ['src/a.ts'], root)).toEqual([
      'tools/b.ts',
      'tools/c.tsx',
      'tools/d.mts',
      'tools/e.cts',
    ]);
  });

  it('ignores files that are not TypeScript', () => {
    const files = ['README.md', 'package.json', 'spec/Oracle.lean'];
    const { root } = project(files);
    expect(findUncoveredFiles(files, [], root)).toEqual([]);
  });

  it('reports nothing when every TypeScript file is in the program', () => {
    const files = ['src/a.ts', 'scripts/b.ts'];
    const { root } = project(files);
    expect(findUncoveredFiles(files, ['scripts/b.ts', 'src/a.ts'], root)).toEqual([]);
  });

  it('matches real program paths against a symlinked project root', () => {
    const files = ['src/a.ts', 'tools/uncovered.ts'];
    const { root, link } = project(files);
    expect(findUncoveredFiles(files, [join(root, 'src/a.ts')], link)).toEqual([
      'tools/uncovered.ts',
    ]);
  });

  it('matches symlinked program paths against a real project root', () => {
    const files = ['src/a.ts', 'tools/uncovered.ts'];
    const { root, link } = project(files);
    expect(findUncoveredFiles(files, [join(link, 'src/a.ts')], root)).toEqual([
      'tools/uncovered.ts',
    ]);
  });

  it('matches file symlinks while preserving uncovered repository paths', () => {
    const { root } = project(['src/a.ts', 'tools/uncovered.ts']);
    symlinkSync(join(root, 'src/a.ts'), join(root, 'covered.ts'));
    symlinkSync(join(root, 'tools/uncovered.ts'), join(root, 'uncovered.ts'));
    expect(
      findUncoveredFiles(['covered.ts', 'uncovered.ts'], [join(root, 'src/a.ts')], root),
    ).toEqual(['uncovered.ts']);
  });
});
