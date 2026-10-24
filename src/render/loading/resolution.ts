import type { Alias, AliasOptions, Plugin, UserConfig } from 'vite';

import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { bootstrapId, entryId, entrySource } from './entry-source.ts';

const isAliasArray = (value: AliasOptions): value is readonly Alias[] => Array.isArray(value);
const normalizeAliases = (aliases: AliasOptions = {}): readonly Alias[] =>
  isAliasArray(aliases)
    ? aliases
    : Object.entries(aliases).map(([find, replacement]) => ({ find, replacement }));

// The loading plugin aliases the public package entries to files on disk. In the
// source tree (and the installed-child test's copied src/) those are the `.ts`
// entries; in the built `dist/` output they are the bundled `.js` entries. The
// built output is detected by the module's own URL so the same source works
// everywhere. `./browser` is a private build artifact until TASK-190.
export const isBuiltOutput = (url: string): boolean => url.includes('/dist/');
const builtRoot = isBuiltOutput(import.meta.url);
export const packageEntry = builtRoot
  ? join(dirname(fileURLToPath(import.meta.url)), 'index.js')
  : fileURLToPath(new URL('../../index.ts', import.meta.url));
export const browserEntry = builtRoot
  ? join(dirname(fileURLToPath(import.meta.url)), 'browser.js')
  : fileURLToPath(new URL('../../core/runtime/browser-entry.ts', import.meta.url));
/** Ids the loading plugin owns. Vite's alias plugin runs before `enforce: 'pre'` plugins,
 * so a project alias for these would shadow the bootstrap instead of the other way round.
 * They are prepended to `resolve.alias` so motion-kit's reserved ids win over a conflicting
 * project alias, without rejecting the project's config. The user entry is reserved too:
 * `entrySource()` imports it by id, so a project alias must not swap the entry module. */
export const reservedAliases = (entry: string): readonly Alias[] => [
  { find: /^@kimuson\/motion-kit\/browser$/, replacement: browserEntry },
  { find: /^@kimuson\/motion-kit$/, replacement: packageEntry },
  { find: /^motion-kit$/, replacement: packageEntry },
  { find: /^virtual:motion-kit-entry$/, replacement: `\u0000${entryId}` },
  { find: /^virtual:motion-kit-user-entry$/, replacement: entry },
];
export const loadingPlugin = (entry: string): Plugin => ({
  name: 'motion-kit-loading',
  enforce: 'pre',
  resolveId(id) {
    if (id === entryId) return `\0${entryId}`;
    if (id === 'virtual:motion-kit-user-entry') return entry;
    if (id === bootstrapId) return browserEntry;
    if (id === '@kimuson/motion-kit' || id === 'motion-kit') return packageEntry;
    return undefined;
  },
  load(id) {
    return id === `\0${entryId}` ? entrySource('virtual:motion-kit-user-entry') : undefined;
  },
});

/** Resolve once from the project, including linked/workspace imports. The bootstrap
 * never gets a private React installation or a second Composition implementation. */
export const reactResolution = (root: string, config: UserConfig) => {
  const require = createRequire(join(root, 'package.json'));
  const ids = [
    'react',
    'react/jsx-runtime',
    'react/jsx-dev-runtime',
    'react-dom',
    'react-dom/client',
  ];
  return {
    aliases: [
      ...ids.map((id) => ({ find: new RegExp(`^${id}$`), replacement: require.resolve(id) })),
      ...normalizeAliases(config.resolve?.alias),
    ],
    include: [...new Set([...(config.optimizeDeps?.include ?? []), ...ids])],
    directories: [dirname(require.resolve('react')), dirname(require.resolve('react-dom'))],
  };
};
