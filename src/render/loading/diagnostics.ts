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
/** Only producer-authored names enter Diagnostics; never raw exception text/stacks. */
export class LoadingConfigError extends Error {
  readonly key: string;
  constructor(key: string) {
    super('Unsupported loading configuration');
    this.key = key;
  }
}
