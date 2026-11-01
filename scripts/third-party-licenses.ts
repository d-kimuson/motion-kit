// Generates THIRD_PARTY_LICENSES.md from the packages in package.json#dependencies (the runtime
// dependencies the published package externalizes) and writes it at the repository root. Run with
// Node.js 24.2+ from the repository root:
//
//   node scripts/third-party-licenses.ts
//
// For each package it reproduces the license text and, when the package ships them, the attribution
// files the license asks to pass on (`NOTICE`, `ThirdPartyNotices.txt`, and their spelling variants).
//
// With `--check` it instead compares the generated text against the committed blob
// (`git show HEAD:THIRD_PARTY_LICENSES.md`) and fails when the commit is stale. `pnpm lint` runs it
// as `lint:third-party` so a dependency bump that forgets to commit the regenerated notice fails CI.
//
// The preview host page (dist/preview.js) bundles devDependencies instead of externalizing them, so
// the notice also covers every devDependency `src/preview` imports, with the packages those depend on,
// and the code copied into the repository that VENDORED lists.
//
// Exits 1 and names the package when it is not installed, has no license text, or carries a license
// outside the allowlist in scripts/license-allowlist.ts.
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  globSync,
  readFileSync,
  readdirSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { EXCEPTIONS, isAllowed } from './license-allowlist.ts';

// Code copied into the repository rather than installed; its license file sits next to the copy.
const VENDORED: readonly (PackageMetadata & { readonly file: string })[] = [
  { name: 'shadcn/ui', version: '4.23.0', license: 'MIT', file: 'src/preview/ui/LICENSE' },
];

const LICENSE_FILE = /^(?:licen[cs]e|copying)(?:[._-].*)?$/i;

// The stems of the attribution files Apache-2.0 §4(d) asks to carry forward, matched after
// normalising case and separators so `NOTICE`, `Notice.md`, `ThirdPartyNotices.txt` and
// `third-party-notices.txt` all count.
const ATTRIBUTION_STEMS: ReadonlySet<string> = new Set(['notice', 'thirdpartynotices']);

type PackageMetadata = {
  readonly name: string;
  readonly version: string;
  readonly license: string;
};

export type NoticeAttribution = {
  readonly file: string;
  readonly text: string;
};

export type NoticeEntry = PackageMetadata & {
  readonly licenseText: string;
  readonly attributions: readonly NoticeAttribution[];
};

// The file system reads the notice needs, injected so that tests can supply fixture packages
// instead of mutating node_modules.
export type PackageSource = {
  readonly readPackageJson: (name: string) => unknown;
  readonly listFiles: (name: string) => readonly string[];
  readonly readFile: (name: string, file: string) => string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const compareStrings = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

export const dependenciesOf = (packageJson: unknown): Readonly<Record<string, string>> => {
  if (!isRecord(packageJson)) throw new Error('package.json is not an object');
  const dependencies = packageJson['dependencies'];
  if (!isRecord(dependencies)) return {};
  const parsed: Record<string, string> = {};
  for (const [name, range] of Object.entries(dependencies)) {
    if (typeof range !== 'string') {
      throw new Error(`package.json#dependencies.${name} is not a string`);
    }
    parsed[name] = range;
  }
  return parsed;
};

// `from 'pkg/sub'`, `import('pkg')` and CSS `@import "pkg/file.css"` all name `pkg`; relative and
// `node:` specifiers name none.
const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(\s*|@import\s+)(['"])([^'"]+)\1/g;

export const importedPackages = (sources: readonly string[]): ReadonlySet<string> =>
  new Set(
    sources.flatMap((source) =>
      [...source.matchAll(SPECIFIER)].flatMap(([, , specifier = '']) => {
        if (specifier.startsWith('.') || specifier.startsWith('/') || specifier.includes(':'))
          return [];
        const parts = specifier.split('/');
        return [specifier.startsWith('@') ? parts.slice(0, 2).join('/') : (parts[0] ?? '')];
      }),
    ),
  );

/** The devDependencies a bundle imports: everything else it imports stays external. */
export const bundledRoots = (
  packageJson: unknown,
  imported: ReadonlySet<string>,
): readonly string[] => {
  const devDependencies = isRecord(packageJson) ? packageJson['devDependencies'] : undefined;
  return isRecord(devDependencies)
    ? Object.keys(devDependencies)
        .filter((name) => imported.has(name))
        .sort(compareStrings)
    : [];
};

/**
 * The installed directories of `roots` and of everything they depend on, found the way Node.js
 * resolves a bare specifier: `locate(from, name)` looks up `name` from the directory `from`, or from
 * the repository when `from` is undefined.
 */
export const dependencyClosure = (
  roots: readonly string[],
  locate: (from: string | undefined, name: string) => string,
  dependenciesAt: (directory: string) => readonly string[],
): readonly string[] => {
  const seen = new Set<string>();
  const visit = (directory: string): void => {
    if (seen.has(directory)) return;
    seen.add(directory);
    for (const name of dependenciesAt(directory)) visit(locate(directory, name));
  };
  for (const name of roots) visit(locate(undefined, name));
  return [...seen].sort(compareStrings);
};

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const attempt = <T>(name: string, subject: string, read: () => T): T => {
  try {
    return read();
  } catch (error) {
    throw new Error(`${name}: cannot read ${subject} (${errorMessage(error)})`);
  }
};

const metadataOf = (dependency: string, value: unknown): PackageMetadata => {
  if (!isRecord(value)) throw new Error(`${dependency}: package.json is not an object`);
  const { name, version, license } = value;
  if (typeof name !== 'string' || name === '') {
    throw new Error(`${dependency}: package.json has no name`);
  }
  if (typeof version !== 'string' || version === '') {
    throw new Error(`${dependency}: package.json has no version`);
  }
  if (typeof license !== 'string' || license === '') {
    throw new Error(`${dependency}: package.json has no license`);
  }
  return { name, version, license };
};

export const licenseFiles = (files: readonly string[]): readonly string[] =>
  files.filter((file) => LICENSE_FILE.test(file)).sort(compareStrings);

// `NOTICE.txt` -> `notice`, `third-party-notices.md` -> `thirdpartynotices`.
const normalizedStem = (file: string): string => {
  const dot = file.lastIndexOf('.');
  const stem = dot > 0 ? file.slice(0, dot) : file;
  return stem.toLowerCase().replace(/[-_]/g, '');
};

export const attributionFiles = (files: readonly string[]): readonly string[] =>
  files.filter((file) => ATTRIBUTION_STEMS.has(normalizedStem(file))).sort(compareStrings);

const normalizeText = (text: string): string =>
  text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, ''))
    .join('\n')
    .trim();

export const collectNoticeEntries = (
  dependencies: Readonly<Record<string, string>>,
  source: PackageSource,
): readonly NoticeEntry[] =>
  Object.keys(dependencies)
    .sort(compareStrings)
    .map((dependency) => {
      const metadata = metadataOf(
        dependency,
        attempt(dependency, 'the installed package', () => source.readPackageJson(dependency)),
      );
      if (!isAllowed(metadata.license) && !(dependency in EXCEPTIONS)) {
        throw new Error(
          `${metadata.name}@${metadata.version}: license ${metadata.license} is outside the allowlist (scripts/license-allowlist.ts)`,
        );
      }
      const packageFiles = attempt(dependency, 'the package directory', () =>
        source.listFiles(dependency),
      );
      const files = licenseFiles(packageFiles);
      if (files.length === 0) {
        throw new Error(`${metadata.name}@${metadata.version}: no license text found`);
      }
      const licenseText = files
        .map((file) =>
          attempt(dependency, `the license file ${file}`, () => source.readFile(dependency, file)),
        )
        .map(normalizeText)
        .join('\n\n');
      if (licenseText === '') {
        throw new Error(`${metadata.name}@${metadata.version}: no license text found`);
      }
      // A missing attribution file is normal, so an empty list is not an error.
      const attributions = attributionFiles(packageFiles).flatMap((file) => {
        const text = normalizeText(
          attempt(dependency, `the attribution file ${file}`, () =>
            source.readFile(dependency, file),
          ),
        );
        return text === '' ? [] : [{ file, text }];
      });
      return { ...metadata, licenseText, attributions };
    });

const HEADER = `# Third-party licenses

\`@kimuson/motion-kit\` declares these packages as runtime dependencies, or bundles them or code copied
from them into its preview host page, and reproduces their license texts and attribution notices
below. The file is generated by \`scripts/third-party-licenses.ts\`; do
not edit it by hand.`;

// A fence longer than any run inside the text keeps the license verbatim; oxfmt keeps the same
// fence, so a build does not churn the committed file.
const fencedText = (text: string): string => {
  const trimmed = text.trim();
  const longestRun = Math.max(0, ...(trimmed.match(/`+/g) ?? []).map((run) => run.length));
  const fence = '`'.repeat(Math.max(3, longestRun + 1));
  return `${fence}text\n${trimmed}\n${fence}`;
};

export const renderNotice = (entries: readonly NoticeEntry[]): string => {
  // A package both declared and bundled is listed once.
  const unique = [
    ...new Map(entries.map((entry) => [`${entry.name}@${entry.version}`, entry])).values(),
  ];
  const sections = unique
    .sort((left, right) => compareStrings(left.name, right.name))
    .map((entry) => {
      // License text first, then the attribution files in file-name order.
      const parts = [
        `## ${entry.name} - ${entry.version} (${entry.license})`,
        fencedText(entry.licenseText),
        ...entry.attributions.map(
          (attribution) => `### ${attribution.file}\n\n${fencedText(attribution.text)}`,
        ),
      ];
      return parts.join('\n\n');
    });
  return `${HEADER}${sections.length === 0 ? '' : `\n\n${sections.join('\n\n')}`}\n`;
};

const REQUIRED_ACTION = 'run `pnpm build`, then commit `THIRD_PARTY_LICENSES.md`';

export const assertNoticeCurrent = (generated: string, readCommitted: () => string): void => {
  let committed: string;
  try {
    committed = readCommitted();
  } catch (error) {
    throw new Error(
      `THIRD_PARTY_LICENSES.md is missing from HEAD: ${REQUIRED_ACTION} (${errorMessage(error)})`,
    );
  }
  if (committed !== generated) {
    throw new Error(`THIRD_PARTY_LICENSES.md is stale: ${REQUIRED_ACTION}`);
  }
};

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));

// A package is named relative to `nodeModules`, or by its absolute installed directory.
const nodeSource = (nodeModules: string): PackageSource => ({
  readPackageJson: (name) =>
    JSON.parse(readFileSync(resolve(nodeModules, name, 'package.json'), 'utf8')) as unknown,
  listFiles: (name) =>
    readdirSync(resolve(nodeModules, name), { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name),
  readFile: (name, file) => readFileSync(resolve(nodeModules, name, file), 'utf8'),
});

const locateInstalled = (from: string | undefined, name: string): string => {
  for (let directory = from ?? repositoryRoot; ; directory = dirname(directory)) {
    const candidate = join(directory, 'node_modules', name);
    if (existsSync(join(candidate, 'package.json'))) return realpathSync(candidate);
    if (dirname(directory) === directory) {
      throw new Error(`${name}: not installed (looked up from ${from ?? repositoryRoot})`);
    }
  }
};

const dependencyNamesAt = (directory: string): readonly string[] => {
  const packageJson: unknown = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));
  const dependencies = isRecord(packageJson) ? packageJson['dependencies'] : undefined;
  return isRecord(dependencies) ? Object.keys(dependencies) : [];
};

const previewBundled = (packageJson: unknown): readonly string[] => {
  const sources = globSync('src/preview/**/*.{ts,tsx,css}', { cwd: repositoryRoot })
    .filter((file) => !/\.test\.tsx?$/.test(file))
    .map((file) => readFileSync(join(repositoryRoot, file), 'utf8'));
  return dependencyClosure(
    bundledRoots(packageJson, importedPackages(sources)),
    locateInstalled,
    dependencyNamesAt,
  );
};

const vendoredEntries = (): readonly NoticeEntry[] =>
  VENDORED.map(({ file, ...metadata }) => {
    const licenseText = normalizeText(readFileSync(join(repositoryRoot, file), 'utf8'));
    if (licenseText === '') throw new Error(`${metadata.name}: ${file} is empty`);
    return { ...metadata, licenseText, attributions: [] };
  });

const generateNotice = (): string => {
  const packageJson: unknown = JSON.parse(
    readFileSync(join(repositoryRoot, 'package.json'), 'utf8'),
  );
  const source = nodeSource(join(repositoryRoot, 'node_modules'));
  const bundled = Object.fromEntries(
    previewBundled(packageJson).map((directory) => [directory, '']),
  );
  return renderNotice([
    ...collectNoticeEntries(dependenciesOf(packageJson), source),
    ...collectNoticeEntries(bundled, source),
    ...vendoredEntries(),
  ]);
};

const committedNotice = (): string =>
  execFileSync('git', ['show', 'HEAD:THIRD_PARTY_LICENSES.md'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });

const main = (): void => {
  try {
    const notice = generateNotice();
    if (process.argv.includes('--check')) {
      assertNoticeCurrent(notice, committedNotice);
    } else {
      writeFileSync(join(repositoryRoot, 'THIRD_PARTY_LICENSES.md'), notice);
    }
  } catch (error) {
    process.stderr.write(`${errorMessage(error)}\n`);
    process.exit(1);
  }
};

if (import.meta.main) main();
