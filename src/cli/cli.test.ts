import { Ajv2020 } from 'ajv/dist/2020.js';
import { execFile, execFileSync, spawn, type ChildProcess } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import committedSchema from '../../docs/contexts/agent/schema/cli-output.v1.schema.json' with { type: 'json' };
import { EnvelopeSchema, type Envelope } from '../agent/cli-output.ts';
import { currentDate } from '../lib/clock.ts';
import { runCli } from './cli.ts';

const require = createRequire(import.meta.url);
const execFileAsync = promisify(execFile);
// The shipped bin, exercised as the entry script with plain Node.
const bin = new URL('./main.js', import.meta.url).pathname;
const validateJson = new Ajv2020({ strictTypes: false }).compile(committedSchema);

let projectRoot: string;
let outputRoot: string;

beforeAll(() => {
  projectRoot = mkdtempSync(join(tmpdir(), 'motion-kit-cli-'));
  outputRoot = mkdtempSync(join(tmpdir(), 'motion-kit-cli-output-'));
  mkdirSync(join(projectRoot, 'node_modules'));
  for (const name of ['react', 'react-dom', 'zod'])
    symlinkSync(
      dirname(require.resolve(`${name}/package.json`)),
      join(projectRoot, 'node_modules', name),
    );
  writeFileSync(join(projectRoot, 'package.json'), '{"type":"module"}');
  writeFileSync(
    join(projectRoot, 'entry.ts'),
    `export {compositions} from ${JSON.stringify(
      new URL('../core/runtime/fixtures/capture.tsx', import.meta.url).pathname,
    )};`,
  );
  writeFileSync(
    join(projectRoot, 'entry-required.tsx'),
    `import { defineComposition, defineCompositions } from ${JSON.stringify(
      new URL('../core/composition/registry.ts', import.meta.url).pathname,
    )};
import { z } from 'zod';
const Scene = ({ text }: { text: string }) => <div>{text}</div>;
export const compositions = defineCompositions([
  defineComposition({ id: 'one', schema: z.object({ text: z.string().default('hello') }), component: Scene, width: 32, height: 32, fps: { numerator: 30, denominator: 1 }, durationInFrames: 3 }),
  defineComposition({ id: 'two', schema: z.object({ text: z.string() }), component: Scene, width: 32, height: 32, fps: { numerator: 30, denominator: 1 }, durationInFrames: 3 }),
]);`,
  );
  // A sequence long enough that a stop signal sent after the first PNG really is mid-render.
  writeFileSync(
    join(projectRoot, 'entry-long.tsx'),
    `import { z } from 'zod';
import { defineComposition, defineCompositions } from ${JSON.stringify(
      new URL('../core/composition/registry.ts', import.meta.url).pathname,
    )};
const Scene = () => <div style={{ width: 32, height: 32, background: '#333333' }} />;
export const compositions = defineCompositions([
  defineComposition({ id: 'long', schema: z.object({}), component: Scene, width: 32, height: 32, fps: { numerator: 30, denominator: 1 }, durationInFrames: 120 }),
]);`,
  );
});

afterAll(() => {
  rmSync(projectRoot, { recursive: true, force: true });
  rmSync(outputRoot, { recursive: true, force: true });
});

type RunResult = {
  readonly code: number;
  readonly envelope?: Envelope;
  readonly stdout: string;
  readonly stderr: string;
};

/**
 * Runs the shipped bin. `options.envelope: false` says the argv is one that legitimately carries
 * `--json` without the CLI owing an envelope — the help exemption — so stdout is left unparsed.
 */
const run = async (
  args: readonly string[],
  env?: Record<string, string | undefined>,
  options: { readonly envelope?: false } = {},
): Promise<RunResult> => {
  let stdout = '';
  let stderr = '';
  let code = 0;
  try {
    const result = await execFileAsync(process.execPath, [bin, ...args], {
      cwd: projectRoot,
      timeout: 120_000,
      maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env, ...env },
    });
    stdout = result.stdout;
    stderr = result.stderr;
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'stdout' in error &&
      typeof error.stdout === 'string'
    )
      stdout = error.stdout;
    if (
      typeof error === 'object' &&
      error !== null &&
      'stderr' in error &&
      typeof error.stderr === 'string'
    )
      stderr = error.stderr;
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      typeof error.code === 'number'
    )
      code = error.code;
  }
  const trimmed = stdout.trim();
  const envelope =
    options.envelope !== false && args.includes('--json') && trimmed !== ''
      ? EnvelopeSchema.parse(JSON.parse(trimmed))
      : undefined;
  return { code, envelope, stdout, stderr };
};

const assertValidEnvelope = (result: RunResult): Envelope => {
  const envelope = result.envelope;
  expect(envelope).toBeDefined();
  if (envelope === undefined) throw new Error('Envelope missing');
  expect(validateJson(envelope)).toBe(true);
  return envelope;
};

/**
 * Polls a filesystem fact a child process produces; a render has no other progress signal. `what`
 * names that fact, so a timeout says what never happened instead of guessing a route.
 */
const waitFor = async (ready: () => boolean, timeoutMs: number, what: string): Promise<void> => {
  const started = currentDate().getTime();
  while (!ready()) {
    if (currentDate().getTime() - started > timeoutMs)
      throw new Error(`the run never produced ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
};

/**
 * Whether the process is gone. A process that has been killed but not reaped yet still answers,
 * and a cover cannot wait for the reap (`src/lib/exit.ts`), so a caller that checks this right
 * after a signalled run ends polls for it instead of reading it once.
 *
 * It is also the only answer to "is the run still there", which is what a test means when it aims
 * a signal at a window: `child.exitCode` moves when the exit event is delivered, and that can be
 * after the exit itself, so reading it says nothing about whether the process still answers.
 */
const childGone = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return false;
  } catch {
    return true;
  }
};

/** Asserts the run still answers, so a signal sent next lands on it rather than on nothing. */
const expectStillRunning = (pid: number, when: string): void => {
  if (childGone(pid)) throw new Error(`the run was already gone when ${when}`);
};

/**
 * A stand-in encoder that passes the probe and then outlives the frame handover, ignoring
 * `SIGTERM` the way a real FFmpeg finishing its output does. That is what keeps the run in its
 * cleanup window: the parent's `SIGTERM` is ignored, so its bounded grace has to elapse.
 */
const standInEncoder = (directory: string): string => {
  const pidFile = join(directory, 'encode.pid');
  writeFileSync(
    join(directory, 'ffmpeg'),
    `#!/bin/sh
case "$1" in
  -version) printf 'ffmpeg version 9.0.1 Copyright (c) 2000-2026 the FFmpeg developers\\n'; exit 0 ;;
  -hide_banner) printf 'Encoders:\\n V....D libx264              libx264 H.264 / AVC\\n'; exit 0 ;;
esac
printf '%s' "$$" > "${pidFile}"
trap '' TERM
exec sleep 30
`,
    { mode: 0o755 },
  );
  return pidFile;
};

/** The command line a process was started with, to tell the loading service from the encoder. */
const commandOf = (pid: number): string => {
  try {
    return execFileSync('ps', ['-o', 'command=', '-p', String(pid)], { encoding: 'utf8' });
  } catch {
    return '';
  }
};

type SpawnedRun = {
  readonly child: ChildProcess;
  readonly stdout: () => string;
  readonly stderr: () => string;
  readonly exit: Promise<{ readonly code: number | null; readonly signal: NodeJS.Signals | null }>;
};

/** The shipped bin as a child process whose stop signals the test itself decides when to send. */
const spawnRun = (
  args: readonly string[],
  env: Record<string, string>,
  cwd: string = projectRoot,
  nodeArgs: readonly string[] = [],
): SpawnedRun => {
  const child = spawn(process.execPath, [...nodeArgs, bin, ...args], {
    cwd,
    env: { ...process.env, ...env },
  });
  let stdout = '';
  let stderr = '';
  child.stdout?.setEncoding('utf8');
  child.stderr?.setEncoding('utf8');
  child.stdout?.on('data', (chunk: string) => {
    stdout += chunk;
  });
  child.stderr?.on('data', (chunk: string) => {
    stderr += chunk;
  });
  const exit = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });
  return { child, stdout: () => stdout, stderr: () => stderr, exit };
};

const abortedLines = (stderr: string): readonly string[] =>
  stderr.split('\n').filter((line) => line.includes('aborted'));

/** The processes a run owns directly: its encoder, its loading service and its browser. */
const childrenOf = (pid: number): readonly number[] => {
  const children: number[] = [];
  for (const line of execFileSync('ps', ['-Ao', 'pid=,ppid='], { encoding: 'utf8' }).split('\n')) {
    const [own, parent] = line.trim().split(/\s+/).map(Number);
    if (own !== undefined && parent === pid) children.push(own);
  }
  return children;
};

const docsTopicRows = [
  { id: 'index', summary: 'Overview, requirements, quickstart, and the guide map.' },
  { id: 'getting-started', summary: 'Install, write a first entry, and render it.' },
  { id: 'cli', summary: 'Commands, flags, the JSON envelope, diagnostics, and exit codes.' },
  {
    id: 'authoring',
    summary: 'Compositions, props, time hooks, sequences, transitions, assets, and audio.',
  },
  { id: 'determinism', summary: 'What a pure function of time guarantees and what breaks it.' },
  {
    id: 'examples',
    summary: 'The reference videos, their commands, placeholders, and asset policy.',
  },
  { id: 'troubleshooting', summary: 'What to do for each diagnostic code.' },
] as const;

describe('motion-kit CLI', () => {
  it.each([
    { flags: ['--project-root', 'missing'], env: {}, hint: '--project-root' },
    { flags: ['--vite-config', 'missing'], env: {}, hint: '--vite-config' },
    { flags: [], env: { MOTION_KIT_SOFTWARE_WEBGL: 'yes' }, hint: 'MOTION_KIT_SOFTWARE_WEBGL' },
    { flags: [], env: { MOTION_KIT_PROJECT_ROOT: 'missing' }, hint: 'MOTION_KIT_PROJECT_ROOT' },
  ])('reports invalid renderer configuration: $hint', async ({ flags, env, hint }) => {
    const result = await run(
      [
        'frame',
        'entry.ts',
        '--frame',
        '0',
        '--out',
        join(outputRoot, 'invalid.png'),
        ...flags,
        '--json',
      ],
      env,
    );
    expect(result.code).toBe(2);
    const envelope = assertValidEnvelope(result);
    expect(envelope).toMatchObject({
      command: 'frame',
      ok: false,
      diagnostics: [{ code: 'cli.invalid-arguments' }],
    });
    expect(envelope.diagnostics[0]?.hint).toContain(hint);
  });

  it('uses the environment root and allows flags to override invalid environment settings', async () => {
    const result = await run(
      [
        'frame',
        'entry.ts',
        '--composition',
        'one',
        '--frame',
        '0',
        '--out',
        join(outputRoot, 'configured.png'),
        '--project-root',
        projectRoot,
        '--software-webgl',
        '--json',
      ],
      {
        MOTION_KIT_PROJECT_ROOT: 'missing',
        MOTION_KIT_SOFTWARE_WEBGL: 'invalid',
      },
    );
    expect(result.code).toBe(0);
    expect(assertValidEnvelope(result).ok).toBe(true);
    const alias = join(outputRoot, 'environment-project');
    symlinkSync(projectRoot, alias);
    const applied = await run(
      [
        'frame',
        'entry.ts',
        '--composition',
        'one',
        '--frame',
        '0',
        '--out',
        join(outputRoot, 'env-configured.png'),
        '--json',
      ],
      { MOTION_KIT_PROJECT_ROOT: alias, MOTION_KIT_SOFTWARE_WEBGL: 'true' },
    );
    expect(applied.code).toBe(0);
    expect(assertValidEnvelope(applied).ok).toBe(true);
  }, 60_000);

  it('loads the explicit Vite config in every pooled renderer', async () => {
    const marker = join(outputRoot, 'vite-config-marker');
    writeFileSync(
      join(projectRoot, 'chosen.config.ts'),
      `import { appendFileSync } from 'node:fs';\nappendFileSync(${JSON.stringify(marker)}, 'loaded\\n');\nexport default {};`,
    );
    const result = await run([
      'render',
      'entry.ts',
      '--composition',
      'one',
      '--out',
      join(outputRoot, 'configured-frames'),
      '--concurrency',
      '2',
      '--vite-config',
      'chosen.config.ts',
      '--json',
    ]);
    expect(result.code).toBe(0);
    expect(assertValidEnvelope(result).ok).toBe(true);
    expect(readFileSync(marker, 'utf8').trim().split('\n')).toHaveLength(2);
  }, 120_000);
  it('prints docs/index.md verbatim when no topic is given', async () => {
    const result = await run(['docs']);
    expect(result.code).toBe(0);
    expect(result.stdout).toBe(
      readFileSync(new URL('../../docs/index.md', import.meta.url), 'utf8'),
    );
  });

  it('prints docs/guide/<topic>.md verbatim for a topic', async () => {
    const result = await run(['docs', 'cli']);
    expect(result.code).toBe(0);
    expect(result.stdout).toBe(
      readFileSync(new URL('../../docs/guide/cli.md', import.meta.url), 'utf8'),
    );
  });

  it('lists every topic in the documented order with its summary', async () => {
    const result = await run(['docs', '--list']);
    expect(result.code).toBe(0);
    expect(
      result.stdout
        .trimEnd()
        .split('\n')
        .map((line) => {
          const [id, summary] = line.split('\t');
          return { id, summary };
        }),
    ).toEqual(docsTopicRows.map((row) => ({ ...row })));
  });

  it('emits the documented docs data for a topic and for --list under --json', async () => {
    const topic = await run(['docs', 'getting-started', '--json']);
    expect(topic.code).toBe(0);
    const topicEnvelope = assertValidEnvelope(topic);
    expect(topicEnvelope).toMatchObject({
      command: 'docs',
      ok: true,
      data: {
        format: 'markdown',
        topic: 'getting-started',
        content: readFileSync(
          new URL('../../docs/guide/getting-started.md', import.meta.url),
          'utf8',
        ),
      },
    });

    const list = await run(['docs', '--list', '--json']);
    expect(list.code).toBe(0);
    const listEnvelope = assertValidEnvelope(list);
    expect(listEnvelope).toMatchObject({
      command: 'docs',
      ok: true,
      data: { format: 'list', topics: docsTopicRows.map((row) => ({ ...row })) },
    });
  });

  it('rejects an unknown docs topic as one cli.invalid-arguments envelope with the topics in the hint', async () => {
    const result = await run(['docs', 'missing', '--json']);
    expect(result.code).toBe(2);
    const envelope = assertValidEnvelope(result);
    expect(envelope).toMatchObject({ command: 'docs', ok: false, data: null });
    expect(envelope.diagnostics[0]).toMatchObject({
      code: 'cli.invalid-arguments',
    });
    for (const topic of docsTopicRows) expect(envelope.diagnostics[0]?.hint).toContain(topic.id);
    expect(result.stdout.trim().split('\n')).toHaveLength(1);
  });

  it('rejects --list with a topic as one cli.invalid-arguments envelope', async () => {
    const result = await run(['docs', 'cli', '--list', '--json']);
    expect(result.code).toBe(2);
    const envelope = assertValidEnvelope(result);
    expect(envelope).toMatchObject({ command: 'docs', ok: false, data: null });
    expect(envelope.diagnostics[0]).toMatchObject({ code: 'cli.invalid-arguments' });
    expect(envelope.diagnostics[0]?.hint).toContain('--list takes no topic');
    for (const topic of docsTopicRows) expect(envelope.diagnostics[0]?.hint).toContain(topic.id);
    expect(result.stdout.trim().split('\n')).toHaveLength(1);
  });

  it('reports an unknown docs topic on stderr without --json', async () => {
    const result = await run(['docs', 'missing']);
    expect(result.code).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('cli.invalid-arguments');
    for (const topic of docsTopicRows) expect(result.stderr).toContain(topic.id);
  });

  it('lists docs in the leading help and exits 0 for docs --help', async () => {
    const leading = await run(['--help'], undefined, { envelope: false });
    expect(leading.code).toBe(0);
    expect(leading.stdout).toContain('docs [topic]');
    expect(leading.stdout).toContain('motion-kit docs getting-started');
    expect(leading.stdout).toContain('motion-kit docs` to print the guide');

    const own = await run(['docs', '--help', '--json'], undefined, { envelope: false });
    expect(own.code).toBe(0);
    expect(own.stdout).toContain('Usage: ');
    expect(own.stdout).not.toContain('"schemaVersion"');
  });

  it('captures one frame to a PNG with the v1 frame envelope', async () => {
    const output = join(outputRoot, 'frame.png');
    const result = await run([
      'frame',
      'entry.ts',
      '--composition',
      'one',
      '--frame',
      '2',
      '--out',
      output,
      '--json',
    ]);
    expect(result.code).toBe(0);
    const envelope = assertValidEnvelope(result);
    expect(envelope).toMatchObject({
      schemaVersion: 1,
      command: 'frame',
      ok: true,
      diagnostics: [],
      data: { output, format: 'png', frame: 2, width: 64, height: 64 },
    });
    expect(statSync(output).isFile()).toBe(true);
    expect(readFileSync(output).length).toBeGreaterThan(0);
  }, 60_000);

  it('renders a frame sequence and manifest with the v1 render envelope', async () => {
    const output = join(outputRoot, 'frames');
    const result = await run([
      'render',
      'entry.ts',
      '--composition',
      'one',
      '--out',
      output,
      '--json',
    ]);
    expect(result.code).toBe(0);
    const envelope = assertValidEnvelope(result);
    expect(envelope).toMatchObject({
      schemaVersion: 1,
      command: 'render',
      ok: true,
      data: { output, format: 'frames', frameCount: 6, width: 64, height: 64 },
    });
    if (envelope.command !== 'render') throw new Error('expected render envelope');
    const data = envelope.data;
    if (data === null || data.format !== 'frames') throw new Error('render data missing');
    expect(data.manifest).toBe(join(output, 'manifest.json'));
    expect(existsSync(data.manifest)).toBe(true);
    for (let frame = 0; frame < 6; frame++)
      expect(existsSync(join(output, `frame-${String(frame).padStart(5, '0')}.png`))).toBe(true);
  }, 60_000);

  it('writes the same frames from several renderers as from one', async () => {
    const render = async (concurrency: string) => {
      const output = join(outputRoot, `frames-${concurrency}`);
      const result = await run([
        'render',
        'entry.ts',
        '--composition',
        'one',
        '--concurrency',
        concurrency,
        '--out',
        output,
        '--json',
      ]);
      expect(result.code).toBe(0);
      return Array.from({ length: 6 }, (_, frame) =>
        readFileSync(join(output, `frame-${String(frame).padStart(5, '0')}.png`)),
      );
    };
    const single = await render('1');
    const pooled = await render('3');
    expect(pooled.map((png, frame) => png.equals(single[frame] ?? Buffer.alloc(0)))).toEqual(
      Array.from({ length: 6 }, () => true),
    );
  }, 120_000);

  it('renders a Composition to an MP4 with the v1 mp4 render envelope', async () => {
    const output = join(outputRoot, 'video.mp4');
    const result = await run([
      'render',
      'entry.ts',
      '--composition',
      'one',
      '--out',
      output,
      '--json',
    ]);
    expect(result.code).toBe(0);
    const envelope = assertValidEnvelope(result);
    expect(envelope).toMatchObject({
      schemaVersion: 1,
      command: 'render',
      ok: true,
      data: {
        output,
        format: 'mp4',
        frameCount: 6,
        width: 64,
        height: 64,
        fps: { numerator: 30000, denominator: 1001 },
      },
    });
    if (envelope.command !== 'render') throw new Error('expected render envelope');
    const data = envelope.data;
    if (data === null || data.format !== 'mp4') throw new Error('mp4 data missing');
    expect(data.durationSeconds).toBeCloseTo(6 / (30000 / 1001), 3);
    expect(statSync(output).size).toBeGreaterThan(0);
    // A run that finished says nothing about a cancellation, not even on the way out.
    expect(result.stderr).not.toContain('render aborted');
    // The temporary sibling is renamed onto the target, never left behind.
    expect(readdirSync(outputRoot).filter((name) => name.includes('.part'))).toEqual([]);
    const probed = execFileSync('ffprobe', [
      '-v',
      'error',
      '-select_streams',
      'v:0',
      '-show_entries',
      'stream=codec_name,nb_frames,r_frame_rate,avg_frame_rate,duration',
      '-of',
      'default=noprint_wrappers=1',
      output,
    ]).toString();
    expect(probed).toContain('codec_name=h264');
    expect(probed).toContain('nb_frames=6');
    // The non-integer rate reaches the file as the rational, not as a rounded float.
    expect(probed).toContain('r_frame_rate=30000/1001');
    expect(probed).toContain('avg_frame_rate=30000/1001');
    expect(probed).toContain('duration=0.200200');
  }, 120_000);

  it('reports the captured warnings of a successful mp4 render, like the frames route', async () => {
    const warning = { code: 'seek.uncontrolled', severity: 'warning' };
    const video = join(outputRoot, 'tier-c.mp4');
    const encoded = await run([
      'render',
      'entry.ts',
      '--composition',
      'one',
      '--props',
      '{"mode":"uncontrolled"}',
      '--out',
      video,
      '--json',
    ]);
    expect(encoded.code).toBe(0);
    const encodedEnvelope = assertValidEnvelope(encoded);
    expect(encodedEnvelope.ok).toBe(true);
    expect(encodedEnvelope.diagnostics).toHaveLength(6);
    for (const item of encodedEnvelope.diagnostics) expect(item).toMatchObject(warning);
    expect(encodedEnvelope.diagnostics[0]?.location?.frame).toBe(0);
    expect(encodedEnvelope.diagnostics[5]?.location?.frame).toBe(5);

    // The frames route is the reference: the same Composition, the same warnings.
    const frames = join(outputRoot, 'tier-c-frames');
    const rendered = await run([
      'render',
      'entry.ts',
      '--composition',
      'one',
      '--props',
      '{"mode":"uncontrolled"}',
      '--out',
      frames,
      '--json',
    ]);
    expect(rendered.code).toBe(0);
    const renderedEnvelope = assertValidEnvelope(rendered);
    expect(renderedEnvelope.diagnostics).toEqual(encodedEnvelope.diagnostics);
  }, 120_000);

  it('ends a cancelled run as aborted control flow, with no envelope on either route', async () => {
    const controller = new AbortController();
    controller.abort();
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      const framesTarget = join(outputRoot, 'cancelled');
      const routes = [
        {
          target: join(outputRoot, 'cancelled.mp4'),
          said: 'render aborted; no output was produced',
        },
        {
          target: framesTarget,
          said: `render aborted; any PNG frames already written remain in ${framesTarget}; no manifest.json was written`,
        },
      ];
      for (const route of routes) {
        stderr.mockClear();
        const code = await runCli(
          ['render', 'entry.ts', '--composition', 'one', '--out', route.target, '--json'],
          { signal: controller.signal },
        );
        // 128 + SIGINT: the caller stopped the run, so it is neither a domain failure (1),
        // an invocation error (2) nor an internal bug (3).
        expect(code).toBe(130);
        expect(existsSync(route.target)).toBe(false);
        // The stderr line is the caller's only signal, so it has to be true of this route: the
        // frames route keeps the PNGs it already wrote and stops before the manifest.
        const lines = stderr.mock.calls
          .map(([chunk]) => String(chunk))
          .join('')
          .split('\n')
          .filter((line) => line !== '');
        expect(lines[0]).toContain('render aborted');
        expect(lines).toEqual([route.said]);
        expect(lines.join('')).not.toContain('internal.unexpected');
      }
      // A cancellation has no Diagnostic to put in an envelope, so nothing claims one.
      expect(stdout).not.toHaveBeenCalled();
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
    }
  });

  it('stops one SIGINT with exactly the route’s own aborted line and no leftovers', async () => {
    // The first signal is the caller's cancellation, not a death by signal: the run ends its own
    // way, on either route, and says once what that route actually left. Both routes are checked
    // because the sentence differs: the mp4 route produced nothing, while the frames route keeps
    // the PNGs it already wrote and stops before the manifest that would claim the sequence whole.
    const fake = mkdtempSync(join(tmpdir(), 'motion-kit-single-signal-'));
    // The stand-in never finishes the encode and ignores `SIGTERM`, so the run is stopped with its
    // temporary sibling on disk and has to wait out its bounded grace before the child is gone.
    const encoderPid = standInEncoder(fake);
    const video = join(outputRoot, 'interrupted.mp4');
    const frames = join(outputRoot, 'interrupted-frames');
    const routes = [
      {
        args: ['render', 'entry.ts', '--composition', 'one'],
        target: video,
        what: 'the encoder and its temporary sibling',
        ready: (): boolean =>
          existsSync(encoderPid) && readdirSync(outputRoot).some((name) => name.includes('.part')),
        said: 'render aborted; no output was produced',
        // A process the cancellation killed: its death is a fact a moment after the run's own
        // `exit`, not at it, so the caller polls for it below instead of reading it there.
        killed: (): readonly number[] => [Number(readFileSync(encoderPid, 'utf8'))],
        left: (): void => {
          expect(existsSync(video)).toBe(false);
          expect(readdirSync(outputRoot).filter((name) => name.includes('.part'))).toEqual([]);
        },
      },
      {
        args: ['render', 'entry-long.tsx', '--composition', 'long'],
        target: frames,
        what: 'the first PNG of the sequence',
        ready: (): boolean =>
          existsSync(frames) && readdirSync(frames).some((name) => name.endsWith('.png')),
        said: `render aborted; any PNG frames already written remain in ${frames}; no manifest.json was written`,
        killed: (): readonly number[] => [],
        left: (): void => {
          // The line says the written frames remain, so they had better be there.
          expect(
            readdirSync(frames).filter((name) => name.endsWith('.png')).length,
          ).toBeGreaterThan(0);
          expect(existsSync(join(frames, 'manifest.json'))).toBe(false);
        },
      },
    ];
    try {
      for (const route of routes) {
        const run = spawnRun([...route.args, '--out', route.target, '--json'], {
          PATH: `${fake}:${process.env['PATH'] ?? ''}`,
        });
        try {
          await waitFor(route.ready, 60_000, route.what);
          // The run owns children while it is in flight, and owes them a death either way.
          const owned = childrenOf(run.child.pid ?? 0);
          expect(owned.length).toBeGreaterThan(0);

          run.child.kill('SIGINT');
          // A code rather than a death by signal: the run ended through its own cleanup.
          expect(await run.exit).toEqual({ code: 130, signal: null });
          // No envelope was fabricated for the cancellation, and the line appears exactly once.
          expect(run.stdout()).toBe('');
          expect(abortedLines(run.stderr())).toEqual([route.said]);
          route.left();
          // A direct child the cancellation killed: poll for its death within a bound far shorter
          // than the 30 s the stand-in would live on its own, so a run that never killed it fails.
          for (const pid of route.killed())
            await waitFor(
              () => childGone(pid),
              10_000,
              'the process the cancellation killed to be gone',
            );
          // Nothing the run started outlives it: the encoder, the loading service and the browser.
          await waitFor(() => owned.every(childGone), 10_000, 'every child it started to be gone');
          expect(owned.filter((pid) => !childGone(pid))).toEqual([]);
        } finally {
          if (run.child.exitCode === null && run.child.signalCode === null)
            run.child.kill('SIGKILL');
        }
      }
    } finally {
      rmSync(fake, { recursive: true, force: true });
    }
  }, 180_000);

  it('keeps the cancellation contract when another SIGINT listener exits the process', async () => {
    // A library that launches a child process can take SIGINT over for it:
    // playwright-core's `addProcessHandlerIfNeeded` adds its own listener on browser launch and
    // its handler exits the process (130) as soon as its browsers close — inside the same
    // signal dispatch as the CLI's handler, before the CLI's asynchronous cleanup can finish.
    // The preload below is that library: it registers behind the CLI's listener and leaves
    // through `process.exit`. The line, the removed temporary and the killed children must
    // survive it: Playwright itself is launched with its own signal handling off, but no
    // cancellation guarantee may depend on which listeners another library happens to install.
    const fake = mkdtempSync(join(tmpdir(), 'motion-kit-hostile-signal-'));
    const encoderPid = join(fake, 'encode.pid');
    writeFileSync(
      join(fake, 'ffmpeg'),
      `#!/bin/sh
case "$1" in
  -version) printf 'ffmpeg version 9.0.1 Copyright (c) 2000-2026 the FFmpeg developers\\n'; exit 0 ;;
  -hide_banner) printf 'Encoders:\\n V....D libx264              libx264 H.264 / AVC\\n'; exit 0 ;;
esac
printf '%s' "$$" > "${encoderPid}"
exec sleep 30
`,
      { mode: 0o755 },
    );
    const preload = join(fake, 'hostile-sigint.mjs');
    const claimed = join(fake, 'hostile.ran');
    writeFileSync(
      preload,
      `import { writeFileSync } from 'node:fs';
let registered = false;
process.on('newListener', (event) => {
  if (event !== 'SIGINT' || registered) return;
  registered = true;
  // The CLI's own listener is added right after this event; land behind it, as a library that
  // hooks the signal when it launches a child process does.
  process.nextTick(() =>
    process.on('SIGINT', () => {
      // The marker proves the process really was ended by another listener: without it this
      // case would only exercise the CLI's own, ordered cleanup.
      writeFileSync(${JSON.stringify(claimed)}, 'exit 130');
      process.exit(130);
    }),
  );
});
`,
    );
    const output = join(outputRoot, 'interrupted-hostile.mp4');
    const child = spawn(
      process.execPath,
      [
        '--import',
        preload,
        bin,
        'render',
        'entry.ts',
        '--composition',
        'one',
        '--out',
        output,
        '--json',
      ],
      { cwd: projectRoot, env: { ...process.env, PATH: `${fake}:${process.env['PATH'] ?? ''}` } },
    );
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });
    try {
      await waitFor(
        () =>
          existsSync(encoderPid) && readdirSync(outputRoot).some((name) => name.includes('.part')),
        60_000,
        'the encoder and its temporary sibling',
      );
      // The run owns an encoder and a loading service while it is in flight.
      const running = child.pid;
      if (running === undefined) throw new Error('the run has no pid');
      const owned = childrenOf(running);
      expect(owned.length).toBeGreaterThan(0);
      child.kill('SIGINT');
      const code = await new Promise<number | null>((resolve) => {
        child.once('exit', (exitCode) => resolve(exitCode));
      });
      expect(code).toBe(130);
      // The other listener really did end the process, so the rest is the last-resort cleanup.
      expect(readFileSync(claimed, 'utf8')).toBe('exit 130');
      // The caller is still told what the cancelled run left, even though another listener
      // ended the process: one line, the route's own sentence, and no envelope.
      expect(stdout).toBe('');
      expect(stderr.split('\n').filter((line) => line.includes('render aborted'))).toEqual([
        'render aborted; no output was produced',
      ]);
      expect(existsSync(output)).toBe(false);
      expect(readdirSync(outputRoot).filter((name) => name.includes('.part'))).toEqual([]);
      // Nothing the run started outlives it: the encoder, the loading service and the browser.
      await waitFor(() => owned.every(childGone), 10_000, 'every child it started to be gone');
      expect(owned.filter((pid) => !childGone(pid))).toEqual([]);
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      rmSync(fake, { recursive: true, force: true });
    }
  }, 120_000);

  // Every gap a second `Ctrl-C` really arrives at, all of them inside the mp4 route's cleanup
  // window: the stand-in ignores the encoder's `SIGTERM`, so the run stays alive with its
  // temporary sibling on disk until its 2 s grace expires. `process.once` used to hand a second
  // signal to Node's default disposition in all three cases, which terminates the process without
  // running a single `exit` listener: the sibling and its child outlived the run.
  it.each([5, 120, 1_000])(
    'ends a second SIGINT %ims into the cleanup window at once, through the covers, with no .part sibling left',
    async (gap) => {
      const fake = mkdtempSync(join(tmpdir(), `motion-kit-second-signal-${gap}-`));
      const encoderPid = standInEncoder(fake);
      const output = join(outputRoot, `second-signal-${gap}.mp4`);
      const run = spawnRun(
        ['render', 'entry.ts', '--composition', 'one', '--out', output, '--json'],
        {
          PATH: `${fake}:${process.env['PATH'] ?? ''}`,
        },
      );
      try {
        await waitFor(
          () =>
            existsSync(encoderPid) &&
            readdirSync(outputRoot).some((name) => name.includes('.part')),
          60_000,
          'the encoder and its temporary sibling',
        );
        const owned = childrenOf(run.child.pid ?? 0);
        expect(owned.length).toBeGreaterThan(0);
        const pid = run.child.pid;
        if (pid === undefined) throw new Error('the run has no pid');
        run.child.kill('SIGINT');
        await new Promise((resolve) => setTimeout(resolve, gap));
        // The first signal's cleanup is still in flight, so the covers are all that can run. The
        // run is still there as an OS fact, not as `exitCode`, which only moves once its exit is
        // delivered: a window this test aims a signal at is checked with the same call that says a
        // child is gone.
        expectStillRunning(pid, 'the second signal was sent');
        expect(readdirSync(outputRoot).filter((name) => name.includes('.part'))).not.toEqual([]);
        const secondSignalAt = currentDate().getTime();
        run.child.kill('SIGINT');

        const ended = await run.exit;
        // A code rather than a death by signal: the second signal went through the covers instead
        // of the default disposition, so nothing was skipped.
        expect(ended).toEqual({ code: 130, signal: null });
        // Prompt: it does not wait out the 2 s the stand-in's SIGTERM grace would take.
        expect(currentDate().getTime() - secondSignalAt).toBeLessThan(1_000);
        expect(run.stdout()).toBe('');
        // Exactly one line, and it is true of this route: no target, no sibling, no survivor.
        expect(abortedLines(run.stderr())).toEqual(['render aborted; no output was produced']);
        expect(existsSync(output)).toBe(false);
        expect(readdirSync(outputRoot).filter((name) => name.includes('.part'))).toEqual([]);
        // The cover `SIGKILL`s the encoder on the way out but cannot wait for it: an exiting
        // process runs no promise. The run is gone at once, while the OS still has to schedule the
        // child's death and reap it, so "gone" is a fact a moment after `exit`, not at it. Poll for
        // it, within a bound far shorter than the 30 s the stand-in would live on its own, so the
        // wait still proves the run killed it.
        const encoder = Number(readFileSync(encoderPid, 'utf8'));
        await waitFor(() => childGone(encoder), 10_000, 'the encoder it killed to be gone');
        await waitFor(() => owned.every(childGone), 10_000, 'every child it started to be gone');
        expect(owned.filter((pid) => !childGone(pid))).toEqual([]);
      } finally {
        if (run.child.exitCode === null && run.child.signalCode === null) run.child.kill('SIGKILL');
        rmSync(fake, { recursive: true, force: true });
      }
    },
    180_000,
  );

  it('ends a second SIGINT at once on the frames route too', async () => {
    // The same signal path on the route whose cleanup is short: a second SIGINT must still leave
    // by the covers, so the caller keeps the route's one line and no manifest appears.
    const target = join(outputRoot, 'second-signal-frames');
    const run = spawnRun(
      ['render', 'entry-long.tsx', '--composition', 'long', '--out', target, '--json'],
      {},
    );
    try {
      await waitFor(
        () => existsSync(target) && readdirSync(target).some((name) => name.endsWith('.png')),
        60_000,
        'the first PNG of the sequence',
      );
      run.child.kill('SIGINT');
      await new Promise((resolve) => setTimeout(resolve, 5));
      run.child.kill('SIGINT');

      const ended = await run.exit;
      expect(ended).toEqual({ code: 130, signal: null });
      expect(run.stdout()).toBe('');
      expect(abortedLines(run.stderr())).toEqual([
        `render aborted; any PNG frames already written remain in ${target}; no manifest.json was written`,
      ]);
      // The sequence stopped mid-way and was never claimed complete.
      expect(readdirSync(target).filter((name) => name.endsWith('.png')).length).toBeGreaterThan(0);
      expect(existsSync(join(target, 'manifest.json'))).toBe(false);
    } finally {
      if (run.child.exitCode === null && run.child.signalCode === null) run.child.kill('SIGKILL');
      rmSync(target, { recursive: true, force: true });
    }
  }, 120_000);

  it('treats SIGHUP as a cancellation, leaving no leftovers and no surviving children', async () => {
    // A closed terminal is a stop signal like any other. With Playwright's own SIGHUP handler
    // disabled and nobody watching it, SIGHUP took the default action, which is a fatal
    // termination: no `exit` listener ran, so the sibling stayed and the children survived.
    const fake = mkdtempSync(join(tmpdir(), 'motion-kit-hangup-'));
    const encoderPid = standInEncoder(fake);
    const output = join(outputRoot, 'hangup.mp4');
    // Two renderers, so the run owns two loading services and every one of them must go.
    const run = spawnRun(
      [
        'render',
        'entry.ts',
        '--composition',
        'one',
        '--concurrency',
        '2',
        '--out',
        output,
        '--json',
      ],
      {
        PATH: `${fake}:${process.env['PATH'] ?? ''}`,
      },
    );
    try {
      await waitFor(
        () =>
          existsSync(encoderPid) && readdirSync(outputRoot).some((name) => name.includes('.part')),
        60_000,
        'the encoder and its temporary sibling',
      );
      const owned = childrenOf(run.child.pid ?? 0);
      const encoder = Number(readFileSync(encoderPid, 'utf8'));
      // The run owns the loading services and the encoder directly, and all are in flight here.
      const named = owned.filter(
        (pid) => pid === encoder || commandOf(pid).includes('loading/child.js'),
      );
      expect(named).toHaveLength(3);

      run.child.kill('SIGHUP');
      const ended = await run.exit;
      // 128 + 1: the hangup is a cancellation, not a death by signal.
      expect(ended).toEqual({ code: 129, signal: null });
      expect(run.stdout()).toBe('');
      expect(abortedLines(run.stderr())).toEqual(['render aborted; no output was produced']);
      expect(existsSync(output)).toBe(false);
      expect(readdirSync(outputRoot).filter((name) => name.includes('.part'))).toEqual([]);
      // Nothing the run started outlives it, the loading service's own process group included.
      await waitFor(() => owned.every(childGone), 10_000, 'every child it started to be gone');
      expect(owned.filter((pid) => !childGone(pid))).toEqual([]);
    } finally {
      if (run.child.exitCode === null && run.child.signalCode === null) run.child.kill('SIGKILL');
      rmSync(fake, { recursive: true, force: true });
    }
  }, 120_000);

  // The window this pins is the one after the commit: the artifact is on disk and the run is still
  // tearing the renderer down (a page-dispose deadline, the service-dispose race, a browser kill),
  // which outlasts the render itself. Reporting that teardown as a cancellation denied an output
  // the directory already held, on both routes.
  //
  // The window is made, not hoped for: the project stalls both halves of the teardown (the realm's
  // cleanup and the service's close) so it spans close to a second after the commit, and the second
  // signal waits for the run's own receipt of the first instead of for a slept gap. A run that ends
  // its teardown early still fails loudly, and at the aliveness check rather than at the exit code.
  it('does not deny a committed output when a second signal lands in the finished run’s teardown', async () => {
    const root = mkdtempSync(join(tmpdir(), 'motion-kit-teardown-window-'));
    mkdirSync(join(root, 'node_modules'));
    for (const name of ['react', 'react-dom', 'zod'])
      symlinkSync(
        dirname(require.resolve(`${name}/package.json`)),
        join(root, 'node_modules', name),
      );
    writeFileSync(join(root, 'package.json'), '{"type":"module"}');
    // A plugin that never finishes closing: the loading service answers the parent's `dispose` with
    // a `server.close()` that cannot resolve, so the run cannot leave until the session's 250 ms
    // service-dispose race expires. That is what makes the window — the artifact on disk, teardown
    // still running — wide enough to aim a signal pair at, and it is teardown, not the render: the
    // project loads and captures normally, exactly as a slow user plugin would.
    writeFileSync(
      join(root, 'vite.config.ts'),
      `export default {plugins:[{name:'stall-teardown',closeBundle(){return new Promise(()=>{});}}]};`,
    );
    // The run's own receipt for a signal: a listener that lands behind the CLI's own (the order a
    // library hooking the signal gets, `cli.ts` `watchSignals`) and records that the first signal
    // was dispatched. The test waits for that receipt instead of sleeping a guessed gap, so the
    // second signal is a real second dispatch rather than a delivery that may coalesce with the
    // first and leave the covers unrun.
    const firstSignalDispatched = join(root, 'first-signal-dispatched');
    const preload = join(root, 'signal-receipt.mjs');
    writeFileSync(
      preload,
      `import { writeFileSync } from 'node:fs';
let registered = false;
process.on('newListener', (event) => {
  if (event !== 'SIGINT' || registered) return;
  registered = true;
  process.nextTick(() =>
    process.on('SIGINT', () => {
      writeFileSync(${JSON.stringify(firstSignalDispatched)}, 'dispatched');
    }),
  );
});
`,
    );
    // The other half of the window: a renderer whose teardown cannot answer. The Composition's
    // unmount runs a cleanup that does not return, so the run spends the session's 500 ms
    // page-dispose deadline inside the teardown as well. With the service race above that is
    // ~770 ms measured between the committed artifact and the exit — three times what the stall
    // alone bought — while still being teardown, after the commit and before the exit.
    writeFileSync(
      join(root, 'entry.tsx'),
      `import { useEffect } from 'react';
import { z } from 'zod';
import { defineComposition, defineCompositions } from ${JSON.stringify(
        new URL('../core/composition/registry.ts', import.meta.url).pathname,
      )};
const Scene = () => {
  useEffect(() => () => {
    const until = Date.now() + 1000;
    while (Date.now() < until) {}
  }, []);
  return <div style={{ width: 32, height: 32, background: '#333333' }} />;
};
export const compositions = defineCompositions([
  defineComposition({ id: 'stalled', schema: z.object({}), component: Scene, width: 32, height: 32, fps: { numerator: 30, denominator: 1 }, durationInFrames: 6 }),
]);`,
    );
    const video = join(outputRoot, 'teardown-window.mp4');
    const frames = join(outputRoot, 'teardown-window-frames');
    const routes = [
      {
        target: video,
        what: 'the encoded MP4',
        ready: (): boolean => existsSync(video),
        intact: (): void => {
          expect(statSync(video).size).toBeGreaterThan(0);
          const probed = execFileSync('ffprobe', [
            '-v',
            'error',
            '-select_streams',
            'v:0',
            '-show_entries',
            'stream=codec_name,nb_frames',
            '-of',
            'default=noprint_wrappers=1',
            video,
          ]).toString();
          expect(probed).toContain('codec_name=h264');
          expect(probed).toContain('nb_frames=6');
          expect(readdirSync(outputRoot).filter((name) => name.includes('.part'))).toEqual([]);
        },
      },
      {
        target: frames,
        what: 'the manifest that claims the sequence complete',
        ready: (): boolean => existsSync(join(frames, 'manifest.json')),
        intact: (): void => {
          const manifest: unknown = JSON.parse(readFileSync(join(frames, 'manifest.json'), 'utf8'));
          expect(manifest).toMatchObject({ format: 'frames', frameCount: 6 });
          expect(readdirSync(frames).filter((name) => name.endsWith('.png'))).toHaveLength(6);
        },
      },
    ];
    try {
      for (const route of routes) {
        rmSync(firstSignalDispatched, { force: true });
        const run = spawnRun(
          ['render', 'entry.tsx', '--composition', 'stalled', '--out', route.target, '--json'],
          {},
          root,
          ['--import', preload],
        );
        try {
          await waitFor(route.ready, 120_000, route.what);
          const pid = run.child.pid;
          if (pid === undefined) throw new Error('the run has no pid');
          // The artifact is committed and the run is still in its teardown, not before the commit:
          // both are OS/filesystem facts, so the signals below land inside the window rather than
          // after it. `child.exitCode` would say nothing here — it moves on delivery of the exit,
          // which is exactly the gap this case used to lose its second signal in.
          expectStillRunning(pid, 'the first signal was sent');
          const owned = childrenOf(pid);
          expect(owned.length).toBeGreaterThan(0);
          run.child.kill('SIGINT');
          // The first signal was dispatched before the second is sent, so the second one is not a
          // delivery coalescing with an unhandled first: no slept gap, and the run is still there.
          await waitFor(
            () => existsSync(firstSignalDispatched),
            10_000,
            'the run to take the first signal',
          );
          expectStillRunning(pid, 'the second signal was sent');
          run.child.kill('SIGINT');

          const ended = await run.exit;
          // The second signal still ends the process at once, through the covers.
          expect(ended).toEqual({ code: 130, signal: null });
          // The point of the case: nothing on stderr describes the committed output as missing.
          expect(abortedLines(run.stderr())).toEqual([]);
          expect(run.stderr()).not.toContain('no output was produced');
          expect(run.stderr()).not.toContain('no manifest.json was written');
          // A stopped run still fabricates no envelope; the artifact itself is the result.
          expect(run.stdout()).toBe('');
          route.intact();
          await waitFor(() => owned.every(childGone), 10_000, 'every child it started to be gone');
          expect(owned.filter((pid) => !childGone(pid))).toEqual([]);
        } finally {
          if (run.child.exitCode === null && run.child.signalCode === null)
            run.child.kill('SIGKILL');
        }
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(video, { force: true });
      rmSync(frames, { recursive: true, force: true });
    }
  }, 120_000);

  // The help exemption exactly as the ADR enumerates it: a leading `--help`, `-h` or `help`, or the
  // `--help`/`-h` a leading subcommand is asked for, prints usage on stdout and exits 0 with or
  // without `--json` — and emits no envelope. Any other position (`--json --help`,
  // `--json render entry.tsx --help`) is an unusable invocation and gets the envelope instead.
  it.each([
    { argv: ['--help'] },
    { argv: ['-h'] },
    { argv: ['help'] },
    { argv: ['--help', '--json'] },
    { argv: ['help', '--json'] },
    { argv: ['render', '--help', '--json'] },
    { argv: ['render', '-h', '--json'] },
    { argv: ['render', 'entry.tsx', '--help'] },
    { argv: ['frame', '--json', '-h'] },
    { argv: ['docs', '--help', '--json'] },
    { argv: ['docs', '-h', '--json'] },
  ])('prints usage and exits 0 for $argv', async ({ argv }) => {
    const result = await run(argv, undefined, { envelope: false });
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Usage: ');
    // The usage line is a help answer, not an invocation error: nothing about it on stderr (which
    // still carries Node's own warnings) and no envelope on stdout, whatever argv also carries.
    expect(result.stderr).not.toContain('Usage: ');
    expect(result.stderr).not.toContain('cli.invalid-arguments');
    expect(result.stdout).not.toContain('"schemaVersion"');
  });

  // The promise to an agent is one JSON document on stdout, always: an invocation that names no
  // runnable subcommand still gets the envelope. `command` is the first positional argument, so a
  // real subcommand written after a flag is named truthfully (and the hint says where it belongs),
  // a flag's value never takes its place, and a reserved one is named as not implemented yet. The
  // message follows: only a reserved subcommand's argv is well-formed, so only it must not be told
  // its arguments are invalid.
  it.each([
    {
      argv: ['--json'],
      command: null,
      message: 'Command-line arguments are invalid.',
      hint: 'Pass one of the known subcommands: render, frame, docs, inspect, validate.',
    },
    {
      argv: ['unknown', '--json'],
      command: null,
      message: 'Command-line arguments are invalid.',
      hint: 'Pass one of the known subcommands: render, frame, docs, inspect, validate.',
    },
    {
      argv: ['inspect', '--json'],
      command: 'inspect',
      message: 'The inspect subcommand is not implemented yet.',
      hint: 'inspect is not implemented yet; use render, frame or docs.',
    },
    {
      argv: ['validate', '--json'],
      command: 'validate',
      message: 'The validate subcommand is not implemented yet.',
      hint: 'validate is not implemented yet; use render, frame or docs.',
    },
    {
      argv: ['render', '--bogus', '--json'],
      command: 'render',
      message: 'Command-line arguments are invalid.',
      hint: "required option '--out <file-or-dir>' not specified",
    },
    // Misplaced: `render` is named although the option's value `/tmp/a.png` comes first, and the
    // `--composition` value `frame` is not mistaken for the command. `--help` after the subcommand
    // does not rescue it either: help is the leading token, or a subcommand's own --help, not any
    // argument that happens to sit behind a misplaced one.
    {
      argv: ['--out', '/tmp/a.png', 'render', 'entry.tsx', '--json'],
      command: 'render',
      message: 'Command-line arguments are invalid.',
      hint: 'Put the subcommand first: motion-kit render [options].',
    },
    {
      argv: ['--composition', 'frame', 'render', 'entry.tsx', '--json'],
      command: 'render',
      message: 'Command-line arguments are invalid.',
      hint: 'Put the subcommand first: motion-kit render [options].',
    },
    {
      argv: ['--json', 'render', 'entry.tsx', '--help'],
      command: 'render',
      message: 'Command-line arguments are invalid.',
      hint: 'Put the subcommand first: motion-kit render [options].',
    },
  ])('emits one envelope and exits 2 for $argv', async ({ argv, command, message, hint }) => {
    const result = await run(argv);
    expect(result.code).toBe(2);
    const envelope = assertValidEnvelope(result);
    expect(envelope).toMatchObject({ command, ok: false, data: null });
    expect(envelope.diagnostics).toMatchObject([{ code: 'cli.invalid-arguments', message, hint }]);
    expect(result.stdout.trim().split('\n')).toHaveLength(1);
    // The document is the whole of the human-visible failure: no Diagnostic line on stderr.
    expect(result.stderr).not.toContain('cli.invalid-arguments');
  });

  it.each([{ argv: [] as string[] }, { argv: ['unknown'] }])(
    'prints an invocation error to stderr and nothing to stdout for $argv',
    async ({ argv }) => {
      const result = await run(argv);
      expect(result.code).toBe(2);
      expect(result.stdout).toBe('');
      expect(result.stderr).toContain('Usage: motion-kit');
    },
  );

  it('prints a human summary instead of JSON when --json is absent', async () => {
    const output = join(outputRoot, 'human.png');
    const result = await run([
      'frame',
      'entry.ts',
      '--composition',
      'one',
      '--frame',
      '0',
      '--out',
      output,
    ]);
    expect(result.code).toBe(0);
    expect(result.stdout.trim()).not.toBe('');
    expect(() => {
      JSON.parse(result.stdout);
    }).toThrow('Unexpected token');
    expect(statSync(output).isFile()).toBe(true);
  }, 60_000);

  it('exits 2 with cli.entry-not-found for a missing entry file', async () => {
    const result = await run([
      'frame',
      'missing.ts',
      '--frame',
      '0',
      '--out',
      join(outputRoot, 'x.png'),
      '--json',
    ]);
    expect(result.code).toBe(2);
    const envelope = assertValidEnvelope(result);
    expect(envelope).toMatchObject({
      ok: false,
      data: null,
      diagnostics: [{ code: 'cli.entry-not-found', severity: 'error' }],
    });
  });

  it('exits 2 with cli.invalid-arguments and the ids in details when the id is omitted', async () => {
    const result = await run([
      'frame',
      'entry.ts',
      '--frame',
      '0',
      '--out',
      join(outputRoot, 'x.png'),
      '--json',
    ]);
    expect(result.code).toBe(2);
    const envelope = assertValidEnvelope(result);
    expect(envelope.ok).toBe(false);
    expect(envelope.diagnostics[0]?.code).toBe('cli.invalid-arguments');
    expect(envelope.diagnostics[0]?.details).toEqual({ ids: ['one', 'two'] });
  }, 60_000);

  it('exits 2 with cli.composition-not-found for an unknown id', async () => {
    const result = await run([
      'frame',
      'entry.ts',
      '--composition',
      'nope',
      '--frame',
      '0',
      '--out',
      join(outputRoot, 'x.png'),
      '--json',
    ]);
    expect(result.code).toBe(2);
    const envelope = assertValidEnvelope(result);
    expect(envelope).toMatchObject({
      ok: false,
      data: null,
      diagnostics: [{ code: 'cli.composition-not-found', severity: 'error' }],
    });
  }, 60_000);

  it('exits 1 with composition.props-invalid for props that fail the schema', async () => {
    const result = await run([
      'render',
      'entry.ts',
      '--composition',
      'one',
      '--props',
      '{"mode":"bogus"}',
      '--out',
      join(outputRoot, 'bad'),
      '--json',
    ]);
    expect(result.code).toBe(1);
    const envelope = assertValidEnvelope(result);
    expect(envelope).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'composition.props-invalid', severity: 'error' }],
    });
  }, 60_000);

  it('exits 1 with render.browser-launch-failed when Chromium is missing', async () => {
    const empty = mkdtempSync(join(tmpdir(), 'motion-kit-no-browser-'));
    try {
      const result = await run(
        [
          'frame',
          'entry.ts',
          '--composition',
          'one',
          '--frame',
          '0',
          '--out',
          join(outputRoot, 'x.png'),
          '--json',
        ],
        { PLAYWRIGHT_BROWSERS_PATH: empty },
      );
      expect(result.code).toBe(1);
      const envelope = assertValidEnvelope(result);
      expect(envelope).toMatchObject({
        ok: false,
        diagnostics: [{ code: 'render.browser-launch-failed', severity: 'error' }],
      });
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  }, 60_000);

  it('rejects an unknown flag with exit 2 and cli.invalid-arguments', async () => {
    const result = await run([
      'frame',
      'entry.ts',
      '--bogus',
      '--frame',
      '0',
      '--out',
      join(outputRoot, 'x.png'),
      '--json',
    ]);
    expect(result.code).toBe(2);
    const envelope = assertValidEnvelope(result);
    expect(envelope.ok).toBe(false);
    expect(envelope.diagnostics[0]?.code).toBe('cli.invalid-arguments');
  });

  it('rejects a --concurrency that is not a positive integer with exit 2', async () => {
    for (const concurrency of ['0', '-2', '1.5', 'many']) {
      const result = await run([
        'render',
        'entry.ts',
        '--composition',
        'one',
        '--concurrency',
        concurrency,
        '--out',
        join(outputRoot, 'x'),
        '--json',
      ]);
      expect(result.code).toBe(2);
      expect(assertValidEnvelope(result).diagnostics[0]?.code).toBe('cli.invalid-arguments');
    }
  });

  it('renders a composition when an unselected sibling requires a prop', async () => {
    const result = await run([
      'frame',
      'entry-required.tsx',
      '--composition',
      'one',
      '--frame',
      '0',
      '--out',
      join(outputRoot, 'required-other.png'),
      '--json',
    ]);
    expect(result.code).toBe(0);
    const envelope = assertValidEnvelope(result);
    expect(envelope).toMatchObject({ ok: true, data: { format: 'png', frame: 0 } });
    expect(statSync(join(outputRoot, 'required-other.png')).isFile()).toBe(true);
  }, 60_000);

  it('renders a selected required-prop composition when the prop is supplied', async () => {
    const result = await run([
      'render',
      'entry-required.tsx',
      '--composition',
      'two',
      '--props',
      '{"text":"x"}',
      '--out',
      join(outputRoot, 'required-frames'),
      '--json',
    ]);
    expect(result.code).toBe(0);
    const envelope = assertValidEnvelope(result);
    expect(envelope).toMatchObject({ ok: true, data: { frameCount: 3 } });
  }, 60_000);

  it('rejects a selected required-prop composition without the prop', async () => {
    const result = await run([
      'frame',
      'entry-required.tsx',
      '--composition',
      'two',
      '--frame',
      '0',
      '--out',
      join(outputRoot, 'required-missing.png'),
      '--json',
    ]);
    expect(result.code).toBe(1);
    const envelope = assertValidEnvelope(result);
    expect(envelope).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'composition.props-invalid', location: { compositionId: 'two' } }],
    });
  }, 60_000);

  it('renders full sequences with output inside the project root several times', async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const output = join(projectRoot, `frames-in-root-${attempt}`);
      const result = await run([
        'render',
        'entry.ts',
        '--composition',
        'one',
        '--out',
        output,
        '--json',
      ]);
      expect(result.code).toBe(0);
      const envelope = assertValidEnvelope(result);
      expect(envelope).toMatchObject({ ok: true, data: { frameCount: 6 } });
      for (let frame = 0; frame < 6; frame++)
        expect(existsSync(join(output, `frame-${String(frame).padStart(5, '0')}.png`))).toBe(true);
      expect(existsSync(join(output, 'manifest.json'))).toBe(true);
    }
  }, 120_000);
});
