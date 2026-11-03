import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

const execFileAsync = promisify(execFile);
// The built artifact under test: `dist/motion.js` is the published `./motion`
// subpath. It runs as a consumer would, outside vitest's `src` aliases and
// through `package.json#exports`, so a bug visible only in the built layout
// fails this gate. `pretest` runs `pnpm build` first.
const distMotion = new URL('../../dist/motion.js', import.meta.url).pathname;
const distMotionTypes = new URL('../../dist/motion.d.ts', import.meta.url).pathname;
const packageRoot = new URL('../../', import.meta.url).pathname;
// The repository's own compiler, run on a consumer file that imports the
// published types: `pnpm typecheck` resolves the subpath to `src` through
// `paths`, so only this pins the declared names in `dist/motion.d.ts`.
const tsc = new URL('../../node_modules/typescript/bin/tsc', import.meta.url).pathname;

// The consumer project: `node_modules/@kimuson/motion-kit` points at this
// checkout, so the bare specifier resolves through the real export map.
let consumerRoot: string;

// Every runtime export of the subpath, called the way a consumer calls it.
const driver = `const modulePath = import.meta.resolve('@kimuson/motion-kit/motion');
const motion = await import('@kimuson/motion-kit/motion');
const value = (result) => {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
};
const sample = { from: 1, to: 0, start: 0, velocity: 0, stiffness: 1, damping: 2, mass: 1 };
const state = value(motion.springState(1, sample));
const retargeted = value(motion.retarget(sample, 1, { to: 2 }));
process.stdout.write(JSON.stringify({
  modulePath,
  exported: Object.keys(motion).sort(),
  interpolate: value(motion.interpolate(0.3, [0, 0.6], [0, 1], { easing: motion.easing.easeOutCubic })),
  keyframes: value(motion.keyframes(1, [{ time: 0, value: 0 }, { time: 2, value: 10 }])),
  easing: motion.easing.easeInOutCubic(0.5),
  cubicBezier: value(motion.easing.cubicBezier(0.25, 0.1, 0.25, 1))(0.5),
  cubicBezierInvalid: motion.easing.cubicBezier(2, 0.1, 0.25, 1),
  spring: value(motion.spring(1, sample)),
  state,
  settle: value(motion.springSettleTime(sample, 0.01)),
  retarget: { from: retargeted.from, to: retargeted.to, velocity: retargeted.velocity },
  invalid: motion.interpolate(0, [0], [0]),
}));
`;

const DriverOutputSchema = z.object({
  modulePath: z.string(),
  exported: z.array(z.string()),
  interpolate: z.number(),
  keyframes: z.number(),
  easing: z.number(),
  cubicBezier: z.number(),
  cubicBezierInvalid: z.object({ ok: z.literal(false), error: z.object({ code: z.string() }) }),
  spring: z.number(),
  state: z.object({ position: z.number(), velocity: z.number() }),
  settle: z.number(),
  retarget: z.object({ from: z.number(), to: z.number(), velocity: z.number() }),
  invalid: z.object({ ok: z.literal(false), error: z.object({ code: z.string() }) }),
});

type DriverOutput = z.infer<typeof DriverOutputSchema>;

// Type-only imports of every name the subpath publishes; a missing or renamed
// export in the published declarations fails the compiler.
const consumerTypes = `import type {
  Easing,
  InterpolateOptions,
  Keyframe,
  Result,
  RetargetOptions,
  Spring,
  SpringState,
} from '@kimuson/motion-kit/motion';

const ease: Easing = (progress) => progress;
const options: InterpolateOptions = { extrapolate: 'clamp', easing: ease };
const frame: Keyframe = { time: 0, value: 0 };
const spring: Spring = { from: 0, to: 1, start: 0, velocity: 0, stiffness: 1, damping: 1, mass: 1 };
const state: SpringState = { position: 0, velocity: 0 };
const retarget: RetargetOptions = { to: 1 };

export type Surface = readonly [
  Result<number>,
  typeof options,
  typeof frame,
  typeof spring,
  typeof state,
  typeof retarget,
];
`;

// The negative control: the same file plus a name the subpath does not export,
// so a check that silently stopped reading the published declarations fails.
const consumerMissingType = consumerTypes.replace(
  'import type {\n  Easing,',
  'import type {\n  MissingType,\n  Easing,',
);

type RunResult = { readonly code: number; readonly output: string };

beforeAll(() => {
  consumerRoot = mkdtempSync(join(tmpdir(), 'motion-kit-motion-consumer-'));
  mkdirSync(join(consumerRoot, 'node_modules', '@kimuson'), { recursive: true });
  symlinkSync(packageRoot, join(consumerRoot, 'node_modules', '@kimuson', 'motion-kit'));
  writeFileSync(join(consumerRoot, 'package.json'), '{"type":"module"}');
  writeFileSync(join(consumerRoot, 'driver.mjs'), driver);
  writeFileSync(join(consumerRoot, 'consumer-types.ts'), consumerTypes);
  writeFileSync(join(consumerRoot, 'consumer-missing-type.ts'), consumerMissingType);
});

afterAll(() => {
  rmSync(consumerRoot, { recursive: true, force: true });
});

const runDriver = async (): Promise<DriverOutput> => {
  const result = await execFileAsync(process.execPath, [join(consumerRoot, 'driver.mjs')], {
    cwd: consumerRoot,
    timeout: 60_000,
    maxBuffer: 16 * 1024 * 1024,
  });
  const parsed: unknown = JSON.parse(result.stdout);
  return DriverOutputSchema.parse(parsed);
};

const runTypeCheck = async (file: string): Promise<RunResult> => {
  try {
    const result = await execFileAsync(
      process.execPath,
      [
        tsc,
        '--noEmit',
        '--strict',
        '--target',
        'es2022',
        '--module',
        'nodenext',
        '--moduleResolution',
        'nodenext',
        join(consumerRoot, file),
      ],
      { cwd: consumerRoot, timeout: 60_000, maxBuffer: 16 * 1024 * 1024 },
    );
    return { code: 0, output: result.stdout };
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error) {
      const { code, stdout, stderr } = error as {
        code: unknown;
        stdout?: unknown;
        stderr?: unknown;
      };
      return {
        code: typeof code === 'number' ? code : 1,
        output: `${typeof stdout === 'string' ? stdout : ''}${typeof stderr === 'string' ? stderr : ''}`,
      };
    }
    throw error;
  }
};

describe('built /motion subpath', () => {
  it('emits the JavaScript and the type declarations the export map points at', () => {
    expect(existsSync(distMotion)).toBe(true);
    expect(existsSync(distMotionTypes)).toBe(true);
  });

  it('resolves @kimuson/motion-kit/motion to dist and calls every exported function', async () => {
    const output = await runDriver();
    // The export map, not a relative path into the checkout, resolved the subpath.
    expect(output.modulePath.endsWith('/dist/motion.js')).toBe(true);
    expect(output.exported).toStrictEqual([
      'easing',
      'interpolate',
      'keyframes',
      'retarget',
      'spring',
      'springSettleTime',
      'springState',
    ]);
    // The same values the source tests fix, so the bundle did not change them.
    expect(output.interpolate).toBe(0.875);
    expect(output.keyframes).toBe(5);
    expect(output.easing).toBe(0.5);
    // The only easing that returns a `Result<Easing>`: unwrap it, then call it.
    expect(output.cubicBezier).toBeCloseTo(0.8024033875848571, 12);
    // The same easing fails as a value when its control points are out of range.
    expect(output.cubicBezierInvalid.ok).toBe(false);
    expect(output.cubicBezierInvalid.error.code).toBe('motion.invalid-input');
    expect(output.spring).toBeCloseTo(0.7357588823428847, 12);
    expect(output.state.velocity).toBeCloseTo(-0.36787944117144233, 12);
    expect(output.settle).toBeGreaterThan(0);
    // A retarget inherits the old Spring's position and velocity at the switch time.
    expect(output.retarget).toStrictEqual({
      from: output.spring,
      to: 2,
      velocity: output.state.velocity,
    });
    // Failures stay values, not throws, through the built module too.
    expect(output.invalid.ok).toBe(false);
    expect(output.invalid.error.code).toBe('motion.invalid-input');
  }, 60_000);

  it('type-checks a consumer against the published declarations', async () => {
    const checked = await runTypeCheck('consumer-types.ts');
    expect(checked.output).toBe('');
    expect(checked.code).toBe(0);
    // Negative control: the same file plus a name the subpath does not publish.
    const missing = await runTypeCheck('consumer-missing-type.ts');
    expect(missing.code).not.toBe(0);
    expect(missing.output).toContain('TS2305');
  }, 60_000);
});
