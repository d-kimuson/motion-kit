import { Command } from 'commander';

// The CLI's command table, shared by the parser (`cli.ts`) and the argv-to-command resolver
// (`invocation.ts`). Keeping the declarations in one place is what lets the resolver know which
// options consume a value: an option's value is not a positional argument, so
// `motion-kit --out /tmp/a.png render entry.tsx --json` names `render` (agent ADR: `command` comes
// from the first positional argument), not the path.

const renderCommand = new Command('render')
  .argument('<entry>')
  .option('--composition <id>')
  .requiredOption('--out <file-or-dir>')
  .option('--props <json>')
  .option('--json')
  .exitOverride()
  .configureOutput({ outputError: () => {} });

const frameCommand = new Command('frame')
  .argument('<entry>')
  .option('--composition <id>')
  .requiredOption('--frame <n>')
  .requiredOption('--out <png>')
  .option('--json')
  .exitOverride()
  .configureOutput({ outputError: () => {} });

export const commands: Readonly<Record<'render' | 'frame', Command>> = {
  render: renderCommand,
  frame: frameCommand,
};

/** The long names of the options `command` declares as taking a value (`--opt <value>`). */
const valueTakingLongs = (command: Command): string[] =>
  command.options.flatMap((option) =>
    (option.required || option.optional) && option.long !== undefined ? [option.long] : [],
  );

/**
 * The options that consume the following argv token as their value, derived from the declarations
 * above so that adding one cannot leave the resolver behind: `--composition`, `--out`, `--props`
 * and `--frame` today, while `--json` and `--help` take none.
 */
export const valueTakingOptions: ReadonlySet<string> = new Set(
  Object.values(commands).flatMap(valueTakingLongs),
);
