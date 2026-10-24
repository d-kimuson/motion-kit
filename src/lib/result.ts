import { type Diagnostic } from './diagnostic.ts';

/** Recoverable boundary failures carry a public Diagnostic rather than an exception.
 * The error parameter lets a caller return several Diagnostics without a second result type.
 */
export type Result<T, E = Diagnostic> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };
