import { describe, expect, it } from 'vitest';

import { collectNoticeEntries, renderNotice, type PackageSource } from './third-party-licenses.ts';

type FixturePackage = {
  readonly packageJson: unknown;
  readonly files: Readonly<Record<string, string>>;
};

const fixtureSource = (packages: Readonly<Record<string, FixturePackage>>): PackageSource => ({
  readPackageJson: (name) => {
    const pkg = packages[name];
    if (pkg === undefined) {
      throw new Error(
        `ENOENT: no such file or directory, open 'node_modules/${name}/package.json'`,
      );
    }
    return pkg.packageJson;
  },
  listFiles: (name) => {
    const pkg = packages[name];
    if (pkg === undefined) {
      throw new Error(`ENOENT: no such file or directory, scandir 'node_modules/${name}'`);
    }
    return Object.keys(pkg.files);
  },
  readFile: (name, file) => {
    const text = packages[name]?.files[file];
    if (text === undefined) throw new Error(`ENOENT: no such file or directory, open '${file}'`);
    return text;
  },
});

describe('collectNoticeEntries', () => {
  it('fails on a license outside the allowlist and names the package', () => {
    const source = fixtureSource({
      gpl: {
        packageJson: { name: 'gpl', version: '1.0.0', license: 'GPL-3.0-only' },
        files: { LICENSE: 'GNU General Public License' },
      },
    });
    expect(() => collectNoticeEntries({ gpl: '1.0.0' }, source)).toThrow(
      'gpl@1.0.0: license GPL-3.0-only is outside the allowlist (scripts/license-allowlist.ts)',
    );
  });

  it('fails when a package has no license text and names the package', () => {
    const source = fixtureSource({
      mit: {
        packageJson: { name: 'mit', version: '1.0.0', license: 'MIT' },
        files: { 'README.md': 'No license here.' },
      },
    });
    expect(() => collectNoticeEntries({ mit: '1.0.0' }, source)).toThrow(
      'mit@1.0.0: no license text found',
    );
  });

  it('fails when a license file is empty and names the package', () => {
    const source = fixtureSource({
      mit: {
        packageJson: { name: 'mit', version: '1.0.0', license: 'MIT' },
        files: { LICENSE: '  \n' },
      },
    });
    expect(() => collectNoticeEntries({ mit: '1.0.0' }, source)).toThrow(
      'mit@1.0.0: no license text found',
    );
  });

  it('fails when the package directory is missing and names the package', () => {
    expect(() => collectNoticeEntries({ missing: '1.0.0' }, fixtureSource({}))).toThrow(
      /missing: cannot read the installed package \(ENOENT/,
    );
  });

  it('evaluates SPDX AND/OR expressions through the shared allowlist', () => {
    const source = fixtureSource({
      alpha: {
        packageJson: { name: 'alpha', version: '1.0.0', license: 'MIT AND Apache-2.0' },
        files: { LICENSE: 'alpha license' },
      },
      zeta: {
        packageJson: { name: 'zeta', version: '2.0.0', license: '(MIT OR GPL-3.0-only)' },
        files: { 'LICENSE.md': 'zeta license' },
      },
    });
    expect(collectNoticeEntries({ zeta: '2.0.0', alpha: '1.0.0' }, source)).toEqual([
      {
        name: 'alpha',
        version: '1.0.0',
        license: 'MIT AND Apache-2.0',
        licenseText: 'alpha license',
      },
      {
        name: 'zeta',
        version: '2.0.0',
        license: '(MIT OR GPL-3.0-only)',
        licenseText: 'zeta license',
      },
    ]);
  });
});

describe('renderNotice', () => {
  it('sorts packages, keeps a stable format and ends with one newline', () => {
    const entries = [
      { name: 'zeta', version: '2.0.0', license: 'MIT', licenseText: 'zeta license' },
      { name: 'alpha', version: '1.0.0', license: 'ISC', licenseText: 'alpha license\n' },
    ];
    const notice = renderNotice(entries);
    expect(notice).toBe(renderNotice([...entries].reverse()));
    expect(notice).toContain(
      '## alpha - 1.0.0 (ISC)\n\n```text\nalpha license\n```\n\n## zeta - 2.0.0 (MIT)\n\n```text\nzeta license\n```\n',
    );
    expect(notice.endsWith('\n')).toBe(true);
    expect(notice.endsWith('\n\n')).toBe(false);
  });

  it('uses a fence longer than any backtick run in the license text', () => {
    const notice = renderNotice([
      {
        name: 'alpha',
        version: '1.0.0',
        license: 'MIT',
        licenseText: 'line with ``` inside',
      },
    ]);
    expect(notice).toContain('````text\nline with ``` inside\n````');
  });
});
