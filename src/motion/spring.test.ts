import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import type { Result } from '../lib/result.ts';

import { spring, springState, springSettleTime, retarget, type Spring } from './index.ts';

const value = <T>(r: Result<T>): T => {
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
};
const base: Spring = { from: 1, to: 0, start: 0, velocity: 0, stiffness: 1, damping: 2, mass: 1 };
const position = (t: number, s: Spring): number => value(spring(t, s));
const deviation = (t: number, s: Spring): number => Math.abs(position(s.start + t, s) - s.to);
const springs = fc.record({
  from: fc.integer({ min: -100, max: 100 }),
  to: fc.integer({ min: -100, max: 100 }),
  velocity: fc.integer({ min: -100, max: 100 }),
  start: fc.integer({ min: -100, max: 100 }),
  stiffness: fc.integer({ min: 1, max: 100 }),
  damping: fc.integer({ min: 1, max: 100 }),
  mass: fc.integer({ min: 1, max: 10 }),
});
const positive = fc.double({ min: 0.0001, max: 10, noNaN: true });
const bytes = (n: number): string => {
  const buffer = new ArrayBuffer(8);
  new DataView(buffer).setFloat64(0, n);
  return Array.from(new Uint8Array(buffer)).join(',');
};

describe('closed-form spring', () => {
  it('matches independently derived under-damped quarter-cycle constants', () => {
    // x''+2x'+2x=0, x(0)=1, x'(0)=-1: x=e^-t cos(t).
    const s = { ...base, stiffness: 2, velocity: -1 };
    expect(position(Math.PI / 2, s)).toBeCloseTo(0, 14);
    expect(value(springState(Math.PI / 2, s)).velocity).toBeCloseTo(-0.20787957635076193, 14);
    expect(position(Math.PI, s)).toBeCloseTo(-0.04321391826377226, 14);
  });
  it('matches independently derived critical constants', () => {
    // x''+2x'+x=0: x=(1+t)e^-t, v=-t e^-t.
    expect(position(1, base)).toBeCloseTo(0.7357588823428847, 14);
    expect(position(2, base)).toBeCloseTo(0.4060058497098381, 14);
    expect(value(springState(1, base)).velocity).toBeCloseTo(-0.36787944117144233, 14);
  });
  it('matches independently derived over-damped constants', () => {
    // Roots -1,-3, x(0)=1,v(0)=0: x=(3e^-t-e^-3t)/2.
    const s = { ...base, stiffness: 3, damping: 4 };
    expect(position(1, s)).toBeCloseTo(0.5269256275732315, 14);
    expect(value(springState(1, s)).velocity).toBeCloseTo(-0.4771385592053676, 14);
  });
  it('preserves near-critical signed corrections rather than snapping damping', () => {
    // k=1 +/- 1e-8, c=2: independent power series about k=1 at t=1.
    expect(position(1, { ...base, stiffness: 1 + 1e-8 })).toBeCloseTo(0.735758879890355, 14);
    expect(position(1, { ...base, stiffness: 1 - 1e-8 })).toBeCloseTo(0.7357588847954143, 14);
    for (const stiffness of [1 - 1e-14, 1, 1 + 1e-14]) {
      expect(position(1, { ...base, stiffness })).toBeCloseTo(0.7357588823428847, 13);
    }
  });
  it('keeps stiff over-damped evaluation finite without cosh overflow or slow-root cancellation', () => {
    expect(position(1, { ...base, damping: 1e200, stiffness: 1e200 })).toBeCloseTo(
      0.36787944117144233,
      14,
    );
    expect(position(1000, { ...base, damping: 2000, stiffness: 1 })).toBeCloseTo(
      0.6065307355294017,
      6,
    );
  });
  it('preserves stiff analytic velocity without cancellation or coefficient underflow', () => {
    // With c=1e200, the fast mode is negligible here. For k=1 the
    // slow root is -1e-200; for k=1e200 it is -1 (binary64 precision).
    // x(t)=1e108*exp(-slow*t), v(t)=-slow*x(t).
    for (const stiffness of [1, 1e200]) {
      const s = { ...base, from: 0, velocity: 1e308, stiffness, damping: 1e200 };
      const rate = stiffness / 1e200;
      const state = value(springState(1 / rate, s));
      expect(state.position / 1e108).toBeCloseTo(0.36787944117144233, 14);
      expect(state.velocity / (-rate * 1e108)).toBeCloseTo(0.36787944117144233, 14);
    }
  });
  it('preserves scaled states after the bare exponential underflows in every regime', () => {
    // Independently evaluated with Ruby BigMath at 80 decimal digits.
    // u=a*t=750, a=1e-200, v0=1e200, y0=0:
    // critical: x=v0*t*e^-u, v=v0*(1-u)*e^-u;
    // under: x=v0/a*e^-u*sin(u), v=v0*e^-u*(cos(u)-sin(u));
    // over (roots -a,-3a): x=v0/(2a)*(e^-u-e^-3u),
    // v=v0/2*(-e^-u+3e^-3u).
    const cases = [
      [1e-200, 2, 1.4262637226062548e77, -1.4243620376427798e-123],
      [2e-200, 2, 1.4168940262623077e74, -2.6852855346890724e-126],
      [3e-200, 4, 9.508424817375032e73, -9.508424817375032e-127],
    ] as const;
    for (const [stiffness, damping, x, v] of cases) {
      const s = { ...base, from: 0, velocity: 1e200, stiffness, damping, mass: 1e200 };
      const actual = value(springState(7.5e202, s));
      expect(actual.position / x).toBeCloseTo(1, 11);
      expect(actual.velocity / v).toBeCloseTo(1, 11);
      expect(position(7.5e202, s)).toBe(actual.position);
    }
    // The fast over-damped velocity mode can remain representable even when
    // its exponential underflows; the slow exponent alone is not sufficient.
    // Roots round to -1e-200 and -1e200. x=1e108, while
    // v=1e308*e^-750 - 1e-92 (the slow contribution is negligible).
    const fastMode = value(
      springState(7.5e-198, {
        ...base,
        from: 0,
        velocity: 1e308,
        damping: 1e200,
      }),
    );
    expect(fastMode.position / 1e108).toBeCloseTo(1, 11);
    expect(fastMode.velocity / 1.9016849634750064e-18).toBeCloseTo(1, 11);
    // A representable decay can also underflow after division by q, before
    // multiplication by v0. Roots -1,-1e308 give x=e^-100, v=-e^-100.
    const smallBasis = value(
      springState(100, {
        ...base,
        from: 0,
        velocity: 1e308,
        stiffness: 1e308,
        damping: 1e308,
      }),
    );
    expect(smallBasis.position / 3.720075976020836e-44).toBeCloseTo(1, 11);
    expect(smallBasis.velocity / -3.720075976020836e-44).toBeCloseTo(1, 11);
    // Displacement, not only initial velocity, must survive the same scaling.
    const state = value(springState(750, { ...base, from: 1e308 }));
    expect(state.position / 1.42816540756973e-15).toBeCloseTo(1, 11);
    expect(state.velocity / -1.4262637226062548e-15).toBeCloseTo(1, 11);
    expect(value(springState(1e308, { ...base, stiffness: 8, damping: 4 }))).toEqual({
      position: 0,
      velocity: 0,
    });
  });
  it('matches independently split-decay references for random representable scaled states', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('under', 'critical', 'over'),
        fc.integer({ min: 750, max: 800 }),
        fc.integer({ min: 0, max: 200 }),
        fc.integer({ min: 100, max: 200 }),
        fc.integer({ min: 1, max: 4 }),
        fc.constantFrom(-1, 1),
        (regime, u, rateExponent, velocityExponent, multiplier, sign) => {
          const rate = 10 ** -rateExponent;
          const v0 = sign * 10 ** velocityExponent;
          const k = regime === 'under' ? 2 : regime === 'over' ? 3 : 1;
          const c = regime === 'over' ? 4 : 2;
          const s = {
            ...base,
            from: 0,
            velocity: v0,
            stiffness: k * rate * multiplier,
            damping: c * multiplier,
            mass: 10 ** rateExponent * multiplier,
          };
          // Similarity solutions above, but split exp(-u) into two safe
          // halves instead of the implementation's logarithmic products.
          // The e^-3u mode in the over-damped case is < 1e-650 relative.
          const halfDecay = Math.exp(-u / 2);
          const amplitude = v0 * halfDecay;
          const xFactor = regime === 'critical' ? u : regime === 'under' ? Math.sin(u) : 0.5;
          const vFactor =
            regime === 'critical' ? 1 - u : regime === 'under' ? Math.cos(u) - Math.sin(u) : -0.5;
          const x = amplitude * (halfDecay / rate) * xFactor;
          const v = amplitude * halfDecay * vFactor;
          const actual = value(springState(u / rate, s));
          expect(Number.isFinite(x) && x !== 0 && Number.isFinite(v) && v !== 0).toBe(true);
          expect(actual.position).not.toBe(0);
          expect(actual.velocity).not.toBe(0);
          expect(Math.abs(actual.position / x - 1)).toBeLessThan(1e-9);
          expect(Math.abs(actual.velocity / v - 1)).toBeLessThan(1e-9);
        },
      ),
      { numRuns: 600 },
    );
  });
  it('holds before start and preserves the explicit initial velocity at start', () => {
    const s = { ...base, start: 2, velocity: 3 };
    expect(value(springState(-4, s))).toEqual({ position: 1, velocity: 0 });
    expect(value(springState(2, s))).toEqual({ position: 1, velocity: 3 });
    expect(position(3, s)).toBe(position(1, { ...s, start: 0 }));
  });
  it('diagnoses invalid fields, times, tolerances, retargets and non-representable results', () => {
    for (const field of Object.keys(base)) {
      expect(spring(1, { ...base, [field]: NaN }).ok).toBe(false);
    }
    for (const field of ['mass', 'stiffness', 'damping']) {
      expect(spring(1, { ...base, [field]: 0 }).ok).toBe(false);
      expect(spring(1, { ...base, [field]: -1 }).ok).toBe(false);
    }
    expect(spring(Infinity, base).ok).toBe(false);
    for (const tolerance of [0, -1, NaN, Infinity])
      expect(springSettleTime(base, tolerance).ok).toBe(false);
    expect(retarget(base, 1, { to: Infinity }).ok).toBe(false);
    const overflow = springState(0.1, { ...base, from: 1e308, to: -1e308, stiffness: 100 });
    expect(overflow.ok).toBe(false);
    if (overflow.ok) throw new Error('Expected overflow diagnostic');
    expect(overflow.error.code).toBe('motion.non-finite-result');
  });
  it('preserves large equilibria and diagnoses only the requested output', () => {
    const equilibrium = { ...base, from: 1e308, to: 1e308 };
    expect(value(springState(1, equilibrium))).toEqual({ position: 1e308, velocity: 0 });
    const fast = { ...base, from: 1e308, stiffness: 100 };
    expect(spring(0.1, fast).ok).toBe(true);
    expect(springState(0.1, fast).ok).toBe(false);
  });
  it('has exact initial positions for arbitrary springs', () => {
    fc.assert(
      fc.property(springs, (s) => {
        expect(position(s.start, s)).toBe(s.from);
      }),
    );
  });
  it('retargets continuously in both position and velocity without mutating the old spring', () => {
    fc.assert(
      fc.property(springs, positive, fc.integer(), (s, time, to) => {
        const snapshot = { ...s };
        const old = value(springState(time, s));
        const next = value(retarget(s, time, { to, stiffness: 20, mass: 2 }));
        expect(value(springState(time, next))).toEqual(old);
        expect(next).toMatchObject({ to, start: time, stiffness: 20, mass: 2, damping: s.damping });
        expect(s).toEqual(snapshot);
      }),
    );
  });
  it('inherits all physical parameters and follows the analytic retargeted trajectory', () => {
    // k=6,c=8,m=2 gives roots -1,-3, not the unit defaults.
    const s = Object.freeze({ ...base, stiffness: 6, damping: 8, mass: 2 });
    const next = value(retarget(s, 1, { to: 2 }));
    expect(next).toMatchObject({ stiffness: 6, damping: 8, mass: 2 });
    const y = (3 * Math.exp(-1) - Math.exp(-3)) / 2 - 2;
    const v = (3 * (Math.exp(-3) - Math.exp(-1))) / 2;
    const a = (v + 3 * y) / 2;
    const b = -(v + y) / 2;
    for (const elapsed of [0.5, 2, 10]) {
      const actual = value(springState(1 + elapsed, next));
      expect(actual.position).toBeCloseTo(
        2 + a * Math.exp(-elapsed) + b * Math.exp(-3 * elapsed),
        13,
      );
      expect(actual.velocity).toBeCloseTo(
        -a * Math.exp(-elapsed) - 3 * b * Math.exp(-3 * elapsed),
        13,
      );
    }
    for (const override of [{ stiffness: 12 }, { damping: 4 }, { mass: 3 }]) {
      const changed = value(retarget(s, 1, { to: 2, ...override }));
      expect(changed).toMatchObject({ stiffness: 6, damping: 8, mass: 2, ...override });
      const expected = { ...next, ...override };
      expect(value(springState(3, changed))).toEqual(value(springState(3, expected)));
    }
  });
  it('preserves the future original trajectory when retargeting an active spring to the same target', () => {
    fc.assert(
      fc.property(springs, positive, positive, (s, switchDelay, elapsed) => {
        const at = s.start + switchDelay;
        const next = value(retarget(Object.freeze(s), at, { to: s.to }));
        expect(next).toMatchObject({ stiffness: s.stiffness, damping: s.damping, mass: s.mass });
        for (const delay of [elapsed, 2, 10, 30]) {
          const original = value(springState(at + delay, s));
          const changed = value(springState(at + delay, next));
          expect(changed.position).toBeCloseTo(original.position, 9);
          expect(changed.velocity).toBeCloseTo(original.velocity, 9);
        }
      }),
      { numRuns: 300 },
    );
  });
  it('is byte-identical under shuffled evaluation and interleaved different inputs', () => {
    fc.assert(
      fc.property(
        springs,
        fc.array(fc.integer({ min: 0, max: 1000 }), { minLength: 2, maxLength: 30 }),
        fc.integer(),
        (s, times, seed) => {
          const expected = times.map((t) => bytes(position(t / 100, s)));
          const order = fc.sample(
            fc.shuffledSubarray(
              times.map((_, i) => i),
              { minLength: times.length, maxLength: times.length },
            ),
            { seed, numRuns: 1 },
          )[0];
          if (!order) throw new Error('Missing permutation');
          for (const i of order) {
            const t = times[i];
            if (t === undefined) throw new Error('Missing time');
            expect(position(t / 100, { ...s, from: s.from + 1, to: s.to + 1 })).toBeCloseTo(
              position(t / 100, s) + 1,
              10,
            );
            expect(bytes(position(t / 100, s))).toBe(expected[i]);
            expect(bytes(position(t / 100, s))).toBe(expected[i]);
          }
        },
      ),
    );
  });
});

describe('sustained spring settle time', () => {
  it('uses the last entry, not the first crossing or an envelope approximation', () => {
    const s = { ...base, stiffness: 2, velocity: -1 };
    const t = value(springSettleTime(s, 0.01));
    expect(t).toBeGreaterThan(Math.PI);
    expect(deviation(t, s)).toBeLessThanOrEqual(0.01);
    expect(deviation(t - 1e-7, s)).toBeGreaterThan(0.01);
    expect(deviation(Math.PI / 2, s)).toBeLessThan(0.01);
    for (let i = 0; i <= 10000; i += 1) expect(deviation(t + i / 100, s)).toBeLessThanOrEqual(0.01);
  });
  it('has a tight last-entry boundary for monotone critical and over-damped motion', () => {
    for (const s of [base, { ...base, stiffness: 3, damping: 4 }]) {
      const t = value(springSettleTime(s, 0.1));
      expect(deviation(t, s)).toBeLessThanOrEqual(0.1);
      for (const fraction of [0, 0.25, 0.5, 0.999999])
        expect(deviation(t * fraction, s)).toBeGreaterThan(0.1);
    }
  });
  it('handles motion initially inside the band but leaving it later', () => {
    for (const damping of [1, 2, 4]) {
      const s = { ...base, from: 0, velocity: 10, damping };
      const t = value(springSettleTime(s, 0.1));
      expect(t).toBeGreaterThan(1);
      expect(deviation(t, s)).toBeLessThanOrEqual(0.1);
      expect(deviation(t - 1e-7, s)).toBeGreaterThan(0.1);
    }
    expect(value(springSettleTime({ ...base, from: 0 }, 0.1))).toBe(0);
    expect(value(springSettleTime(base, 2))).toBe(0);
  });
  it('sustains tolerance densely after settling, with a tight last-entry boundary', () => {
    fc.assert(
      fc.property(springs, positive, (s, tolerance) => {
        const t = value(springSettleTime(s, tolerance));
        expect(deviation(t, s)).toBeLessThanOrEqual(tolerance);
        const tightBoundary = t <= 1e-6 || deviation(t - Math.max(1e-7, t * 1e-7), s) > tolerance;
        expect(tightBoundary).toBe(true);
        for (let i = 0; i <= 500; i += 1) {
          expect(deviation(t + i * Math.max(0.01, t / 50), s)).toBeLessThanOrEqual(tolerance);
        }
      }),
      { numRuns: 300 },
    );
  });
  it('is monotone in absolute tolerance', () => {
    fc.assert(
      fc.property(springs, positive, positive, (s, a, b) => {
        const smaller = value(springSettleTime(s, Math.min(a, b)));
        const larger = value(springSettleTime(s, Math.max(a, b)));
        expect(smaller).toBeGreaterThanOrEqual(larger);
      }),
      { numRuns: 300 },
    );
  });
  it('finds a stiff delayed excursion without overflowing the extremum ratio', () => {
    const s = { ...base, from: 0, velocity: 1e308, damping: 1e200 };
    const t = value(springSettleTime(s, 0.1));
    expect(t).toBeGreaterThan(1e200);
    expect(deviation(t, s)).toBeLessThanOrEqual(0.1);
    expect(deviation(t * 0.99999, s)).toBeGreaterThan(0.1);
    expect(deviation(t * 2, s)).toBeLessThanOrEqual(0.1);
    expect(springSettleTime({ ...base, damping: 1e-300 }, 0.1).ok).toBe(false);
  });
  it('handles near-critical extrema and very low damping without scanning cycles', () => {
    for (const damping of [2 - 1e-12, 2, 2 + 1e-12, 1e-8]) {
      const s = { ...base, from: 0, velocity: 1, damping };
      const t = value(springSettleTime(s, 0.001));
      expect(deviation(t, s)).toBeLessThanOrEqual(0.001);
      expect(deviation(t - Math.max(1e-6, t * Number.EPSILON * 4), s)).toBeGreaterThan(0.001);
    }
  });
});
