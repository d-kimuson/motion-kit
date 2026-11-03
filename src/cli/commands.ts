import { Command } from 'commander';

// The CLI's command table, shared by the parser (`cli.ts`) and the argv-to-command resolver
// (`invocation.ts`). Keeping the declarations in one place is what lets the resolver know which
// options consume a value: an option's value is not a positional argument, so
// `motion-kit --out /tmp/a.png render entry.tsx --json` names `render` (agent ADR: `command` comes
// from the first positional argument), not the path.

/**
 * How the help tells a reader to run the CLI. The reader may not have the package installed, and
 * `npx` runs its one bin (`motion-kit`) either way, so every usage line names this rather than the
 * bare bin.
 */
export const cliInvocation = 'npx @kimuson/motion-kit';

/** A subcommand whose `--help` usage line starts with `cliInvocation` instead of its bare name. */
const cliCommand = (name: string): Command =>
  new Command(name).configureHelp({
    commandUsage: (command) => `${cliInvocation} ${command.name()} ${command.usage()}`,
  });

const renderCommand = cliCommand('render')
  .argument('<entry>')
  .option('--composition <id>')
  .requiredOption('--out <file-or-dir>')
  .option('--props <json>')
  .option('--concurrency <n>')
  .option('--video-crf <n>')
  .option('--video-bitrate <kbps>')
  .option('--scale <factor-or-WxH>')
  .option('--fps <rational-or-decimal>')
  .option(
    '--from <frame-or-time>',
    'first frame to render: a Global Frame, mm:ss[.fff] or <seconds>s',
  )
  .option('--to <frame-or-time>', 'exclusive end: a Global Frame, mm:ss[.fff] or <seconds>s')
  .option('--project-root <dir>')
  .option('--vite-config <path>')
  .option('--software-webgl')
  .option('--disable-sandbox')
  .option('--verbose', 'stream the page and loading-service output instead of holding it back')
  .option('--quiet', 'hide the renderer log and the progress lines')
  .option('--json')
  .exitOverride()
  .configureOutput({ outputError: () => {} });

const frameCommand = cliCommand('frame')
  .argument('<entry>')
  .option('--composition <id>')
  .requiredOption(
    '--frame <n>',
    'frame indices, repeatable or comma-separated',
    (value: string, previous: string[]) => [...previous, value],
    [],
  )
  .requiredOption('--out <file-or-dir>', 'a .png file, or a directory for frame-<n>.png files')
  .option('--props <json>')
  .option('--project-root <dir>')
  .option('--vite-config <path>')
  .option('--software-webgl')
  .option('--disable-sandbox')
  .option('--verbose', 'stream the page and loading-service output instead of holding it back')
  .option('--quiet', 'hide the renderer log')
  .option('--json')
  .exitOverride()
  .configureOutput({ outputError: () => {} });

const contactSheetCommand = cliCommand('contact-sheet')
  .argument('<entry>')
  .option('--composition <id>')
  .option('--every <n>', 'a tile every n frames, from the range start, ending on its last frame')
  .option(
    '--frame <n>',
    'explicit frame indices, repeatable or comma-separated',
    (value: string, previous: string[]) => [...previous, value],
    [],
  )
  .requiredOption('--out <file.png>', 'the PNG file the grid of tiles is written to')
  .option('--columns <n>', 'tiles per row (default: 4, capped at the tile count)')
  .option('--tile-width <px>', 'one tile\u2019s width in sheet pixels (default: 320)')
  .option(
    '--from <frame-or-time>',
    'first frame the sheet draws from: a Global Frame, mm:ss[.fff] or <seconds>s',
  )
  .option('--to <frame-or-time>', 'exclusive end of the frames the sheet draws from')
  .option('--props <json>')
  .option('--project-root <dir>')
  .option('--vite-config <path>')
  .option('--software-webgl')
  .option('--disable-sandbox')
  .option('--verbose', 'stream the page and loading-service output instead of holding it back')
  .option('--quiet', 'hide the renderer log')
  .option('--json')
  .exitOverride()
  .configureOutput({ outputError: () => {} });

const checkCommand = cliCommand('check')
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
  .option('--verbose', 'stream the page and loading-service output instead of holding it back')
  .option('--quiet', 'hide the renderer log')
  .option('--json')
  .exitOverride()
  .configureOutput({ outputError: () => {} });

const previewCommand = cliCommand('preview')
  .argument('<entry>')
  .option('--composition <id>')
  .option('--props <json>')
  .option('--preview-fps <n>', 'frames sampled per second while playing (default: 12)')
  .option('--port <n>', 'loopback port to listen on (default: an ephemeral one)')
  .option('--project-root <dir>')
  .option('--vite-config <path>')
  .option('--json')
  .exitOverride()
  .configureOutput({ outputError: () => {} });

const docsCommand = cliCommand('docs')
  .argument('[topic]')
  .option('--list')
  .option('--json')
  .exitOverride()
  .configureOutput({ outputError: () => {} });

export const commands: Readonly<
  Record<'render' | 'frame' | 'contact-sheet' | 'docs' | 'check' | 'preview', Command>
> = {
  render: renderCommand,
  frame: frameCommand,
  'contact-sheet': contactSheetCommand,
  docs: docsCommand,
  check: checkCommand,
  preview: previewCommand,
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
 * `--preview-fps`, `--port`, `--from`, `--to`, `--project-root` and `--vite-config` today, while
 * boolean flags take none.
 *
 * Only long names are collected: `--opt <value>` is the form the resolver skips. A value-taking
 * option declared with a short alias (`-o <value>`) would slip past it, so none has one today, and
 * `invocation.test.ts` fails the moment a value-taking option gains a short name — the resolver then
 * has to collect `option.short` here too instead of falling behind silently.
 */
export const valueTakingOptions: ReadonlySet<string> = new Set(
  Object.values(commands).flatMap(valueTakingLongs),
);
