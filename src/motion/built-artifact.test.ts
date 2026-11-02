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
  spring: z.number(),
  state: z.object({ position: z.number(), velocity: z.number() }),
  settle: z.number(),
  retarget: z.object({ from: z.number(), to: z.number(), velocity: z.number() }),
  invalid: z.object({ ok: z.literal(false), error: z.object({ code: z.string() }) }),
});

type DriverOutput = z.infer<typeof DriverOutputSchema>;

beforeAll(() => {
  consumerRoot = mkdtempSync(join(tmpdir(), 'motion-kit-motion-consumer-'));
  mkdirSync(join(consumerRoot, 'node_modules', '@kimuson'), { recursive: true });
  symlinkSync(packageRoot, join(consumerRoot, 'node_modules', '@kimuson', 'motion-kit'));
  writeFileSync(join(consumerRoot, 'package.json'), '{"type":"module"}');
  writeFileSync(join(consumerRoot, 'driver.mjs'), driver);
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

describe('built /motion subpath', () => {
  it('emits the JavaScript and the type declarations the export map points at', () => {
    expect(existsSync(distMotion)).toBe(true);
    expect(existsSync(distMotionTypes)).toBe(true);
  });

  it('resolves @kimuson/motion-kit/motion to dist and evaluates every Pure Motion function', async () => {
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
});
