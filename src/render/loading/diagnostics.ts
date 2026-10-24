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
/** Only producer-authored names enter Diagnostics; never raw exception text/stacks. */
export class LoadingConfigError extends Error {
  readonly key: string;
  constructor(key: string) {
    super('Unsupported loading configuration');
    this.key = key;
  }
}
