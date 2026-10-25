import { CommandSchema, type Command } from '../agent/cli-output.ts';

// The envelope names the command an invocation asked for, and the promise to a caller is one JSON
// document on stdout even when the invocation is unusable. Deriving that name from argv must
// therefore not depend on commander succeeding: a parse failure still has to say which command
// failed. The name is a member of the contract's enum or null — never a sentinel such as
// `"unknown"`, which would enlarge the enum for a value no command produces.

/**
 * The known subcommand argv names: its first positional argument. The CLI has no global flags, so
 * in a usable invocation that argument is the subcommand itself. An invocation that never reaches
 * one (`--json`) and one that names something else (`unknown`, or a typo) both resolve to null,
 * because argv then names no command the CLI knows.
 */
export const resolveCommand = (argv: readonly string[]): Command | null => {
  const positional = argv.find((argument) => !argument.startsWith('-'));
  const known = CommandSchema.safeParse(positional);
  return known.success ? known.data : null;
};
