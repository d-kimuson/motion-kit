import type { Alias, AliasOptions, Plugin, UserConfig } from 'vite';

import { realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  bootstrapId,
  entryId,
  entrySource,
  previewEntryId,
  previewEntrySource,
  previewHostId,
  jsxSourceId,
  jsxSourceSource,
} from './entry-source.ts';

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
/** The preview host page's bundle, private like the bootstrap. */
export const previewEntry = builtRoot
  ? join(dirname(fileURLToPath(import.meta.url)), 'preview.js')
  : fileURLToPath(new URL('../../preview/host.tsx', import.meta.url));
/** motion-kit's own modules, which the preview's source marking leaves alone. */
const ownDirectory = builtRoot
  ? dirname(fileURLToPath(import.meta.url))
  : fileURLToPath(new URL('../../', import.meta.url));
/** Ids the loading plugin owns. Vite's alias plugin runs before `enforce: 'pre'` plugins,
 * so a project alias for these would shadow the bootstrap instead of the other way round.
 * They are prepended to `resolve.alias` so motion-kit's reserved ids win over a conflicting
 * project alias, without rejecting the project's config. The user entry is reserved too:
 * `entrySource()` imports it by id, so a project alias must not swap the entry module. */
export const reservedAliases = (entry: string): readonly Alias[] => [
  { find: /^@kimuson\/motion-kit\/browser$/, replacement: browserEntry },
  { find: /^@kimuson\/motion-kit\/preview$/, replacement: previewEntry },
  { find: /^@kimuson\/motion-kit$/, replacement: packageEntry },
  { find: /^motion-kit$/, replacement: packageEntry },
  { find: /^virtual:motion-kit-entry$/, replacement: `\u0000${entryId}` },
  { find: /^virtual:motion-kit-preview-entry$/, replacement: `\u0000${previewEntryId}` },
  { find: /^virtual:motion-kit-user-entry$/, replacement: entry },
];
export const loadingPlugin = (entry: string): Plugin => ({
  name: 'motion-kit-loading',
  enforce: 'pre',
  resolveId(id) {
    if (id === entryId) return `\0${entryId}`;
    if (id === 'virtual:motion-kit-user-entry') return entry;
    if (id === previewEntryId) return `\0${previewEntryId}`;
    if (id === bootstrapId) return browserEntry;
    if (id === previewHostId) return previewEntry;
    if (id === '@kimuson/motion-kit' || id === 'motion-kit') return packageEntry;
    return undefined;
  },
  load(id) {
    if (id === `\0${entryId}`) return entrySource('virtual:motion-kit-user-entry');
    return id === `\0${previewEntryId}` ? previewEntrySource() : undefined;
  },
});

const jsxDevImport = /(["'])react\/jsx-dev-runtime\1/g;
/**
 * Preview only: the project's modules import the source-marking JSX runtime instead of React's.
 * It rewrites the import esbuild's development JSX transform emitted, so it applies only to the
 * project's own files: not to motion-kit's modules, not to dependencies, not to the dependency
 * optimizer, and the runtime it wraps stays the project's optimized `react/jsx-dev-runtime`.
 */
export const jsxSourcePlugin = (projectRoot: string): Plugin => {
  // Vite's module ids are real paths, so a project under a symlink (macOS /var, /tmp) still matches.
  const roots = [projectRoot, realpathSync(projectRoot)].map((root) => `${root}/`);
  return {
    name: 'motion-kit-jsx-source',
    enforce: 'post',
    resolveId: (id) => (id === jsxSourceId ? `\0${jsxSourceId}` : undefined),
    load: (id) => (id === `\0${jsxSourceId}` ? jsxSourceSource() : undefined),
    transform(code, id) {
      const file = id.split('?')[0] ?? id;
      const project =
        roots.some((root) => file.startsWith(root)) &&
        !file.startsWith(ownDirectory) &&
        !file.includes('/node_modules/');
      return project && /\.[jt]sx$/.test(file)
        ? code.replace(jsxDevImport, JSON.stringify(jsxSourceId))
        : undefined;
    },
  };
};

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
