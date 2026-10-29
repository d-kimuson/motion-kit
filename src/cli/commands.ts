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
  .option('--concurrency <n>')
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

const docsCommand = new Command('docs')
  .argument('[topic]')
  .option('--list')
  .option('--json')
  .exitOverride()
  .configureOutput({ outputError: () => {} });

export const commands: Readonly<Record<'render' | 'frame' | 'docs', Command>> = {
  render: renderCommand,
  frame: frameCommand,
  docs: docsCommand,
};

/** The long names of the options `command` declares as taking a value (`--opt <value>`). */
const valueTakingLongs = (command: Command): string[] =>
  command.options.flatMap((option) =>
    (option.required || option.optional) && option.long !== undefined ? [option.long] : [],
  );

/**
 * The options that consume the following argv token as their value, derived from the declarations
 * above so that adding one cannot leave the resolver behind: `--composition`, `--out`, `--props`,
 * `--concurrency` and `--frame` today, while `--json` and `--help` take none.
 *
 * Only long names are collected: `--opt <value>` is the form the resolver skips. A value-taking
 * option declared with a short alias (`-o <value>`) would slip past it, so none has one today, and
 * `invocation.test.ts` fails the moment a value-taking option gains a short name — the resolver then
 * has to collect `option.short` here too instead of falling behind silently.
 */
export const valueTakingOptions: ReadonlySet<string> = new Set(
  Object.values(commands).flatMap(valueTakingLongs),
);
