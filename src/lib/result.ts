import { type Diagnostic } from './diagnostic.ts';

/** Recoverable boundary failures carry a public Diagnostic rather than an exception. */
export type Result<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: Diagnostic };
