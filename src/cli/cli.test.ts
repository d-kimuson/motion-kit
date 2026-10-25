import { Ajv2020 } from 'ajv/dist/2020.js';
import { execFile, execFileSync, spawn } from 'node:child_process';
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
});

afterAll(() => {
  rmSync(projectRoot, { recursive: true, force: true });
  rmSync(outputRoot, { recursive: true, force: true });
});

type RunResult = { readonly code: number; readonly envelope?: Envelope; readonly stdout: string };

const run = async (args: readonly string[], env?: Record<string, string>): Promise<RunResult> => {
  let stdout = '';
  let code = 0;
  try {
    const result = await execFileAsync(process.execPath, [bin, ...args], {
      cwd: projectRoot,
      timeout: 120_000,
      maxBuffer: 64 * 1024 * 1024,
      env: { ...process.env, ...env },
    });
    stdout = result.stdout;
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
  return { code, envelope, stdout };
};

const assertValidEnvelope = (result: RunResult): Envelope => {
  const envelope = result.envelope;
  expect(envelope).toBeDefined();
  if (envelope === undefined) throw new Error('Envelope missing');
  expect(validateJson(envelope)).toBe(true);
  return envelope;
};

/** Polls a filesystem fact a child process produces; a render has no other progress signal. */
const waitFor = async (ready: () => boolean, timeoutMs: number): Promise<void> => {
  const started = currentDate().getTime();
  while (!ready()) {
    if (currentDate().getTime() - started > timeoutMs)
      throw new Error('the render never reached the encoder');
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
      for (const target of [join(outputRoot, 'cancelled.mp4'), join(outputRoot, 'cancelled')]) {
        const code = await runCli(
          ['render', 'entry.ts', '--composition', 'one', '--out', target, '--json'],
          { signal: controller.signal },
        );
        // 128 + SIGINT: the caller stopped the run, so it is neither a domain failure (1),
        // an invocation error (2) nor an internal bug (3).
        expect(code).toBe(130);
        expect(existsSync(target)).toBe(false);
      }
      // A cancellation has no Diagnostic to put in an envelope, so nothing claims one.
      expect(stdout).not.toHaveBeenCalled();
      const said = stderr.mock.calls.map(([chunk]) => String(chunk)).join('');
      expect(said).toContain('render aborted');
      expect(said).not.toContain('internal.unexpected');
    } finally {
      stdout.mockRestore();
      stderr.mockRestore();
    }
  });

  it('stops a SIGINT render with no target, no .part sibling and no encoder child', async () => {
    // A stand-in binary that never finishes the encode, so the run is stopped mid-render.
    const fake = mkdtempSync(join(tmpdir(), 'motion-kit-signal-ffmpeg-'));
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
    const output = join(outputRoot, 'interrupted.mp4');
    const child = spawn(
      process.execPath,
      [bin, 'render', 'entry.ts', '--composition', 'one', '--out', output, '--json'],
      {
        cwd: projectRoot,
        env: { ...process.env, PATH: `${fake}:${process.env['PATH'] ?? ''}` },
      },
    );
    let stdout = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    try {
      await waitFor(
        () =>
          existsSync(encoderPid) && readdirSync(outputRoot).some((name) => name.includes('.part')),
        60_000,
      );
      child.kill('SIGINT');
      const code = await new Promise<number | null>((resolve) => {
        child.once('exit', (exitCode) => resolve(exitCode));
      });
      expect(code).toBe(130);
      // No envelope was fabricated for the cancellation, and nothing was left behind.
      expect(stdout).toBe('');
      expect(existsSync(output)).toBe(false);
      expect(readdirSync(outputRoot).filter((name) => name.includes('.part'))).toEqual([]);
      expect(childGone(Number(readFileSync(encoderPid, 'utf8')))).toBe(true);
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      rmSync(fake, { recursive: true, force: true });
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
