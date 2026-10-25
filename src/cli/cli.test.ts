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

const run = async (args: readonly string[], env?: Record<string, string>): Promise<RunResult> => {
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
    args.includes('--json') && trimmed !== ''
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

const childGone = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return false;
  } catch {
    return true;
  }
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
): SpawnedRun => {
  const child = spawn(process.execPath, [bin, ...args], {
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

describe('motion-kit CLI', () => {
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
        left: (): void => {
          expect(existsSync(video)).toBe(false);
          expect(readdirSync(outputRoot).filter((name) => name.includes('.part'))).toEqual([]);
          // A direct child of the run: the cancellation killed it and waited for it to go.
          expect(childGone(Number(readFileSync(encoderPid, 'utf8')))).toBe(true);
        },
      },
      {
        args: ['render', 'entry-long.tsx', '--composition', 'long'],
        target: frames,
        what: 'the first PNG of the sequence',
        ready: (): boolean =>
          existsSync(frames) && readdirSync(frames).some((name) => name.endsWith('.png')),
        said: `render aborted; any PNG frames already written remain in ${frames}; no manifest.json was written`,
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
        run.child.kill('SIGINT');
        await new Promise((resolve) => setTimeout(resolve, gap));
        // The first signal's cleanup is still in flight, so the covers are all that can run.
        expect(run.child.exitCode).toBe(null);
        expect(run.child.signalCode).toBe(null);
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
        expect(childGone(Number(readFileSync(encoderPid, 'utf8')))).toBe(true);
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
    const run = spawnRun(
      ['render', 'entry.ts', '--composition', 'one', '--out', output, '--json'],
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
      // The run owns the loading service and the encoder directly, and both are in flight here.
      const named = owned.filter(
        (pid) => pid === encoder || commandOf(pid).includes('loading/child.js'),
      );
      expect(named).toHaveLength(2);

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
    writeFileSync(
      join(root, 'entry.tsx'),
      `import { z } from 'zod';
import { defineComposition, defineCompositions } from ${JSON.stringify(
        new URL('../core/composition/registry.ts', import.meta.url).pathname,
      )};
const Scene = () => <div style={{ width: 32, height: 32, background: '#333333' }} />;
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
        const run = spawnRun(
          ['render', 'entry.tsx', '--composition', 'stalled', '--out', route.target, '--json'],
          {},
          root,
        );
        try {
          await waitFor(route.ready, 120_000, route.what);
          const owned = childrenOf(run.child.pid ?? 0);
          expect(owned.length).toBeGreaterThan(0);
          // The artifact is committed and the run is in its teardown, not before the commit.
          expect(run.child.exitCode).toBe(null);
          expect(run.child.signalCode).toBe(null);
          run.child.kill('SIGINT');
          await new Promise((resolve) => setTimeout(resolve, 5));
          // Still alive after the gap, so both signals really landed inside the teardown: without
          // this check the case could silently turn into a signal pair sent after the exit.
          expect(run.child.exitCode).toBe(null);
          expect(run.child.signalCode).toBe(null);
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

  it('prints usage and exits 0 for --help', async () => {
    const result = await run(['--help']);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Usage: motion-kit');
  });

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
