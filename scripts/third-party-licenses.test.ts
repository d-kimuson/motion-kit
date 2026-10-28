import { describe, expect, it } from 'vitest';

import {
  assertNoticeCurrent,
  collectNoticeEntries,
  renderNotice,
  type PackageSource,
} from './third-party-licenses.ts';

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
        attributions: [],
      },
      {
        name: 'zeta',
        version: '2.0.0',
        license: '(MIT OR GPL-3.0-only)',
        licenseText: 'zeta license',
        attributions: [],
      },
    ]);
  });

  it('appends a NOTICE next to the license and sorts attribution files by name', () => {
    const source = fixtureSource({
      apache: {
        packageJson: { name: 'apache', version: '1.0.0', license: 'Apache-2.0' },
        files: {
          'ThirdPartyNotices.txt': 'bundled notices',
          LICENSE: 'Apache License\nVersion 2.0',
          NOTICE: 'Puppeteer attribution',
        },
      },
    });
    expect(collectNoticeEntries({ apache: '1.0.0' }, source)).toEqual([
      {
        name: 'apache',
        version: '1.0.0',
        license: 'Apache-2.0',
        licenseText: 'Apache License\nVersion 2.0',
        attributions: [
          { file: 'NOTICE', text: 'Puppeteer attribution' },
          { file: 'ThirdPartyNotices.txt', text: 'bundled notices' },
        ],
      },
    ]);
  });

  it('matches attribution files regardless of case or separators, deterministically', () => {
    const packageJson = { name: 'apache', version: '1.0.0', license: 'Apache-2.0' };
    const files = {
      'third-party-notices.md': 'dash variant',
      'Notice.md': 'title case variant',
      LICENSE: 'Apache License',
    };
    const forward = fixtureSource({ apache: { packageJson, files } });
    const reversed = fixtureSource({
      apache: { packageJson, files: Object.fromEntries(Object.entries(files).reverse()) },
    });
    const entryOf = (source: PackageSource) => collectNoticeEntries({ apache: '1.0.0' }, source);
    expect(entryOf(forward)[0]?.attributions).toEqual([
      { file: 'Notice.md', text: 'title case variant' },
      { file: 'third-party-notices.md', text: 'dash variant' },
    ]);
    expect(entryOf(reversed)).toEqual(entryOf(forward));
  });

  it('treats a missing attribution file as normal', () => {
    const source = fixtureSource({
      mit: {
        packageJson: { name: 'mit', version: '1.0.0', license: 'MIT' },
        files: { LICENSE: 'MIT license' },
      },
    });
    expect(collectNoticeEntries({ mit: '1.0.0' }, source)[0]?.attributions).toEqual([]);
  });
});

describe('renderNotice', () => {
  it('sorts packages, keeps a stable format and ends with one newline', () => {
    const entries = [
      {
        name: 'zeta',
        version: '2.0.0',
        license: 'MIT',
        licenseText: 'zeta license',
        attributions: [],
      },
      {
        name: 'alpha',
        version: '1.0.0',
        license: 'ISC',
        licenseText: 'alpha license\n',
        attributions: [],
      },
    ];
    const notice = renderNotice(entries);
    expect(notice).toBe(renderNotice([...entries].reverse()));
    expect(notice).toContain(
      '## alpha - 1.0.0 (ISC)\n\n```text\nalpha license\n```\n\n## zeta - 2.0.0 (MIT)\n\n```text\nzeta license\n```\n',
    );
    expect(notice.endsWith('\n')).toBe(true);
    expect(notice.endsWith('\n\n')).toBe(false);
  });

  it('renders the license first and each attribution under its own heading', () => {
    const notice = renderNotice([
      {
        name: 'playwright',
        version: '1.64.1',
        license: 'Apache-2.0',
        licenseText: 'Apache License',
        attributions: [
          { file: 'NOTICE', text: 'Puppeteer attribution' },
          { file: 'ThirdPartyNotices.txt', text: 'bundled notices' },
        ],
      },
    ]);
    expect(notice).toContain(
      [
        '## playwright - 1.64.1 (Apache-2.0)',
        '```text\nApache License\n```',
        '### NOTICE',
        '```text\nPuppeteer attribution\n```',
        '### ThirdPartyNotices.txt',
        '```text\nbundled notices\n```',
      ].join('\n\n'),
    );
  });

  it('uses a fence longer than any backtick run in the license text', () => {
    const notice = renderNotice([
      {
        name: 'alpha',
        version: '1.0.0',
        license: 'MIT',
        licenseText: 'line with ``` inside',
        attributions: [],
      },
    ]);
    expect(notice).toContain('````text\nline with ``` inside\n````');
  });
});

describe('assertNoticeCurrent', () => {
  const action = 'run `pnpm build`, then commit `THIRD_PARTY_LICENSES.md`';

  it('accepts a committed notice that matches the generated text', () => {
    expect(() => assertNoticeCurrent('notice\n', () => 'notice\n')).not.toThrow();
  });

  it('rejects a stale commit and says how to fix it', () => {
    expect(() => assertNoticeCurrent('new notice\n', () => 'old notice\n')).toThrow(
      `THIRD_PARTY_LICENSES.md is stale: ${action}`,
    );
  });

  it('rejects a missing blob in HEAD and says how to fix it', () => {
    const readCommitted = () => {
      throw new Error("fatal: path 'THIRD_PARTY_LICENSES.md' does not exist in 'HEAD'");
    };
    expect(() => assertNoticeCurrent('notice\n', readCommitted)).toThrow(
      `THIRD_PARTY_LICENSES.md is missing from HEAD: ${action}`,
    );
  });
});
