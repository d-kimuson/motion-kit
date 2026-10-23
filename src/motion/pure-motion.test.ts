import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import type { Result } from '../lib/result.ts';

import { DiagnosticSchema } from '../lib/diagnostic.ts';
import { easing, interpolate, keyframes, type Easing, type InterpolateOptions } from './index.ts';

const value = <T>(result: Result<T>): T => {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
};

const invalid = <T>(result: Result<T>, code = 'motion.invalid-input'): void => {
  if (result.ok) throw new Error('Expected a Diagnostic, received success.');
  expect(result.error.code).toBe(code);
  expect(DiagnosticSchema.safeParse(result.error).success).toBe(true);
};

const finite = fc.double({ noNaN: true, noDefaultInfinity: true });
const scalar = fc.integer({ min: -10000, max: 10000 });
const unit = fc.double({ min: 0, max: 1, noNaN: true });
const segment = fc.record({
  start: scalar,
  width: fc.integer({ min: 1, max: 10000 }),
  from: scalar,
  to: scalar,
});
const modes = ['clamp', 'extend', 'identity'] as const;

// Import the source barrel until the package-layout task adds a /motion export.
describe('interpolate', () => {
  it('evaluates the design.md §6.2 opacity example, including its easing', () => {
    const options = { extrapolate: 'clamp', easing: easing.easeOutCubic } as const;
    expect(value(interpolate(-1, [0, 0.6], [0, 1], options))).toBe(0);
    expect(value(interpolate(0, [0, 0.6], [0, 1], options))).toBe(0);
    expect(value(interpolate(0.15, [0, 0.6], [0, 1], options))).toBe(0.578125);
    expect(value(interpolate(0.3, [0, 0.6], [0, 1], options))).toBe(0.875);
    expect(value(interpolate(0.6, [0, 0.6], [0, 1], options))).toBe(1);
    expect(value(interpolate(1, [0, 0.6], [0, 1], options))).toBe(1);
  });

  it('defaults to clamp and linear and handles descending output and multiple stops', () => {
    expect(value(interpolate(-1, [0, 1], [10, 20]))).toBe(10);
    expect(value(interpolate(0.25, [0, 1], [10, 20]))).toBe(12.5);
    expect(value(interpolate(1.5, [0, 1, 3], [20, 10, 30]))).toBe(15);
    expect(value(interpolate(1, [0, 1, 3], [20, 10, 30]))).toBe(10);
  });

  it.each([
    [[], []],
    [[0], [1]],
    [[0, 1], [0]],
    [
      [0, 1],
      [0, 1, 2],
    ],
    [
      [1, 0],
      [0, 1],
    ],
    [
      [0, 0],
      [0, 1],
    ],
    [
      [0, 2, 1],
      [0, 1, 2],
    ],
    [
      [0, Infinity],
      [0, 1],
    ],
    [
      [0, 1],
      [0, NaN],
    ],
  ])('returns a Diagnostic for invalid ranges %j / %j', (inputs, outputs) => {
    expect.hasAssertions();
    invalid(interpolate(0, inputs, outputs));
  });

  it.each([NaN, Infinity, -Infinity])('rejects nonfinite input %s', (input) => {
    expect.hasAssertions();
    invalid(interpolate(input, [0, 1], [0, 1]));
  });

  it('validates ranges even on identity and clamp early-return paths', () => {
    expect.hasAssertions();
    invalid(interpolate(-10, [0, 1], [0, Infinity], { extrapolate: 'identity' }));
    invalid(interpolate(-10, [0, 1, 1], [0, 1, 2]));
  });

  it('distinguishes all extrapolate modes and extends the raw slope, not the easing', () => {
    for (const [input, expected] of [
      [0, [10, 0, 0]],
      [5, [20, 25, 5]],
    ] as const) {
      expect(
        modes.map((extrapolate) =>
          value(
            interpolate(input, [2, 4], [10, 20], {
              extrapolate,
              easing: easing.easeInCubic,
            }),
          ),
        ),
      ).toEqual(expected);
    }
    expect(
      value(
        interpolate(3, [2, 4], [10, 20], { extrapolate: 'identity', easing: easing.easeInCubic }),
      ),
    ).toBe(11.25);
  });

  it('clamps progress before a non-clamping custom easing, never its output', () => {
    // Deliberately non-endpoint-preserving to expose which quantity is clamped.
    const options = { extrapolate: 'clamp', easing: (p: number) => p * 2 } as const;
    expect(value(interpolate(-1, [0, 1], [10, 20], options))).toBe(10);
    expect(value(interpolate(0.75, [0, 1], [10, 20], options))).toBe(25);
    expect(value(interpolate(1, [0, 1], [10, 20], options))).toBe(20);
    expect(value(interpolate(2, [0, 1], [10, 20], options))).toBe(30);
  });

  it('extends the eased endpoint by the raw slope without easing unbounded progress', () => {
    const options = { extrapolate: 'extend', easing: (p: number) => p ** 3 } as const;
    expect(value(interpolate(-1, [0, 1], [10, 20], options))).toBe(0);
    expect(value(interpolate(2, [0, 1], [10, 20], options))).toBe(30);
  });

  it('does not re-clamp an overshooting easing', () => {
    expect(value(interpolate(0.7, [0, 1], [0, 1], { easing: easing.easeOutBack }))).toBeGreaterThan(
      1,
    );
    fc.assert(
      fc.property(fc.double({ min: 0.6, max: 0.8, noNaN: true }), (p) => {
        expect(value(interpolate(p, [0, 1], [10, 20], { easing: easing.easeOutBack }))).toBeCloseTo(
          10 + 10 * easing.easeOutBack(p),
          10,
        );
        expect(
          value(interpolate(p, [0, 1], [10, 20], { easing: easing.easeOutBack })),
        ).toBeGreaterThan(20);
      }),
    );
  });

  it('keeps clamp within output bounds for bounded easings', () => {
    fc.assert(
      fc.property(
        segment,
        scalar,
        fc.constantFrom(easing.linear, easing.easeInCubic, easing.easeOutExpo),
        ({ start, width, from, to }, input, ease) => {
          const actual = value(
            interpolate(input, [start, start + width], [from, to], { easing: ease }),
          );
          expect(actual).toBeGreaterThanOrEqual(Math.min(from, to) - 1e-10);
          expect(actual).toBeLessThanOrEqual(Math.max(from, to) + 1e-10);
        },
      ),
    );
  });

  it('is monotonic for monotonic easing and ascending output', () => {
    fc.assert(
      fc.property(
        unit,
        unit,
        fc.constantFrom(
          easing.linear,
          easing.easeInCubic,
          easing.easeOutCubic,
          easing.easeInOutExpo,
        ),
        (a, b, ease) => {
          const first = value(interpolate(Math.min(a, b), [0, 1], [-30, 80], { easing: ease }));
          const last = value(interpolate(Math.max(a, b), [0, 1], [-30, 80], { easing: ease }));
          expect(first).toBeLessThanOrEqual(last + 1e-12);
        },
      ),
    );
  });

  it('is the identity for equal ranges with linear easing', () => {
    fc.assert(
      fc.property(segment, unit, ({ start, width }, p) => {
        const input = start + p * width;
        expect(
          value(interpolate(input, [start, start + width], [start, start + width])),
        ).toBeCloseTo(input, 8);
      }),
    );
  });

  it('returns exact range endpoints under every extrapolate mode', () => {
    fc.assert(
      fc.property(
        scalar,
        fc.array(fc.record({ width: fc.integer({ min: 1, max: 10000 }), output: scalar }), {
          minLength: 3,
          maxLength: 10,
        }),
        fc.constantFrom(...modes),
        (start, stops, extrapolate) => {
          let time = start;
          const frames = stops.map(({ width, output }) => {
            time += width;
            return { time, value: output };
          });
          const inputs = frames.map((frame) => frame.time);
          const outputs = frames.map((frame) => frame.value);
          const options = { extrapolate, easing: easing.easeOutExpo };
          for (const frame of frames) {
            expect(value(interpolate(frame.time, inputs, outputs, options))).toBe(frame.value);
            expect(value(keyframes(frame.time, frames, options))).toBe(frame.value);
          }
        },
      ),
    );
  });

  it('extends the first segment with its raw slope below the first stop', () => {
    fc.assert(
      fc.property(
        segment,
        fc.integer({ min: 1, max: 100 }),
        ({ start, width, from, to }, distance) => {
          const actual = value(
            interpolate(start - distance * width, [start, start + width], [from, to], {
              extrapolate: 'extend',
              easing: easing.easeOutCubic,
            }),
          );
          expect(actual).toBeCloseTo(from - distance * (to - from), 7);
        },
      ),
    );
  });

  it('makes identity outside the whole range distinct from clamp and extend', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 20 }), (distance) => {
        const outputs = modes.map((extrapolate) =>
          value(interpolate(2 + distance, [0, 2], [10, 30], { extrapolate })),
        );
        expect(outputs).toEqual([30, 30 + distance * 10, 2 + distance]);
        expect(new Set(outputs).size).toBe(3);
      }),
    );
  });

  it('handles extreme finite ranges without spurious arithmetic overflow', () => {
    const max = Number.MAX_VALUE;
    expect(value(interpolate(0, [-max, max], [-max, max]))).toBe(0);
    expect(value(interpolate(max, [-max, max], [-max, max]))).toBe(max);
    expect(value(interpolate(0.5, [0, 1], [-max, max]))).toBe(0);
    expect(value(interpolate(max, [0, Number.MIN_VALUE], [4, 4], { extrapolate: 'extend' }))).toBe(
      4,
    );
    invalid(
      interpolate(max, [0, 1], [0, max], { extrapolate: 'extend' }),
      'motion.non-finite-result',
    );
    invalid(interpolate(0.5, [0, 1], [0, 1], { easing: () => NaN }), 'motion.non-finite-result');
  });

  it('extends large opposite-sign endpoints to a representable finite value', () => {
    const from = -0.6 * Number.MAX_VALUE;
    const to = 0.6 * Number.MAX_VALUE;
    const actual = value(interpolate(-0.1, [0, 1], [from, to], { extrapolate: 'extend' }));
    expect(actual / Number.MAX_VALUE).toBeCloseTo(-0.72, 14);
    expect(actual).toBe(from + -0.1 * to - -0.1 * from);
  });

  it('preserves representable Back overshoot with large opposite-sign endpoints', () => {
    const from = -0.6 * Number.MAX_VALUE;
    const to = 0.6 * Number.MAX_VALUE;
    const p = easing.easeOutBack(0.7);
    const actual = value(interpolate(0.7, [0, 1], [from, to], { easing: easing.easeOutBack }));
    expect(actual / Number.MAX_VALUE).toBeCloseTo(0.696239448, 14);
    expect(actual).toBe(from * (1 - p) + to * p);
  });

  it('avoids overflow before same-sign cancellation or tiny-width extension', () => {
    const max = Number.MAX_VALUE;
    const outputs = [max, 0.25 * max];
    expect(value(interpolate(2.5, [0, 1], outputs, { extrapolate: 'extend' })) / max).toBeCloseTo(
      -0.875,
      14,
    );
    expect(
      value(interpolate(0.5, [0, 1], outputs, { easing: (p) => p + 8 * p * (1 - p) })) / max,
    ).toBeCloseTo(-0.875, 14);
    expect(
      value(
        interpolate(2, [0, Number.MIN_VALUE], [0, Number.MIN_VALUE], { extrapolate: 'extend' }),
      ),
    ).toBe(2);
  });

  it('diagnoses genuinely overflowing extension and Back overshoot', () => {
    expect.hasAssertions();
    const max = Number.MAX_VALUE;
    invalid(
      interpolate(-1, [0, 1], [-0.6 * max, 0.6 * max], { extrapolate: 'extend' }),
      'motion.non-finite-result',
    );
    invalid(
      interpolate(0.7, [0, 1], [-max, max], { easing: easing.easeOutBack }),
      'motion.non-finite-result',
    );
  });

  it.each([
    [-Number.MAX_VALUE, [-0.6 * Number.MAX_VALUE, 0.6 * Number.MAX_VALUE]],
    [Number.MAX_VALUE, [-0.6 * Number.MAX_VALUE, 0.6 * Number.MAX_VALUE]],
    [Number.MAX_VALUE, [Number.MAX_VALUE, -0.5 * Number.MAX_VALUE]],
  ])('retains genuine overflow after halving an output difference: %s / %j', (input, outputs) => {
    expect.hasAssertions();
    invalid(
      interpolate(input, [-Number.MAX_VALUE / 2, Number.MAX_VALUE / 2], outputs, {
        extrapolate: 'extend',
      }),
      'motion.non-finite-result',
    );
  });

  it.each([
    {
      input: -1.5,
      inputs: [0, 1],
      outputs: [-0.1 * Number.MAX_VALUE, Number.MAX_VALUE],
      ease: () => 1,
      expected: -1.1685005376605052e308,
    },
    {
      input: 2.5,
      inputs: [0, 1],
      outputs: [Number.MAX_VALUE, -0.1 * Number.MAX_VALUE],
      ease: () => 0,
      expected: -1.1685005376605052e308,
    },
    {
      input: Number.MAX_VALUE,
      inputs: [-Number.MAX_VALUE, -0.75 * Number.MAX_VALUE],
      outputs: [Number.MAX_VALUE, 0.8 * Number.MAX_VALUE],
      ease: easing.linear,
      expected: -1.0786158809173887e308,
    },
    {
      input: -Number.MAX_VALUE,
      inputs: [0.75 * Number.MAX_VALUE, Number.MAX_VALUE],
      outputs: [0.8 * Number.MAX_VALUE, Number.MAX_VALUE],
      ease: easing.linear,
      expected: -1.0786158809173887e308,
    },
  ])('restores the halved scale for a representable retry: $input / $inputs', (test) => {
    // References evaluate base + (input-endpoint)*(to-from)/(end-start) as an
    // exact rational of the supplied binary64 operands, then round once to
    // nearest, ties-to-even (not decimal 0.1/0.8 arithmetic). The first pair
    // halves the output difference; the second pair halves the input distance.
    // Each reference is in the 2^1023 binade (ULP = 2^971). Allow two ULPs:
    // the scaled implementation rounds its quotient/product and cancellation
    // separately, rather than promising a single correctly rounded operation.
    const actual = value(
      interpolate(test.input, test.inputs, test.outputs, {
        extrapolate: 'extend',
        easing: test.ease,
      }),
    );
    expect(Math.abs(actual - test.expected)).toBeLessThanOrEqual(2 * 2 ** 971);
  });

  it('is total over arbitrary finite data and keeps successful results finite', () => {
    fc.assert(
      fc.property(
        finite,
        finite,
        finite,
        finite,
        finite,
        fc.constantFrom(...modes),
        (input, a, b, from, to, extrapolate) => {
          const result = interpolate(input, [Math.min(a, b), Math.max(a, b)], [from, to], {
            extrapolate,
          });
          expect(
            result.ok
              ? Number.isFinite(result.value)
              : DiagnosticSchema.safeParse(result.error).success,
          ).toBe(true);
        },
      ),
      { numRuns: 500 },
    );
  });
});

describe('easing', () => {
  const families: readonly Easing[] = [
    easing.linear,
    easing.easeInCubic,
    easing.easeOutCubic,
    easing.easeInOutCubic,
    easing.easeInExpo,
    easing.easeOutExpo,
    easing.easeInOutExpo,
    easing.easeInBack,
    easing.easeOutBack,
    easing.easeInOutBack,
  ];

  it('pins the standard family formulas at interior points', () => {
    expect(families.map((ease) => ease(0.25))).toEqual([
      0.25,
      0.015625,
      0.578125,
      0.0625,
      2 ** -7.5,
      1 - 2 ** -2.5,
      2 ** -5 / 2,
      2.70158 * 0.25 ** 3 - 1.70158 * 0.25 ** 2,
      1 + 2.70158 * (-0.75) ** 3 + 1.70158 * (-0.75) ** 2,
      (0.5 ** 2 * ((1.70158 * 1.525 + 1) * 0.5 - 1.70158 * 1.525)) / 2,
    ]);
  });

  it('has exact endpoints and clamps direct progress outside [0,1]', () => {
    for (const ease of families) {
      expect(ease(0)).toBe(0);
      expect(ease(1)).toBe(1);
      expect(ease(-Number.MAX_VALUE)).toBe(0);
      expect(ease(Number.MAX_VALUE)).toBe(1);
    }
    fc.assert(
      fc.property(finite, (p) => {
        for (const ease of families) expect(Number.isFinite(ease(p))).toBe(true);
      }),
    );
  });

  it('has symmetric in/out families', () => {
    // Binary fractions keep 1-p away from endpoint rounding at subnormal p.
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1024 }), (step) => {
        const p = step / 1024;
        expect(easing.easeInCubic(p)).toBeCloseTo(1 - easing.easeOutCubic(1 - p), 12);
        expect(easing.easeInExpo(p)).toBeCloseTo(1 - easing.easeOutExpo(1 - p), 12);
        expect(easing.easeInBack(p)).toBeCloseTo(1 - easing.easeOutBack(1 - p), 12);
        for (const ease of [easing.easeInOutCubic, easing.easeInOutExpo, easing.easeInOutBack]) {
          expect(ease(p)).toBeCloseTo(1 - ease(1 - p), 12);
        }
      }),
    );
  });

  it('solves CSS cubic-bezier x rather than treating progress as the curve parameter', () => {
    const ease = value(easing.cubicBezier(0.25, 0.1, 0.25, 1));
    expect(ease(0.5)).toBeCloseTo(0.8024033876, 9);
    expect(ease(0)).toBe(0);
    expect(ease(1)).toBe(1);
    expect(ease(-1)).toBe(0);
    expect(ease(2)).toBe(1);
    expect(value(easing.cubicBezier(0, 0, 0, 1))(0.125)).toBeCloseTo(0.5, 12);
    expect(value(easing.cubicBezier(1, 0, 1, 1))(0.875)).toBeCloseTo(0.5, 12);
    expect(value(easing.cubicBezier(0, 1, 0, 1))(1e-300)).toBeCloseTo(3e-100, 110);
  });

  it.each([
    [-0.01, 0, 1, 1],
    [1.01, 0, 1, 1],
    [0, 0, -0.01, 1],
    [0, 0, 1.01, 1],
    [NaN, 0, 1, 1],
    [0, Infinity, 1, 1],
    [0, 0, 1, -Infinity],
  ])('rejects invalid cubic-bezier controls %j', (x1, y1, x2, y2) => {
    expect.hasAssertions();
    invalid(easing.cubicBezier(x1, y1, x2, y2));
  });

  it('allows unrestricted finite y and reversed x controls, including overshoot', () => {
    const overshoot = value(easing.cubicBezier(0.2, 2, 0.8, 2));
    expect(overshoot(0.5)).toBeGreaterThan(1);
    expect(value(easing.cubicBezier(1, 0, 0, 1))(0.5)).toBeCloseTo(0.5, 12);
    fc.assert(
      fc.property(unit, finite, finite, (p, y1, y2) => {
        expect(Number.isFinite(value(easing.cubicBezier(0.3, y1, 0.7, y2))(p))).toBe(true);
      }),
    );
  });

  it('inverts parametrically generated CSS coordinates', () => {
    fc.assert(
      fc.property(unit, unit, unit, (x1, x2, t) => {
        const x = 3 * (1 - t) ** 2 * t * x1 + 3 * (1 - t) * t ** 2 * x2 + t ** 3;
        const expected = 3 * (1 - t) * t ** 2 + t ** 3;
        expect(value(easing.cubicBezier(x1, 0, x2, 1))(x)).toBeCloseTo(expected, 7);
      }),
    );
  });
});

describe('keyframes', () => {
  it('selects segments, passes options, and returns exact stops', () => {
    const frames = Object.freeze(
      [
        { time: 1, value: 10 },
        { time: 3, value: 30 },
        { time: 4, value: 0 },
      ].map((frame) => Object.freeze(frame)),
    );
    expect(value(keyframes(2, frames))).toBe(20);
    expect(value(keyframes(3, frames))).toBe(30);
    expect(value(keyframes(4, frames))).toBe(0);
    expect(value(keyframes(3.5, frames, { easing: easing.easeInCubic }))).toBe(26.25);
    expect(value(keyframes(5, frames, { extrapolate: 'identity' }))).toBe(5);
    expect(value(keyframes(5, frames, { extrapolate: 'extend' }))).toBe(-30);
  });

  it('pins every exact stop independently of easing and selects the segment immediately after it', () => {
    const frames = [
      { time: 1, value: 10 },
      { time: 2, value: 30 },
      { time: 3, value: -20 },
      { time: 4, value: 50 },
    ];
    // Neither endpoint is preserved: distinguish ending vs starting segments
    // even at progress zero, where p => p * 2 would mask the >= mutation.
    const ease = (p: number): number => p * 2 + 1;
    for (const extrapolate of modes) {
      const options = { extrapolate, easing: ease };
      for (const frame of frames) {
        expect(value(keyframes(frame.time, frames, options))).toBe(frame.value);
      }
      for (const [start, from, to] of [
        [1, 10, 30],
        [2, 30, -20],
        [3, -20, 50],
      ] as const) {
        // This is the very next representable binary64 time after each stop.
        const after = start + (start === 1 ? Number.EPSILON : 2 * Number.EPSILON);
        const expected = from + (to - from) * ease(after - start);
        expect(value(keyframes(after, frames, options))).toBe(expected);
      }
    }
  });

  it('returns every exact stop of five frames and clamps beyond the final stop', () => {
    const frames = [
      { time: 1, value: 10 },
      { time: 3, value: 30 },
      { time: 4, value: 0 },
      { time: 7, value: -20 },
      { time: 9, value: 50 },
    ];
    expect(value(keyframes(1, frames))).toBe(10);
    expect(value(keyframes(3, frames))).toBe(30);
    expect(value(keyframes(4, frames))).toBe(0);
    expect(value(keyframes(7, frames))).toBe(-20);
    expect(value(keyframes(9, frames))).toBe(50);
    expect(value(keyframes(10, frames))).toBe(50);
  });

  it.each(
    [
      [],
      [{ time: 0, value: 0 }],
      [
        { time: 1, value: 0 },
        { time: 0, value: 1 },
      ],
      [
        { time: 1, value: 0 },
        { time: 1, value: 1 },
      ],
      [
        { time: 0, value: 0 },
        { time: 1, value: Infinity },
      ],
    ].map((frames) => ({ frames })),
  )('rejects invalid frames $frames', ({ frames }) => {
    expect.hasAssertions();
    invalid(keyframes(0, frames));
  });

  it('agrees with interpolate on two stops, including extrapolation and easing', () => {
    fc.assert(
      fc.property(
        segment,
        scalar,
        fc.constantFrom(...modes),
        fc.constantFrom(easing.linear, easing.easeOutCubic, easing.easeInBack),
        ({ start, width, from, to }, input, extrapolate, ease) => {
          const options: InterpolateOptions = { extrapolate, easing: ease };
          const frames = [
            { time: start, value: from },
            { time: start + width, value: to },
          ];
          for (const time of [input, start, start + width]) {
            expect(keyframes(time, frames, options)).toEqual(
              interpolate(time, [start, start + width], [from, to], options),
            );
          }
          expect(value(keyframes(start, frames, options))).toBe(from);
          expect(value(keyframes(start + width, frames, options))).toBe(to);
        },
      ),
    );
  });

  it('is order-independent under random seeking and repeated evaluation', () => {
    const frames = [
      { time: -1, value: 100 },
      { time: 1, value: 0 },
      { time: 3, value: 80 },
    ];
    fc.assert(
      fc.property(fc.array(scalar), (times) => {
        const forward = times.map((time) =>
          keyframes(time / 100, frames, { easing: easing.easeInOutCubic }),
        );
        const reverse = times
          .toReversed()
          .map((time) => keyframes(time / 100, frames, { easing: easing.easeInOutCubic }));
        expect(reverse.toReversed()).toEqual(forward);
      }),
    );
  });
});
