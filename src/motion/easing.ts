import type { Result } from '../lib/result.ts';

import { invalidInput } from './diagnostic.ts';

/** Stateless progress mapping. Custom functions must be pure and finite; preserve endpoints for continuity. */
export type Easing = (progress: number) => number;

// Built-ins clamp direct calls too: no polynomial/exponential overflow for finite progress.
const bounded = (curve: Easing): Easing => {
  return (progress) => {
    if (progress <= 0) return 0;
    if (progress >= 1) return 1;
    return curve(progress);
  };
};

const linear: Easing = bounded((p) => p);
const easeInCubic: Easing = bounded((p) => p ** 3);
const easeOutCubic: Easing = bounded((p) => 1 - (1 - p) ** 3);
const easeInOutCubic: Easing = bounded((p) => (p < 0.5 ? 4 * p ** 3 : 1 - (-2 * p + 2) ** 3 / 2));
const easeInExpo: Easing = bounded((p) => 2 ** (10 * p - 10));
const easeOutExpo: Easing = bounded((p) => 1 - 2 ** (-10 * p));
const easeInOutExpo: Easing = bounded((p) =>
  p < 0.5 ? 2 ** (20 * p - 10) / 2 : (2 - 2 ** (-20 * p + 10)) / 2,
);
const back = 1.70158;
const backInOut = back * 1.525;
const easeInBack: Easing = bounded((p) => (back + 1) * p ** 3 - back * p ** 2);
const easeOutBack: Easing = bounded((p) => 1 + (back + 1) * (p - 1) ** 3 + back * (p - 1) ** 2);
const easeInOutBack: Easing = bounded((p) =>
  p < 0.5
    ? ((2 * p) ** 2 * ((backInOut + 1) * 2 * p - backInOut)) / 2
    : ((2 * p - 2) ** 2 * ((backInOut + 1) * (p * 2 - 2) + backInOut) + 2) / 2,
);

const coordinate = (t: number, first: number, second: number): number => {
  const inverse = 1 - t;
  return 3 * inverse ** 2 * t * first + 3 * inverse * t ** 2 * second + t ** 3;
};

/**
 * CSS control points: x1/x2 must be in [0,1]; finite y1/y2 may overshoot.
 * Solve x(t)=progress, then return y(t), not y(progress). Direct progress
 * outside [0,1] is clamped; interpolate's extend mode owns linear extension.
 */
const cubicBezier = (x1: number, y1: number, x2: number, y2: number): Result<Easing> => {
  if (![x1, y1, x2, y2].every(Number.isFinite) || x1 < 0 || x1 > 1 || x2 < 0 || x2 > 1) {
    return invalidInput(
      'Cubic-bezier control points are outside their domain.',
      'Use finite control points with x1 and x2 in [0, 1]; y1 and y2 may be any finite numbers.',
    );
  }
  return {
    ok: true,
    value: bounded((progress) => {
      if (x1 === y1 && x2 === y2) return progress;
      let lower = 0;
      let upper = 1;
      // Bisection is stable even with zero derivatives. The bound covers all
      // binary64 exponents, including tiny progress on a flat endpoint.
      for (let iteration = 0; iteration < 1100; iteration += 1) {
        const t = lower + (upper - lower) / 2;
        if (t === lower || t === upper) return coordinate(t, y1, y2);
        const x = coordinate(t, x1, x2);
        if (x === progress) return coordinate(t, y1, y2);
        if (x < progress) lower = t;
        else upper = t;
      }
      return coordinate(lower + (upper - lower) / 2, y1, y2);
    }),
  };
};

/** Standard cubic, exponential and Back in/out/in-out families, plus CSS Bézier. */
export const easing = {
  linear,
  easeInCubic,
  easeOutCubic,
  easeInOutCubic,
  easeInExpo,
  easeOutExpo,
  easeInOutExpo,
  easeInBack,
  easeOutBack,
  easeInOutBack,
  cubicBezier,
} as const;
