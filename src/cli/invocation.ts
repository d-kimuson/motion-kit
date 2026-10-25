import { CommandSchema, type Command } from '../agent/cli-output.ts';
import { valueTakingOptions } from './commands.ts';

// The envelope names the command an invocation asked for, and the promise to a caller is one JSON
// document on stdout even when the invocation is unusable. Deriving that name from argv must
// therefore not depend on commander succeeding: a parse failure still has to say which command
// failed. The name is a member of the contract's enum or null — never a sentinel such as
// `"unknown"`, which would enlarge the enum for a value no command produces.

/**
 * The first positional argument of argv: the first token that is neither a flag nor a flag's
 * value. A flag declared to take a value consumes the next token (`valueTakingOptions`, derived from
 * the CLI's own command declarations), so `--out`'s neighbour is not a positional argument — that is
 * what keeps `--out /tmp/a.png render entry.tsx` naming `render` rather than the path. A flag
 * written as `--opt=value` needs no case of its own: it carries its value in the same token, so it
 * never equals a declared flag name and the scan simply continues to the next token, which stays
 * positional (`--out=/tmp/a.png render entry.tsx` names `render`). The `--` terminator needs no
 * case either: it is a flag-shaped token taking no value, so the scan continues past it.
 */
const firstPositional = (argv: readonly string[]): string | undefined => {
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === undefined) return undefined;
    if (!token.startsWith('-')) return token;
    if (valueTakingOptions.has(token)) index += 1;
  }
  return undefined;
};

/**
 * The known subcommand argv names, or null. The candidate is the first positional argument, so a
 * subcommand written after a flag is still named truthfully (the CLI reports it as misplaced) and
 * a flag's value never takes its place. An invocation that never reaches a positional (`--json`)
 * and one that names something else (`unknown`, or a typo) both resolve to null, because argv then
 * names no command the CLI knows. A reserved subcommand (`inspect`, `validate`) resolves to itself:
 * the enum is the contract's, not the implementation's.
 */
export const resolveCommand = (argv: readonly string[]): Command | null => {
  const known = CommandSchema.safeParse(firstPositional(argv));
  return known.success ? known.data : null;
};
