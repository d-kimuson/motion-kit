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
  .option('--video-crf <n>')
  .option('--video-bitrate <kbps>')
  .option('--scale <factor-or-WxH>')
  .option('--fps <rational-or-decimal>')
  .option('--project-root <dir>')
  .option('--vite-config <path>')
  .option('--software-webgl')
  .option('--disable-sandbox')
  .option('--json')
  .exitOverride()
  .configureOutput({ outputError: () => {} });

const frameCommand = new Command('frame')
  .argument('<entry>')
  .option('--composition <id>')
  .requiredOption(
    '--frame <n>',
    'frame indices, repeatable or comma-separated',
    (value: string, previous: string[]) => [...previous, value],
    [],
  )
  .requiredOption('--out <file-or-dir>')
  .option('--props <json>')
  .option('--project-root <dir>')
  .option('--vite-config <path>')
  .option('--software-webgl')
  .option('--disable-sandbox')
  .option('--json')
  .exitOverride()
  .configureOutput({ outputError: () => {} });

const checkCommand = new Command('check')
  .argument('<entry>')
  .option('--composition <id>')
  .requiredOption(
    '--frame <n>',
    'sample frame indices, repeatable or comma-separated',
    (value: string, previous: string[]) => [...previous, value],
    [],
  )
  .option(
    '--predecessor <n>',
    'predecessor frame indices, repeatable or comma-separated',
    (value: string, previous: string[]) => [...previous, value],
    [],
  )
  .option(
    '--history <name>',
    'capture histories, repeatable or comma-separated',
    (value: string, previous: string[]) => [...previous, value],
    [],
  )
  .option('--exact', 'compare PNG bytes instead of decoded pixels')
  .option('--channel-tolerance <0-255>', 'per-channel tolerance in pixels mode')
  .option('--changed-ratio <0..1>', 'maximum changed-pixel ratio in pixels mode')
  .option('--props <json>')
  .option('--project-root <dir>')
  .option('--vite-config <path>')
  .option('--software-webgl')
  .option('--disable-sandbox')
  .option('--json')
  .exitOverride()
  .configureOutput({ outputError: () => {} });

const docsCommand = new Command('docs')
  .argument('[topic]')
  .option('--list')
  .option('--json')
  .exitOverride()
  .configureOutput({ outputError: () => {} });

export const commands: Readonly<Record<'render' | 'frame' | 'docs' | 'check', Command>> = {
  render: renderCommand,
  frame: frameCommand,
  docs: docsCommand,
  check: checkCommand,
};

/** The long names of the options `command` declares as taking a value (`--opt <value>`). */
const valueTakingLongs = (command: Command): string[] =>
  command.options.flatMap((option) =>
    (option.required || option.optional) && option.long !== undefined ? [option.long] : [],
  );

/**
 * The options that consume the following argv token as their value, derived from the declarations
 * above so that adding one cannot leave the resolver behind: `--composition`, `--out`, `--props`,
 * `--concurrency`, `--frame`, `--predecessor`, `--history`, `--channel-tolerance`, `--changed-ratio`,
 * `--project-root` and `--vite-config` today, while boolean flags take none.
 *
 * Only long names are collected: `--opt <value>` is the form the resolver skips. A value-taking
 * option declared with a short alias (`-o <value>`) would slip past it, so none has one today, and
 * `invocation.test.ts` fails the moment a value-taking option gains a short name — the resolver then
 * has to collect `option.short` here too instead of falling behind silently.
 */
export const valueTakingOptions: ReadonlySet<string> = new Set(
  Object.values(commands).flatMap(valueTakingLongs),
);
