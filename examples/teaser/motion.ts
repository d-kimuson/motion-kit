// Motion as plain arithmetic on time: /motion (interpolate, easing, spring, Stagger) and /theme have
// no public subpath yet, so the Phase 1 teaser computes its own springs and easings here. When
// Phase 2 lands, this module is what the example replaces; the Composition ids and the look stay
// (docs/design-doc/20261025-reference-examples.md, "teaser").

export const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

export const clamp01 = (value: number): number => clamp(value, 0, 1);

/** Step response of an underdamped spring released from rest toward 1 at t = 0. Overshoots by a few
 * percent before settling, which is the look the teaser's acceptance criteria ask for. */
export const springStep = (seconds: number, damping = 0.72, omega = 12): number => {
  if (!(seconds > 0)) return 0;
  const damped = omega * Math.sqrt(1 - damping * damping);
  const decay = Math.exp(-damping * omega * seconds);
  return (
    1 -
    decay * (Math.cos(damped * seconds) + ((damping * omega) / damped) * Math.sin(damped * seconds))
  );
};

export type SpringTarget = { readonly at: number; readonly to: number };

/** A spring whose target changes mid-flight. For a linear spring released from rest, the response to
 * a piecewise-constant target is the sum of the per-step responses, so this stays closed-form — the
 * retarget case the design doc names, without waiting for /motion. */
export const springChain = (
  seconds: number,
  targets: readonly SpringTarget[],
  damping = 0.72,
  omega = 12,
): number => {
  let previous = 0;
  let value = 0;
  for (const target of targets) {
    if (target.at >= seconds) break;
    value += (target.to - previous) * springStep(seconds - target.at, damping, omega);
    previous = target.to;
  }
  return value;
};

export const easeInCubic = (value: number): number => clamp01(value) ** 3;

export const easeOutCubic = (value: number): number => 1 - (1 - clamp01(value)) ** 3;
