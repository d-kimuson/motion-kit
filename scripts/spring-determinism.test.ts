import { execFileSync } from 'node:child_process';
import { expect, it } from 'vitest';

it('returns byte-identical spring states in separate Node processes and reversed order', () => {
  const run = (reverse: boolean): string =>
    execFileSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `
    import { springState } from './src/motion/index.ts';
    const cases = [1, 2, 4, 2 - 1e-12, 2 + 1e-12, 1e200].flatMap(damping =>
      [0, 0.01, 1, 10, 1000].map(time => ({ time, damping })));
    const values = new Map();
    for (const {time, damping} of ${reverse ? 'cases.toReversed()' : 'cases'}) {
      const result = springState(time, { from: 1, to: 0, start: 0, velocity: 1, stiffness: 1, damping, mass: 1 });
      if (!result.ok) throw new Error(result.error.message);
      const bytes = Buffer.alloc(16);
      bytes.writeDoubleBE(result.value.position, 0);
      bytes.writeDoubleBE(result.value.velocity, 8);
      values.set(time + ':' + damping, bytes.toString('hex'));
    }
    process.stdout.write(JSON.stringify([...values].sort()));
  `,
      ],
      { encoding: 'utf8', timeout: 10000 },
    );
  expect(run(false)).toBe(run(false));
  expect(run(true)).toBe(run(false));
});
