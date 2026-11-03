import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { ease, hundredths, phase, pop, revealed, steps } from './motion.ts';

const seconds = fc.double({ min: -10, max: 60, noNaN: true });
const frame = fc.integer({ min: 0, max: 2000 });
const rate = fc.record({
  numerator: fc.bigInt({ min: 1n, max: 120_000n }),
  denominator: fc.bigInt({ min: 1n, max: 1001n }),
});
const thirty = { numerator: 30n, denominator: 1n };

// The reference: BigInt floor division (BigInt `/` truncates toward zero).
const floorDivide = (numerator: bigint, denominator: bigint): bigint => {
  const quotient = numerator / denominator;
  return numerator % denominator !== 0n && numerator < 0n !== denominator < 0n
    ? quotient - 1n
    : quotient;
};

describe('promo motion', () => {
  it('eases between the stops and holds the end values outside them', () => {
    expect(ease(0, [0, 1], [10, 20])).toBe(10);
    expect(ease(1, [0, 1], [10, 20])).toBe(20);
    expect(ease(-5, [0, 1], [10, 20])).toBe(10);
    expect(ease(5, [0, 1], [10, 20])).toBe(20);
    expect(ease(0.5, [0, 1], [10, 20])).toBeGreaterThan(15);
  });

  it('pops from 0 before its start, overshoots, and settles on 1', () => {
    expect(pop(0.4, 0.5)).toBe(0);
    expect(pop(0.5, 0.5)).toBe(0);
    expect(pop(4, 0.5)).toBeCloseTo(1, 4);
    const peak = Math.max(...Array.from({ length: 60 }, (_, frame) => pop(frame / 30, 0)));
    expect(peak).toBeGreaterThan(1.01);
    expect(peak).toBeLessThan(1.25);
  });

  it('counts whole steps exactly as integer floor division does, at any rate', () => {
    fc.assert(
      fc.property(
        frame,
        rate,
        fc.integer({ min: 0, max: 10_000 }),
        fc.integer({ min: 1, max: 5000 }),
        (at, fps, startMs, everyMs) => {
          const expected = floorDivide(
            BigInt(at) * fps.denominator * 1000n - BigInt(startMs) * fps.numerator,
            BigInt(everyMs) * fps.numerator,
          );
          expect(steps(at, fps, startMs, everyMs)).toBe(Number(expected));
        },
      ),
    );
    // In seconds, `Math.floor((1.4 - 0.8) / 0.3)` is 1: the step at frame 42 would land a frame late.
    expect(steps(42, thirty, 800, 300)).toBe(2);
    expect(steps(41, thirty, 800, 300)).toBe(1);
    expect(steps(0, thirty, 800, 300)).toBe(-3);
  });

  it('reveals the exact number of characters, never more than the text and never fewer than none', () => {
    fc.assert(
      fc.property(
        frame,
        rate,
        fc.integer({ min: 0, max: 10_000 }),
        fc.integer({ min: 1, max: 200 }),
        fc.integer({ min: 0, max: 400 }),
        (at, fps, startMs, perSecond, total) => {
          const exact = floorDivide(
            (BigInt(at) * fps.denominator * 1000n - BigInt(startMs) * fps.numerator) *
              BigInt(perSecond),
            1000n * fps.numerator,
          );
          const clamped = Math.min(total, Math.max(0, Number(exact)));
          expect(revealed(at, fps, startMs, perSecond, total)).toBe(clamped);
        },
      ),
    );
    expect(revealed(15, thirty, 500, 40, 100)).toBe(0);
    expect(revealed(30, thirty, 500, 40, 100)).toBe(20);
  });

  it('counts whole hundredths exactly as integer floor division does, at any rate', () => {
    fc.assert(
      fc.property(frame, rate, (at, fps) => {
        const expected = floorDivide(BigInt(at) * fps.denominator * 100n, fps.numerator);
        expect(hundredths(at, fps)).toBe(Number(expected));
      }),
    );
    // In seconds, `Math.floor((2.3 - 2) * 100)` is 29: frame 69 would read `02.29`.
    expect(hundredths(69, thirty)).toBe(230);
    expect(hundredths(36, thirty)).toBe(120);
  });

  it('wraps time into one period', () => {
    fc.assert(
      fc.property(seconds, fc.double({ min: 0.1, max: 10, noNaN: true }), (time, period) => {
        const value = phase(time, period);
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThan(1);
      }),
    );
    expect(phase(2.5, 2)).toBeCloseTo(0.25, 10);
  });
});
