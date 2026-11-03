import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { ease, phase, pop, revealed } from './motion.ts';

const seconds = fc.double({ min: -10, max: 60, noNaN: true });

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

  it('reveals a whole, growing number of characters that never exceeds the text', () => {
    fc.assert(
      fc.property(seconds, seconds, fc.integer({ min: 0, max: 400 }), (a, b, total) => {
        const [earlier, later] = a <= b ? [a, b] : [b, a];
        const first = revealed(earlier, 1, 40, total);
        const second = revealed(later, 1, 40, total);
        expect(Number.isInteger(first)).toBe(true);
        expect(first).toBeGreaterThanOrEqual(0);
        expect(second).toBeLessThanOrEqual(total);
        expect(second).toBeGreaterThanOrEqual(first);
      }),
    );
    expect(revealed(1, 1, 40, 100)).toBe(0);
    expect(revealed(1.5, 1, 40, 100)).toBe(20);
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
