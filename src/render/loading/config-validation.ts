import type { Alias, AliasOptions, UserConfig } from 'vite';

import { createRequire } from 'node:module';
import { join } from 'node:path';

import { LoadingConfigError } from './diagnostics.ts';

// Deliberate serve/middleware subset: build/preview/SSR/environments/worker output
// settings cannot affect this page and must not be silently accepted.
const keys: Record<string, readonly string[]> = {
  '': [
    'root',
    'base',
    'publicDir',
    'cacheDir',
    'mode',
    'define',
    'plugins',
    'resolve',
    'css',
    'json',
    'esbuild',
    'assetsInclude',
    'logLevel',
    'customLogger',
    'clearScreen',
    'envDir',
    'envPrefix',
    'server',
    'optimizeDeps',
    'appType',
    'configFile',
  ],
  resolve: ['alias', 'dedupe', 'conditions', 'mainFields', 'extensions', 'preserveSymlinks'],
  css: [
    'modules',
    'postcss',
    'preprocessorOptions',
    'preprocessorMaxWorkers',
    'devSourcemap',
    'transformer',
    'lightningcss',
  ],
  'css.modules': [
    'scopeBehaviour',
    'globalModulePaths',
    'generateScopedName',
    'hashPrefix',
    'localsConvention',
  ],
  'css.preprocessorOptions': ['scss', 'sass', 'less', 'styl', 'stylus'],
  json: ['namedExports', 'stringify'],
  esbuild: [
    'jsx',
    'jsxFactory',
    'jsxFragment',
    'jsxInject',
    'jsxImportSource',
    'jsxDev',
    'include',
    'exclude',
    'target',
    'tsconfigRaw',
    'supported',
    'legalComments',
    'charset',
    'keepNames',
    'drop',
    'dropLabels',
    'pure',
    'define',
    'logOverride',
    'banner',
    'footer',
  ],
  server: ['watch', 'fs', 'cors', 'headers', 'warmup', 'sourcemapIgnoreList'],
  'server.fs': ['strict', 'allow', 'deny', 'cachedChecks'],
  'server.warmup': ['clientFiles'],
  optimizeDeps: [
    'include',
    'exclude',
    'entries',
    'extensions',
    'needsInterop',
    'noDiscovery',
    'holdUntilCrawlEnd',
    // esbuildOptions is intentionally unsupported: its build API includes
    // output/entry overrides Vite's optimizer does not apply. Do not admit an
    // opaque nested branch without a qualified serve-mode key policy.
    'force',
  ],
};
const isAliasArray = (value: AliasOptions): value is readonly Alias[] => Array.isArray(value);
export const normalizeAliases = (aliases: AliasOptions = {}): readonly Alias[] =>
  isAliasArray(aliases)
    ? aliases
    : Object.entries(aliases).map(([find, replacement]) => ({ find, replacement }));

export const validateConfig = (config: UserConfig, projectRoot: string): void => {
  const visit = (value: unknown, path: string) => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return;
    const allowed = keys[path];
    if (allowed === undefined) return;
    for (const [key, child] of Object.entries(value)) {
      const name = path === '' ? key : `${path}.${key}`;
      if (!allowed.includes(key)) throw new LoadingConfigError(name);
      visit(child, name);
    }
  };
  visit(config, '');
  const names = normalizeAliases(config.resolve?.alias).map((alias) => alias.find);
  for (const name of names) {
    const reserved = [
      'virtual:motion-kit-entry',
      'virtual:motion-kit-user-entry',
      '@kimuson/motion-kit/browser',
      '@kimuson/motion-kit',
      'motion-kit',
    ];
    if (
      reserved.some((id) =>
        typeof name === 'string'
          ? id === name || id.startsWith(`${name}/`)
          : new RegExp(name.source, name.flags).test(id),
      )
    )
      throw new LoadingConfigError(`resolve.alias:${String(name)}`);
  }
  if (
    config.base !== undefined &&
    (!config.base.startsWith('/') || config.base.startsWith('//') || /[?#]/.test(config.base))
  )
    throw new LoadingConfigError('base');
  const require = createRequire(join(projectRoot, 'package.json'));
  const requirePreprocessor = (name: string, alternatives = [name]) => {
    if (
      !alternatives.some((item) => {
        try {
          require.resolve(item);
          return true;
        } catch {
          return false;
        }
      })
    )
      throw new LoadingConfigError(name);
  };
  for (const name of Object.keys(config.css?.preprocessorOptions ?? {})) {
    if (name === 'sass' || name === 'scss') requirePreprocessor('sass', ['sass-embedded', 'sass']);
    else requirePreprocessor(name === 'styl' ? 'stylus' : name);
  }
  if (config.css?.transformer === 'lightningcss') requirePreprocessor('lightningcss');
};

// CSS @imports can invoke a preprocessor inside vite:css without a separate
// transform hook. Use Vite's own dependency error (including nested imports),
// not the outer module extension or the generic vite:css plugin attribution.
export const preprocessorFailure = (error: unknown): string | undefined => {
  if (
    typeof error !== 'object' ||
    error === null ||
    !('plugin' in error) ||
    error.plugin !== 'vite:css' ||
    !('message' in error) ||
    typeof error.message !== 'string'
  )
    return undefined;
  const name = /Preprocessor dependency "(sass-embedded|sass|less|stylus)" not found\./.exec(
    error.message,
  )?.[1];
  return name === 'sass-embedded' ? 'sass' : name;
};

export const checkPreprocessorFile = (id: string, root: string) => {
  const extension = /\.(scss|sass|less|styl|stylus)(?:\?|$)/.exec(id)?.[1];
  if (extension !== undefined)
    validateConfig({ css: { preprocessorOptions: { [extension]: {} } } }, root);
};
