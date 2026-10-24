import { type Diagnostic } from '../../lib/diagnostic.ts';

export const loadingFailure = (operation: string): Diagnostic => ({
  code: 'render.page-error',
  severity: 'error',
  message: `Loading ${operation} failed.`,
  hint: `Check ${operation} and the project configuration; the loader uses bundled Vite 7.3.7.`,
});
export const configFailure = (name: string, config: string): Diagnostic => ({
  code: 'render.page-error',
  severity: 'error',
  message: `Loading configuration failed for "${name}" with bundled Vite 7.3.7.`,
  hint: `The project configuration and plugins must work under Vite 7; check ${config}.`,
});
/** Vite's dependency optimizer pre-bundles the project's `optimizeDeps` settings and its
 * installed dependencies, so its rejection does not prove the project's `vite.config.ts`
 * is at fault: a dependency whose own `require` cannot be resolved fails here too. Name
 * the optimizer, the bundled version and the config path, and leave the dependency
 * possibility open instead of blaming the config. */
export const optimizerFailure = (config: string): Diagnostic => ({
  code: 'render.page-error',
  severity: 'error',
  message: "Vite's dependency optimizer failed with bundled Vite 7.3.7.",
  hint: `The project's optimizeDeps settings in ${config} or one of its installed dependencies could not be pre-bundled; check both.`,
});
/** A missing preprocessor surfaces from Vite as a `vite:css` error. Name the dependency
 * the project has to install, not Vite's internal plugin. */
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
/** The dependency optimizer consumes the project's `optimizeDeps` settings, but it also
 * pre-bundles the project's installed dependencies, so a rejection there can name either
 * the project's config or a dependency; only Vite's banner says the optimizer was the
 * rejector. Vite styles that banner with picocolors, which turns color on whenever `CI`
 * or `FORCE_COLOR` is set (GitHub Actions sets `CI`), so look for the banner anywhere in
 * the message instead of at its start. Only Vite's optimizer writes this phrase (once, in
 * the pinned 7.3.7 sources), so the marker stays precise whichever async path reports the
 * failure. */
export const viteOptimizerFailure = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  'message' in error &&
  typeof error.message === 'string' &&
  error.message.includes('Error during dependency optimization');
/** Only producer-authored names enter Diagnostics; never raw exception text/stacks. */
export class LoadingConfigError extends Error {
  readonly key: string;
  constructor(key: string) {
    super('Unsupported loading configuration');
    this.key = key;
  }
}
