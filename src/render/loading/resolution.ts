import type { Plugin, UserConfig } from 'vite';

import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { normalizeAliases } from './config-validation.ts';
import { bootstrapId, entryId, entrySource } from './entry-source.ts';

export const browserEntry = fileURLToPath(
  new URL('../../core/runtime/browser-entry.ts', import.meta.url),
);
export const packageEntry = fileURLToPath(new URL('../../index.ts', import.meta.url));
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
