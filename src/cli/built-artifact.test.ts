import { Ajv2020 } from 'ajv/dist/2020.js';
import { execFile } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import committedSchema from '../../docs/contexts/agent/schema/cli-output.v1.schema.json' with { type: 'json' };
import { EnvelopeSchema } from '../agent/cli-output.ts';

const require = createRequire(import.meta.url);
const execFileAsync = promisify(execFile);
// The built artifact under test: `dist/cli.js` is the shipped bin and
// `dist/render.js` the published `./render` subpath. Both run as a consumer
// would, outside vitest's `src` aliases, so a bug visible only in the built
// layout fails this gate. `pretest` runs `pnpm build` first.
const distCli = new URL('../../dist/cli.js', import.meta.url).pathname;
const distRender = new URL('../../dist/render.js', import.meta.url).pathname;
const validateJson = new Ajv2020({ strictTypes: false }).compile(committedSchema);
const renderedResultSchema = z.object({
  ok: z.literal(true),
  frame: z.number(),
  width: z.number(),
  height: z.number(),
  bytes: z.number(),
});

let projectRoot: string;
let outputRoot: string;

beforeAll(() => {
  projectRoot = mkdtempSync(join(tmpdir(), 'motion-kit-built-'));
  outputRoot = mkdtempSync(join(tmpdir(), 'motion-kit-built-output-'));
  mkdirSync(join(projectRoot, 'node_modules'));
  for (const name of ['react', 'react-dom', 'zod'])
    symlinkSync(
      dirname(require.resolve(`${name}/package.json`)),
      join(projectRoot, 'node_modules', name),
    );
  writeFileSync(join(projectRoot, 'package.json'), '{"type":"module"}');
  // A consumer composition: it imports the public package name, which the
  // loading plugin resolves to the bundled dist/index.js in built mode. A
  // relative src import would smuggle a second Composition implementation past
  // this gate, so it is deliberately avoided here.
  writeFileSync(
    join(projectRoot, 'entry.tsx'),
    `import { defineComposition, defineCompositions, useFrame } from '@kimuson/motion-kit';
import { z } from 'zod';
const Scene = ({ text }: { text: string }) => {
  const frame = useFrame();
  return <div style={{ width: 32, height: 32, background: \`rgb(\${frame * 40},0,0)\` }}>{text}</div>;
};
export const compositions = defineCompositions([
  defineComposition({ id: 'one', schema: z.object({ text: z.string().default('hello') }), component: Scene, width: 32, height: 32, fps: { numerator: 30, denominator: 1 }, durationInFrames: 3 }),
]);`,
  );
});

afterAll(() => {
  rmSync(projectRoot, { recursive: true, force: true });
  rmSync(outputRoot, { recursive: true, force: true });
});

type RunResult = { readonly code: number; readonly stdout: string; readonly stderr: string };

const run = async (args: readonly string[]): Promise<RunResult> => {
  let stdout = '';
  let stderr = '';
  let code = 0;
  try {
    const result = await execFileAsync(process.execPath, [distCli, ...args], {
      cwd: projectRoot,
      timeout: 120_000,
      maxBuffer: 64 * 1024 * 1024,
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
  return { code, stdout, stderr };
};

const rendererDriver = `import { writeFileSync } from 'node:fs';
const [distRender, projectRoot, entry, out] = process.argv.slice(2);
const { createRenderer } = await import(distRender);
const created = await createRenderer({ projectRoot, entry, compositionId: 'one' });
if (!created.ok) {
  process.stderr.write(JSON.stringify(created));
  process.exit(1);
}
const renderer = created.value;
try {
  const frame = await renderer.renderFrame({ frame: 1 });
  if (!frame.ok) {
    process.stderr.write(JSON.stringify(frame));
    process.exit(1);
  }
  writeFileSync(out, frame.value.png);
  process.stdout.write(JSON.stringify({
    ok: true,
    frame: frame.value.frame,
    width: frame.value.width,
    height: frame.value.height,
    bytes: frame.value.png.length,
  }));
} finally {
  await renderer.dispose();
}
`;

describe('built package layout', () => {
  it('runs the built CLI to capture one frame to a PNG with the v1 envelope', async () => {
    expect(existsSync(distCli)).toBe(true);
    const output = join(outputRoot, 'frame.png');
    const result = await run([
      'frame',
      'entry.tsx',
      '--composition',
      'one',
      '--frame',
      '2',
      '--out',
      output,
      '--json',
    ]);
    expect(result.code).toBe(0);
    const envelope = EnvelopeSchema.parse(JSON.parse(result.stdout.trim()));
    expect(validateJson(envelope)).toBe(true);
    expect(envelope).toMatchObject({
      schemaVersion: 1,
      command: 'frame',
      ok: true,
      diagnostics: [],
      data: { output, format: 'png', frame: 2, width: 32, height: 32 },
    });
    expect(statSync(output).isFile()).toBe(true);
    expect(readFileSync(output).length).toBeGreaterThan(0);
  }, 120_000);

  it('renders one frame through the built renderer imported from dist/render.js', async () => {
    expect(existsSync(distRender)).toBe(true);
    const driver = join(outputRoot, 'render-built.mjs');
    const output = join(outputRoot, 'render-frame.png');
    writeFileSync(driver, rendererDriver);
    const result = await execFileAsync(
      process.execPath,
      [driver, distRender, projectRoot, 'entry.tsx', output],
      { cwd: projectRoot, timeout: 120_000, maxBuffer: 64 * 1024 * 1024 },
    );
    expect(result.stdout.trim()).not.toBe('');
    const rendered = renderedResultSchema.parse(JSON.parse(result.stdout.trim()));
    expect(rendered).toMatchObject({ ok: true, frame: 1, width: 32, height: 32 });
    expect(rendered.bytes).toBeGreaterThan(0);
    expect(statSync(output).isFile()).toBe(true);
    expect(readFileSync(output).length).toBe(rendered.bytes);
  }, 120_000);
});
