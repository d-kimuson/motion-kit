import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { dataset } from './datasets.ts';
import { averageCost, compound, drawdowns, linear, unitsBought, yearlyChanges } from './math.ts';

describe('explainer scene arithmetic', () => {
  it('compounds the cost slide’s illustration to the totals its labels print', () => {
    const low = compound(100, 0.05, 0.001, 30);
    const high = compound(100, 0.05, 0.015, 30);
    expect(low).toHaveLength(31);
    expect(low[0]).toBe(100);
    expect(Math.round(low.at(-1) ?? 0)).toBe(419);
    expect(Math.round(high.at(-1) ?? 0)).toBe(275);
  });

  it('never leaves more money after a higher fee', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 1, max: 1000, noNaN: true }),
        fc.double({ min: 0, max: 0.15, noNaN: true }),
        fc.double({ min: 0, max: 0.03, noNaN: true }),
        fc.double({ min: 0, max: 0.03, noNaN: true }),
        fc.integer({ min: 1, max: 50 }),
        (principal, growth, a, b, years) => {
          const [cheap, dear] = a <= b ? [a, b] : [b, a];
          const left = compound(principal, growth, cheap, years).at(-1) ?? 0;
          const right = compound(principal, growth, dear, years).at(-1) ?? 0;
          expect(left).toBeGreaterThanOrEqual(right);
        },
      ),
    );
  });

  it('buys more units in a cheap month, and averages a cost no higher than the average price', () => {
    const units = unitsBought(1, [100, 50]);
    expect(units).toEqual([0.01, 0.02]);
    fc.assert(
      fc.property(
        fc.array(fc.double({ min: 1, max: 1000, noNaN: true }), { minLength: 1, maxLength: 24 }),
        (prices) => {
          const mean = prices.reduce((sum, price) => sum + price, 0) / prices.length;
          expect(averageCost(prices)).toBeLessThanOrEqual(mean * (1 + 1e-9));
        },
      ),
    );
  });

  it('finds the two deep valleys of the thirty-year series and how long each stayed under water', () => {
    const valleys = drawdowns(dataset('index-30y'), 0.2);
    expect(
      valleys.map((valley) => ({
        peak: valley.peakYear,
        trough: valley.troughYear,
        depth: Math.round(valley.depth * 100),
        recovered: valley.recoveryYear,
      })),
    ).toEqual([
      { peak: 1999, trough: 2002, depth: -40, recovered: 2007 },
      { peak: 2007, trough: 2008, depth: -37, recovered: 2012 },
    ]);
  });

  it('reports every year’s change, so the bar strip has one bar per year after the first', () => {
    const points = dataset('index-30y');
    const changes = yearlyChanges(points);
    expect(changes).toHaveLength(points.length - 1);
    expect(changes[0]).toEqual({ year: 1996, change: 0.22 });
  });

  it('maps a domain onto a range linearly, including a reversed range', () => {
    const y = linear([0, 100], [500, 0]);
    expect(y(0)).toBe(500);
    expect(y(50)).toBe(250);
    expect(y(100)).toBe(0);
  });

  it('refuses a dataset id it does not hold', () => {
    expect(() => dataset('no-such-series')).toThrow(/no-such-series/u);
  });
});
