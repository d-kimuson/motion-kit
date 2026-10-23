import { describe, expect, it } from 'vitest';

import { findUncoveredFiles } from './check-tsconfig-coverage.ts';

describe('findUncoveredFiles', () => {
  it('reports TypeScript files missing from the program', () => {
    expect(
      findUncoveredFiles(
        ['src/a.ts', 'tools/b.ts', 'tools/c.tsx', 'tools/d.mts', 'tools/e.cts'],
        ['src/a.ts'],
      ),
    ).toEqual(['tools/b.ts', 'tools/c.tsx', 'tools/d.mts', 'tools/e.cts']);
  });

  it('ignores files that are not TypeScript', () => {
    expect(findUncoveredFiles(['README.md', 'package.json', 'spec/Oracle.lean'], [])).toEqual([]);
  });

  it('reports nothing when every TypeScript file is in the program', () => {
    expect(findUncoveredFiles(['src/a.ts', 'scripts/b.ts'], ['scripts/b.ts', 'src/a.ts'])).toEqual(
      [],
    );
  });
});
