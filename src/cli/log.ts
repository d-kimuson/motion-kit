import { z } from 'zod';

import { type LogLevel, type LogRecord } from '../lib/log.ts';

// The CLI's side of the stderr contract (agent ADR: CLI stderr): the two flags that move a command
// off the default log level, and the block a failed run owes a reader when the renderer's own
// output was held back. The level itself and the records it keeps live in `src/lib/log.ts`, beside
// the `Diagnostic` both contexts already share.

/** `--verbose` and `--quiet` as the argv parser collects them: absent is `false`. */
export type LogFlags = { readonly verbose: boolean; readonly quiet: boolean };

/**
 * The flags to the level they select. Passing both is an invocation error rather than a silent
 * winner, because either answer would surprise the caller who asked for the other.
 */
export const logFlagsSchema = z
  .strictObject({ verbose: z.boolean(), quiet: z.boolean() })
  .refine((flags) => !(flags.verbose && flags.quiet), {
    message: 'Use --verbose or --quiet, not both.',
  })
  .transform((flags): LogLevel => {
    if (flags.verbose) return 'verbose';
    return flags.quiet ? 'quiet' : 'normal';
  });

/** Reads the two boolean options commander reports out of the parsed argv. */
export const logFlagsOf = (options: {
  readonly verbose?: unknown;
  readonly quiet?: unknown;
}): LogFlags => ({ verbose: options.verbose === true, quiet: options.quiet === true });

/**
 * What a failed run says about the renderer's output it held back: the lines themselves, in the
 * order they arrived, with one line naming the flags that change what happens to them. Empty for a
 * failure that never got as far as opening a browser, so a caller with nothing to show says nothing.
 */
export const failureLogBlock = (records: readonly LogRecord[]): string => {
  if (records.length === 0) return '';
  const lines = records.flatMap((record) => record.text.split('\n'));
  const subject =
    records.length === 1
      ? '1 line; --verbose streams it as it arrives'
      : `${records.length} lines; --verbose streams them as they arrive`;
  return [`renderer log (${subject}):`, ...lines.map((line) => `  ${line}`), ''].join('\n');
};
