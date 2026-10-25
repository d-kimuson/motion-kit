import { Command, CommanderError } from 'commander';
import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';

import {
  EnvelopeSchema,
  type Envelope,
  type FrameData,
  type RenderData,
} from '../agent/cli-output.ts';
import { createFrameRate, frameToTime, toSeconds } from '../core/timeline/time.ts';
import { type Diagnostic } from '../lib/diagnostic.ts';
import { coverOnExit } from '../lib/exit.ts';
import { type FrameCaptureResult } from '../render/capture/frame.ts';
import { renderVideo } from '../render/render-video.ts';
import { createRenderer, type RenderOutcome, type Renderer } from '../render/renderer.ts';
import { CliArgsSchema, type FrameArgs, type RenderArgs } from './args.ts';

// The CLI maps every boundary to the TASK-164 envelope. Exceptions become
// `internal.unexpected` (exit 3); `cli.*` diagnostics are invocation errors
// (exit 2); every other domain diagnostic is exit 1; success is exit 0. A
// cancelled run is not a result: it emits no envelope at all and exits 128 plus
// the signal number, because aborted control flow carries no Diagnostic and the
// envelope cannot express "stopped" without inventing one (agent CONTEXT.md).

const diagnostic = (code: Diagnostic['code'], message: string, hint: string): Diagnostic => ({
  code,
  severity: 'error',
  message,
  hint,
});

const invalidArguments = (hint: string): Diagnostic =>
  diagnostic('cli.invalid-arguments', 'Command-line arguments are invalid.', hint);

const entryNotFound = (entry: string): Diagnostic =>
  diagnostic(
    'cli.entry-not-found',
    'The entry file does not exist.',
    `Check the path ${entry}; it must export a Composition registry.`,
  );

const internalUnexpected = (): Diagnostic =>
  diagnostic(
    'internal.unexpected',
    'The command failed unexpectedly.',
    'The stack trace was written to stderr; report it as a bug.',
  );

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

const commands: Readonly<Record<'render' | 'frame', Command>> = {
  render: renderCommand,
  frame: frameCommand,
};

type ParseOutcome =
  | { readonly kind: 'no-command' }
  | { readonly kind: 'help' }
  | { readonly kind: 'usage' }
  | {
      readonly kind: 'invalid';
      readonly command: 'render' | 'frame';
      readonly json: boolean;
      readonly hint: string;
    }
  | { readonly kind: 'args'; readonly value: Record<string, unknown> };

const isCommandName = (value: unknown): value is 'render' | 'frame' =>
  value === 'render' || value === 'frame';

const parseRaw = (argv: readonly string[]): ParseOutcome => {
  const name = argv[0];
  if (name === 'help' || name === '--help' || name === '-h') return { kind: 'usage' };
  if (name === undefined || !isCommandName(name)) return { kind: 'no-command' };
  const command = commands[name];
  try {
    command.parse(['node', 'motion-kit', ...argv.slice(1)], { from: 'node' });
  } catch (error) {
    if (
      error instanceof CommanderError &&
      (error.code === 'commander.helpDisplayed' || error.code === 'commander.help')
    )
      return { kind: 'help' };
    const hint =
      error instanceof Error
        ? error.message.replace(/^error: /u, '').replace(/^motion-kit: /u, '')
        : 'Check the arguments.';
    return { kind: 'invalid', command: name, json: argv.includes('--json'), hint };
  }
  const options = command.opts<Record<string, unknown>>();
  const raw: Record<string, unknown> = {
    command: name,
    entry: command.processedArgs[0],
    composition: options['composition'],
    out: options['out'],
    json: options['json'] === true,
  };
  if (name === 'render') raw['props'] = options['props'];
  if (name === 'frame') raw['frame'] = options['frame'];
  return { kind: 'args', value: raw };
};

/** Every outcome that becomes an envelope: a result, or a failure carrying Diagnostics. */
type EnvelopeOutcome =
  | {
      readonly ok: true;
      readonly data: RenderData | FrameData;
      readonly diagnostics: readonly Diagnostic[];
    }
  | { readonly ok: false; readonly data: null; readonly diagnostics: readonly Diagnostic[] };

type CommandOutcome =
  | EnvelopeOutcome
  // Cancellation is not a failure of the Composition or of the CLI, so it carries no Diagnostic.
  | { readonly ok: false; readonly aborted: true };

const failure = (diagnostics: readonly Diagnostic[]): EnvelopeOutcome => ({
  ok: false,
  data: null,
  diagnostics,
});

const abortedOutcome: CommandOutcome = { ok: false, aborted: true };

const rendererFailure = (
  outcome: Extract<RenderOutcome<Renderer>, { ok: false }>,
): CommandOutcome =>
  'aborted' in outcome
    ? abortedOutcome
    : 'error' in outcome
      ? failure([outcome.error])
      : failure([internalUnexpected()]);

const frameFailure = (result: Extract<FrameCaptureResult, { ok: false }>): CommandOutcome =>
  'aborted' in result
    ? abortedOutcome
    : 'error' in result
      ? failure([...result.error])
      : failure([internalUnexpected()]);

/** The one format rule: an .mp4 target is encoded video; every other target is a PNG directory. */
const isVideoOutput = (path: string): boolean => extname(path).toLowerCase() === '.mp4';

/**
 * The aborted line is the caller's only signal, so it says what the route actually left behind
 * (agent CONTEXT.md): the frames route has created its directory and written each captured PNG
 * as it arrived, while the mp4 route removes its temporary sibling and leaves no target.
 */
const abortedLine = (args: RenderArgs | FrameArgs): string =>
  args.command === 'render' && !isVideoOutput(args.out)
    ? `render aborted; any PNG frames already written remain in ${args.out}; no manifest.json was written`
    : `${args.command} aborted; no output was produced`;

const isFile = (path: string): boolean => {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
};

const openRenderer = async (args: RenderArgs | FrameArgs, signal: AbortSignal) => {
  const projectRoot = process.cwd();
  const entryAbsolute = resolve(projectRoot, args.entry);
  if (!isFile(entryAbsolute))
    return { ok: false as const, outcome: failure([entryNotFound(args.entry)]) };
  const renderer = await createRenderer({
    projectRoot,
    entry: args.entry,
    ...(args.composition === undefined ? {} : { compositionId: args.composition }),
    ...('props' in args && args.props !== undefined ? { props: args.props } : {}),
    signal,
  });
  if (!renderer.ok) return { ok: false as const, outcome: rendererFailure(renderer) };
  return { ok: true as const, renderer: renderer.value };
};

const runRender = async (args: RenderArgs, signal: AbortSignal): Promise<CommandOutcome> => {
  // Checked before the browser exists, so a run cancelled while it started does no work.
  if (signal.aborted) return abortedOutcome;
  const opened = await openRenderer(args, signal);
  if (!opened.ok) return opened.outcome;
  const renderer = opened.renderer;
  try {
    const descriptor = renderer.descriptor();
    const rate = createFrameRate(descriptor.fps);
    if (!rate.ok) return failure([rate.error]);
    const outAbsolute = resolve(process.cwd(), args.out);
    // The target's extension selects the format: an `.mp4` file is encoded video, and any
    // other `--out` stays the PNG frame sequence in that directory (agent CONTEXT.md).
    if (isVideoOutput(outAbsolute)) {
      mkdirSync(dirname(outAbsolute), { recursive: true });
      // The same signal reaches the encoder, which kills its child and removes the sibling.
      const encoded = await renderVideo({ composition: renderer, output: outAbsolute, signal });
      if (!encoded.ok)
        return 'aborted' in encoded
          ? abortedOutcome
          : 'error' in encoded
            ? failure([...encoded.error])
            : failure([internalUnexpected()]);
      return {
        ok: true,
        // The frames route forwards each frame's warnings; the mp4 route reports the same
        // warnings the receipt carried, so a Tier C Composition is flagged on both.
        diagnostics: [...encoded.value.diagnostics],
        data: {
          output: encoded.value.output,
          format: 'mp4',
          width: encoded.value.width,
          height: encoded.value.height,
          fps: {
            numerator: encoded.value.fps.numerator,
            denominator: encoded.value.fps.denominator,
          },
          frameCount: encoded.value.frameCount,
          durationSeconds: encoded.value.durationSeconds,
        },
      };
    }
    mkdirSync(outAbsolute, { recursive: true });
    const files: string[] = [];
    const diagnostics: Diagnostic[] = [];
    let width = descriptor.width;
    let height = descriptor.height;
    for await (const result of renderer.renderFrames({
      from: 0,
      to: descriptor.durationInFrames,
      signal,
    })) {
      if (!result.ok) return frameFailure(result);
      const name = `frame-${String(result.value.frame).padStart(5, '0')}.png`;
      writeFileSync(join(outAbsolute, name), result.value.png);
      files.push(name);
      width = result.value.width;
      height = result.value.height;
      diagnostics.push(...result.value.diagnostics);
    }
    const manifestPath = join(outAbsolute, 'manifest.json');
    writeFileSync(
      manifestPath,
      `${JSON.stringify(
        {
          schemaVersion: 1,
          format: 'frames',
          composition: descriptor.id,
          width,
          height,
          fps: descriptor.fps,
          frameCount: descriptor.durationInFrames,
          files,
        },
        null,
        2,
      )}\n`,
    );
    return {
      ok: true,
      diagnostics,
      data: {
        output: outAbsolute,
        format: 'frames',
        manifest: manifestPath,
        width,
        height,
        fps: { numerator: descriptor.fps.numerator, denominator: descriptor.fps.denominator },
        frameCount: descriptor.durationInFrames,
        durationSeconds: toSeconds(frameToTime(BigInt(descriptor.durationInFrames), rate.value)),
      },
    };
  } finally {
    await renderer.dispose();
  }
};

const runFrame = async (args: FrameArgs, signal: AbortSignal): Promise<CommandOutcome> => {
  if (signal.aborted) return abortedOutcome;
  const opened = await openRenderer(args, signal);
  if (!opened.ok) return opened.outcome;
  const renderer = opened.renderer;
  try {
    const descriptor = renderer.descriptor();
    const rate = createFrameRate(descriptor.fps);
    if (!rate.ok) return failure([rate.error]);
    const result = await renderer.renderFrame({ frame: args.frame, signal });
    if (!result.ok) return frameFailure(result);
    const outAbsolute = resolve(process.cwd(), args.out);
    writeFileSync(outAbsolute, result.value.png);
    return {
      ok: true,
      diagnostics: [...result.value.diagnostics],
      data: {
        output: outAbsolute,
        format: 'png',
        frame: result.value.frame,
        timeSeconds: toSeconds(frameToTime(BigInt(result.value.frame), rate.value)),
        width: result.value.width,
        height: result.value.height,
      },
    };
  } finally {
    await renderer.dispose();
  }
};

const buildEnvelope = (
  command: 'render' | 'frame',
  outcome: EnvelopeOutcome,
  durationMs: number,
): Envelope =>
  EnvelopeSchema.parse({
    schemaVersion: 1,
    command,
    ok: outcome.ok,
    data: outcome.data,
    diagnostics: [...outcome.diagnostics],
    durationMs,
  });

const exitCodeFor = (envelope: Envelope): number => {
  if (envelope.ok) return 0;
  const codes = envelope.diagnostics.map((item) => item.code);
  if (codes.includes('internal.unexpected')) return 3;
  if (codes.some((code) => code.startsWith('cli.'))) return 2;
  return 1;
};

const summarize = (envelope: Envelope): string => {
  if (envelope.ok && envelope.data !== null) {
    if (envelope.command === 'render') {
      const data = envelope.data;
      const verb = data.format === 'mp4' ? 'encoded' : 'rendered';
      const manifest = data.format === 'frames' ? `; manifest ${data.manifest}` : '';
      return `${verb} ${data.frameCount} frames to ${data.output} (${data.width}x${data.height})${manifest}`;
    }
    if (envelope.command === 'frame')
      return `captured frame ${envelope.data.frame} to ${envelope.data.output} (${envelope.data.width}x${envelope.data.height})`;
  }
  return `${envelope.command} failed`;
};

const printHuman = (envelope: Envelope): void => {
  for (const item of envelope.diagnostics) {
    const hint = item.hint === undefined ? '' : ` — ${item.hint}`;
    process.stderr.write(`${item.severity}: ${item.code}: ${item.message}${hint}\n`);
  }
  const summary = `${summarize(envelope)} in ${envelope.durationMs.toFixed(1)}ms`;
  if (envelope.ok) process.stdout.write(`${summary}\n`);
  else process.stderr.write(`${summary}\n`);
};

const emit = (envelope: Envelope, json: boolean): number => {
  const code = exitCodeFor(envelope);
  if (json) process.stdout.write(`${JSON.stringify(envelope)}\n`);
  else printHuman(envelope);
  return code;
};

/** The two signals a caller stops a run with; both mean the same thing to the CLI. */
const signals = ['SIGINT', 'SIGTERM'] as const;
type StopSignal = (typeof signals)[number];

/** 128 + the signal number: the shell's own reading of a run the caller interrupted. */
const abortExitCodes: Readonly<Record<StopSignal, number>> = { SIGINT: 130, SIGTERM: 143 };

/** The exit code of a cancelled run; a programmatic abort means the same as Ctrl-C. */
export const abortedExitCode = (signal: AbortSignal): number =>
  signal.reason === 'SIGTERM' ? abortExitCodes.SIGTERM : abortExitCodes.SIGINT;

/** Binds SIGINT/SIGTERM to one controller. `once` leaves a second signal to the default
 * handler, so pressing Ctrl-C twice is never held up by cleanup.
 */
export const watchSignals = (): { readonly signal: AbortSignal; readonly stop: () => void } => {
  const controller = new AbortController();
  const handlers: Record<StopSignal, () => void> = {
    SIGINT: () => controller.abort('SIGINT'),
    SIGTERM: () => controller.abort('SIGTERM'),
  };
  for (const name of signals) process.once(name, handlers[name]);
  return {
    signal: controller.signal,
    stop: () => {
      for (const name of signals) process.removeListener(name, handlers[name]);
    },
  };
};

export type RunCliOptions = {
  /** Aborts every renderer, frame and encoder the command starts (the CLI's cancellation). */
  readonly signal?: AbortSignal;
};

export const runCli = async (
  argv: readonly string[],
  options: RunCliOptions = {},
): Promise<number> => {
  const started = process.hrtime.bigint();
  const durationMs = (): number => Number(process.hrtime.bigint() - started) / 1e6;
  const signal = options.signal ?? new AbortController().signal;
  const parsed = parseRaw(argv);

  if (parsed.kind === 'help') return 0;
  if (parsed.kind === 'usage') {
    process.stdout.write(
      'Usage: motion-kit <render|frame> <entry> [options]\n\nCommands:\n  frame    capture one frame to a PNG\n  render   render a Composition to an MP4 (--out file.mp4) or to PNG frames (--out dir)\n\nRun `motion-kit <command> --help` for command options.\n',
    );
    return 0;
  }
  if (parsed.kind === 'no-command') {
    process.stderr.write(
      'Usage: motion-kit <render|frame> <entry> [options]\nRun motion-kit --help for usage.\n',
    );
    return 2;
  }
  if (parsed.kind === 'invalid')
    return emit(
      buildEnvelope(parsed.command, failure([invalidArguments(parsed.hint)]), durationMs()),
      parsed.json,
    );

  const checked = CliArgsSchema.safeParse(parsed.value);
  if (!checked.success) {
    const hint =
      checked.error.issues.map((issue) => issue.message).join('; ') || 'Check the arguments.';
    const command = isCommandName(parsed.value['command']) ? parsed.value['command'] : 'render';
    const json = parsed.value['json'] === true;
    return emit(buildEnvelope(command, failure([invalidArguments(hint)]), durationMs()), json);
  }

  let outcome: CommandOutcome;
  // A cancelled run's line is written below, but a library that exits the process from its own
  // signal handler can end the run before that line is reached; this cover is the last chance to
  // keep the caller's one statement about what the interrupted run left behind (lib/exit.ts).
  let reported = false;
  const report = (): void => {
    if (reported) return;
    reported = true;
    process.stderr.write(`${abortedLine(checked.data)}\n`);
  };
  const releaseCover = coverOnExit(report);
  try {
    try {
      outcome =
        checked.data.command === 'render'
          ? await runRender(checked.data, signal)
          : await runFrame(checked.data, signal);
    } catch (error) {
      if (error instanceof Error && error.stack !== undefined)
        process.stderr.write(`${error.stack}\n`);
      outcome = failure([internalUnexpected()]);
    }
    // A cancelled run has no envelope: aborted control flow carries no Diagnostic, and the
    // schema forbids `ok: false` without one. `--json` therefore prints nothing at all.
    if ('aborted' in outcome) {
      report();
      return abortedExitCode(signal);
    }
    return emit(buildEnvelope(checked.data.command, outcome, durationMs()), checked.data.json);
  } finally {
    releaseCover();
  }
};
