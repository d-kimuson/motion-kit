import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
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

  it.for([
    { spelling: 'case', directory: 'MyProj', alternate: 'myproj', file: 'Foo.ts', alias: 'foo.ts' },
    {
      spelling: 'Unicode normalization',
      directory: 'Café',
      alternate: 'Cafe\u0301',
      file: 'Fóo.ts',
      alias: 'Fo\u0301o.ts',
    },
  ])(
    'matches alternate $spelling in roots and both file sets',
    ({ directory, alternate, file, alias }, context) => {
      const { root } = project([`${directory}/${file}`]);
      const canonicalRoot = join(root, directory);
      const alternateRoot = join(root, alternate);
      if (!existsSync(join(alternateRoot, alias))) {
        context.skip();
        return;
      }
      const programFile = join(canonicalRoot, file);
      expect(findUncoveredFiles([file], [programFile], alternateRoot)).toEqual([]);
      expect(findUncoveredFiles([alias], [programFile], canonicalRoot)).toEqual([]);
      expect(findUncoveredFiles([file], [join(alternateRoot, alias)], canonicalRoot)).toEqual([]);
      const link = join(root, 'alternate-project');
      symlinkSync(alternateRoot, link, 'dir');
      expect(findUncoveredFiles([file], [programFile], link)).toEqual([]);
    },
  );

  it.each(['missing.ts', 'broken.ts'])(
    'ignores a stale program entry (%s) and still reports uncovered files',
    (stale) => {
      const files = ['src/a.ts', 'tools/uncovered.ts'];
      const { root } = project(files);
      const missing = join(root, '..', 'external.ts');
      symlinkSync(missing, join(root, 'broken.ts'));
      const programFiles = ['src/a.ts', stale === 'missing.ts' ? missing : join(root, stale)];
      expect(() => findUncoveredFiles(files, programFiles, root)).not.toThrow();
      expect(findUncoveredFiles(files, programFiles, root)).toEqual(['tools/uncovered.ts']);
    },
  );

  it('does not swallow repository-file canonicalization errors', () => {
    const { root } = project([]);
    expect(() => findUncoveredFiles(['missing.ts'], [], root)).toThrow(/ENOENT/);
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
