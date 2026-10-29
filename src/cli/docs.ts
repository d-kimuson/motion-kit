import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DocsTopicSchema, type DocsTopic } from '../agent/cli-output.ts';

// The guides ship in the package (`package.json#files`), so the CLI reads them from the installed
// tree rather than keeping a copy in `dist/`. `index` is the entry point; the rest live under
// `docs/guide`.

export type DocsTopicEntry = {
  readonly id: DocsTopic;
  readonly summary: string;
};

const summaries: Readonly<Record<DocsTopic, string>> = {
  index: 'Overview, requirements, quickstart, and the guide map.',
  'getting-started': 'Install, write a first entry, and render it.',
  cli: 'Commands, flags, the JSON envelope, diagnostics, and exit codes.',
  authoring: 'Compositions, props, time hooks, sequences, transitions, assets, and audio.',
  determinism: 'What a pure function of time guarantees and what breaks it.',
  examples: 'The reference videos, their commands, placeholders, and asset policy.',
  troubleshooting: 'What to do for each diagnostic code.',
};

/** The ids in the order `docs --list` prints and the error hint names. */
export const docsTopicIds = DocsTopicSchema.options;
export const docsTopics: readonly DocsTopicEntry[] = docsTopicIds.map((id) => ({
  id,
  summary: summaries[id],
}));

export const isDocsTopic = (value: string): value is DocsTopic =>
  docsTopicIds.some((id) => id === value);

/** The hint that names every topic, for an unknown one or a `--list` that also carries a topic. */
export const docsTopicsHint = (): string => `Choose one of: ${docsTopicIds.join(', ')}.`;

const packageName = '@kimuson/motion-kit';
const moduleDirectory = dirname(fileURLToPath(import.meta.url));

const packageNameAt = (directory: string): unknown => {
  try {
    const manifest: unknown = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));
    if (typeof manifest === 'object' && manifest !== null && 'name' in manifest)
      return manifest.name;
    return undefined;
  } catch {
    return undefined;
  }
};

/**
 * The package root above this module: the nearest directory whose `package.json` names
 * `@kimuson/motion-kit`. From `src/cli/*` that is the checkout root; from bundled `dist/cli.js` it
 * is the installed package root, which is also where the tarball puts `docs/`.
 */
const packageRoot = (): string => {
  let directory = moduleDirectory;
  for (;;) {
    if (packageNameAt(directory) === packageName) return directory;
    const parent = dirname(directory);
    if (parent === directory)
      throw new Error(`Could not find the ${packageName} package root above ${moduleDirectory}.`);
    directory = parent;
  }
};

/** The guide file for `topic`, read as shipped: no reformatting, no trailing newline added. */
export const readDocsFile = (topic: DocsTopic): string => {
  const path =
    topic === 'index'
      ? join(packageRoot(), 'docs', 'index.md')
      : join(packageRoot(), 'docs', 'guide', `${topic}.md`);
  try {
    return readFileSync(path, 'utf8');
  } catch {
    throw new Error(`The shipped guide ${path} is missing.`);
  }
};
