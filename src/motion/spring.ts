import type { Result } from '../lib/result.ts';

import { finiteResult, invalidInput } from './diagnostic.ts';

/** Seconds, value units, and value units/second; all fields are explicit. */
export type Spring = {
  readonly from: number;
  readonly to: number;
  readonly start: number;
  readonly velocity: number;
  readonly stiffness: number;
  readonly damping: number;
  readonly mass: number;
};

export type SpringState = { readonly position: number; readonly velocity: number };
export type RetargetOptions = Pick<Spring, 'to'> &
  Partial<Pick<Spring, 'stiffness' | 'damping' | 'mass'>>;

type Model = { a: number; w: number; q: number; slow: number; regime: -1 | 0 | 1 };

const model = (s: Spring): Result<Model> => {
  if (
    !Object.values(s).every(Number.isFinite) ||
    s.stiffness <= 0 ||
    s.mass <= 0 ||
    s.damping <= 0
  ) {
    return invalidInput(
      'Spring fields must be finite, with positive stiffness, damping and mass.',
      'Supply every Spring field; use strictly positive physical parameters.',
    );
  }
  const w = Math.sqrt(s.stiffness) / Math.sqrt(s.mass);
  const ratio = s.damping / s.mass;
  const a = Number.isFinite(ratio) ? ratio / 2 : s.damping / 2 / s.mass;
  const regime = a < w ? -1 : a > w ? 1 : 0;
  // Factored discriminant: neither a*a nor w*w is materialised.
  const large = Math.max(a, w);
  const small = Math.min(a, w);
  const q = Math.sqrt(large - small) * Math.sqrt(large) * Math.sqrt(1 + small / large);
  const slow = regime === 1 ? (w * (w / a)) / (1 + q / a) : a;
  if (![a, w, q, slow].every(Number.isFinite) || slow <= 0) return finiteFailure();
  return { ok: true, value: { a, w, q, slow, regime } };
};

const finiteFailure = (): Result<never> => {
  const result = finiteResult(NaN);
  if (!result.ok) return result;
  throw new Error('Non-finite diagnostic invariant');
};

// C and S are the exponentially scaled cosine/cosh and sine/sinh divided by q.
// See docs/contexts/motion/adr/20261024-closed-form-spring.accepted.md.
const basis = (t: number, m: Model): { c: number; s: number } => {
  const z = m.q * t;
  if (Math.abs(z) < 0.001) {
    // Near-critical means small discriminant * elapsed time, not a fixed
    // damping-ratio window. Keep the signed terms, rather than snapping regimes.
    const z2 = m.regime * z * z;
    const decay = Math.exp(-m.a * t);
    return {
      c: decay * (1 + z2 / 2 + (z2 * z2) / 24 + (z2 * z2 * z2) / 720),
      s: decay * t * (1 + z2 / 6 + (z2 * z2) / 120 + (z2 * z2 * z2) / 5040),
    };
  }
  if (m.regime === -1) {
    const decay = Math.exp(-m.a * t);
    if (decay === 0) return { c: 0, s: 0 };
    return { c: decay * Math.cos(z), s: (decay * Math.sin(z)) / m.q };
  }
  // Never multiply an overflowing cosh by an underflowing exponential.
  const slow = Math.exp(-m.slow * t);
  const fastRatio = Math.exp(-2 * z);
  return { c: (slow * (1 + fastRatio)) / 2, s: (slow * (-Math.expm1(-2 * z) / 2)) / m.q };
};

const evaluate = (t: number, s: Spring, m: Model): SpringState => {
  if (s.from === s.to && s.velocity === 0) return { position: s.to, velocity: 0 };
  const { c, s: sine } = basis(t, m);
  const realRoots = m.regime === 1 && m.q * t >= 0.001;
  const slowDecay = Math.exp(-m.slow * t);
  const fastDecay = realRoots ? slowDecay * Math.exp(-2 * m.q * t) : 0;
  const p = realRoots ? slowDecay + m.slow * sine : c + m.a * sine;
  const v = -m.w * (m.w * sine);
  const velocityAt = (displacement: number, initialVelocity: number): number => {
    if (!realRoots) return v * displacement + (c - m.a * sine) * initialVelocity;
    // v(t) = -slow*y(t) + exp(-fast*t)*(v0 + slow*y0).
    // Do not form C-aS (cancellation) or slow*S before multiplying v0
    // (underflow): the final velocity can still be large and representable.
    return (
      -m.slow * (p * displacement + sine * initialVelocity) +
      fastDecay * initialVelocity +
      m.slow * (fastDecay * displacement)
    );
  };
  const displacement = s.from - s.to;
  // Prefer the displacement form (not a weighted sum of large equal endpoints).
  // Half-scale an overflowing displacement before applying its coefficient.
  const position = Number.isFinite(displacement)
    ? s.to + p * displacement + sine * s.velocity
    : (s.to / 2 + p * (s.from / 2 - s.to / 2) + sine * (s.velocity / 2)) * 2;
  const velocity = Number.isFinite(displacement)
    ? velocityAt(displacement, s.velocity)
    : velocityAt(s.from / 2 - s.to / 2, s.velocity / 2) * 2;
  return { position, velocity };
};

/** Closed-form state, including analytic velocity. Before start, hold from with zero velocity. */
const sample = (time: number, s: Spring): Result<SpringState> => {
  const checked = model(s);
  if (!checked.ok) return checked;
  if (!Number.isFinite(time))
    return invalidInput('Spring time must be finite.', 'Use a finite time in seconds.');
  if (time <= s.start)
    return { ok: true, value: { position: s.from, velocity: time === s.start ? s.velocity : 0 } };
  const t = time - s.start;
  if (!Number.isFinite(t)) return finiteFailure();
  return { ok: true, value: evaluate(t, s, checked.value) };
};

/** Position and analytic velocity; both must be representable. */
export const springState = (time: number, s: Spring): Result<SpringState> => {
  const result = sample(time, s);
  if (!result.ok) return result;
  return Number.isFinite(result.value.position) && Number.isFinite(result.value.velocity)
    ? result
    : finiteFailure();
};

/** Stateless position at an arbitrary time. No easing callback or integration history. */
export const spring = (time: number, s: Spring): Result<number> => {
  const state = sample(time, s);
  return state.ok ? finiteResult(state.value.position) : state;
};

/** Start a new immutable description, inheriting position and velocity at the switch. */
export const retarget = (s: Spring, atTime: number, options: RetargetOptions): Result<Spring> => {
  const state = springState(atTime, s);
  if (!state.ok) return state;
  const next: Spring = {
    ...s,
    ...options,
    from: state.value.position,
    velocity: state.value.velocity,
    start: atTime,
  };
  const checked = model(next);
  return checked.ok ? { ok: true, value: next } : checked;
};

const bisectEntry = (
  outside: number,
  inside: number,
  deviation: (t: number) => number,
  tolerance: number,
): number => {
  // Terminate on adjacent representable times, not a frame grid or scan cap.
  while (true) {
    const middle = outside + (inside - outside) / 2;
    if (middle === outside || middle === inside) return inside;
    if (Math.abs(deviation(middle)) > tolerance) outside = middle;
    else inside = middle;
  }
};

/**
 * Sustained settle duration from start (not an absolute timestamp): last entry
 * into |position-to| <= tolerance. Earlier target crossings do not count.
 * Positive absolute tolerance; a motion already sustained inside returns zero.
 */
export const springSettleTime = (s: Spring, tolerance: number): Result<number> => {
  const checked = model(s);
  if (!checked.ok) return checked;
  if (!Number.isFinite(tolerance) || tolerance <= 0) {
    return invalidInput(
      'Spring tolerance must be finite and positive.',
      'Use an absolute position tolerance greater than zero.',
    );
  }
  const m = checked.value;
  const y = s.from - s.to;
  const b = s.velocity + m.a * y;
  if (![y, b].every(Number.isFinite)) return finiteFailure();
  if (y === 0 && s.velocity === 0) return { ok: true, value: 0 };
  let evaluationFailed = false;
  const deviation = (t: number): number => {
    const time = s.start + t;
    const result = evaluate(time - s.start, s, m).position - s.to;
    if (!Number.isFinite(time) || !Number.isFinite(result)) evaluationFailed = true;
    return result;
  };

  // |y(t)| <= (|y| + |b|t) exp(-slow*t). Search ends at an analytic
  // envelope bound, never at an arbitrary time/iteration cap. Log space avoids overflow.
  const logEnvelope = (t: number): number => {
    const l = Math.log(Math.abs(y));
    const r = Math.log(Math.abs(b)) + Math.log(t);
    const top = Math.max(l, r);
    return top + Math.log(Math.exp(l - top) + Math.exp(r - top)) - m.slow * t;
  };
  let upper = 1 / m.slow;
  while (logEnvelope(upper) > Math.log(tolerance)) {
    upper *= 2;
    if (!Number.isFinite(upper)) return finiteFailure();
  }
  if (!Number.isFinite(upper)) return finiteFailure();
  let outside = 0;
  if (m.regime === -1) {
    // Velocity zeros are spaced pi/q. Locate the last above-tolerance peak
    // directly using their exponential decay, including low-damping springs.
    const scale = Math.max(Math.abs(y), Math.abs(s.velocity / m.w));
    if (!Number.isFinite(scale)) return finiteFailure();
    const initialVelocity = s.velocity / m.w / scale;
    const phase = Math.atan2(
      initialVelocity * (m.q / m.w),
      (m.a / m.w) * initialVelocity + y / scale,
    );
    const first = (((phase % Math.PI) + Math.PI) % Math.PI) / m.q;
    const period = Math.PI / m.q;
    const peak = Math.abs(deviation(first));
    if (peak > tolerance) {
      const count = Math.max(
        0,
        Math.ceil((Math.log(peak) - Math.log(tolerance)) / (m.a * period)) - 1,
      );
      if (!Number.isSafeInteger(count)) return finiteFailure();
      outside = first + count * period;
      // Roundoff at an exact peak/tolerance equality may select its neighbour.
      if (Math.abs(deviation(outside)) <= tolerance && count > 0) outside -= period;
      upper = Math.min(upper, outside + period / 2 + Math.atan(m.a / m.q) / m.q);
    }
  } else {
    // At most one positive extremum for a sum of two real exponentials.
    let extremum: number;
    if (m.regime === 0) extremum = s.velocity / b / m.a;
    else if (m.q / m.a < 0.001) {
      // atanh avoids subtracting two nearly equal real-root coefficients.
      const ratio = (s.velocity * (m.q / m.a)) / (s.velocity + (m.w / m.a) * m.w * y);
      extremum = Math.atanh(ratio) / m.q;
    } else {
      const slowCoefficient = (s.velocity / m.q + (m.a / m.q + 1) * y) / 2;
      const fastCoefficient = y - slowCoefficient;
      if (![slowCoefficient, fastCoefficient].every(Number.isFinite)) return finiteFailure();
      const opposed =
        (slowCoefficient > 0 && fastCoefficient < 0) ||
        (slowCoefficient < 0 && fastCoefficient > 0);
      // Take logs before ratios/products: a stiff fast mode can otherwise
      // overflow the derivative ratio even though its extremum is finite.
      extremum = opposed
        ? (Math.log(Math.abs(fastCoefficient)) -
            Math.log(Math.abs(slowCoefficient)) +
            Math.log(m.a) +
            Math.log1p(m.q / m.a) -
            Math.log(m.slow)) /
          m.q /
          2
        : -1;
    }
    if (extremum > 0 && Number.isFinite(extremum) && Math.abs(deviation(extremum)) > tolerance)
      outside = extremum;
  }
  if (Math.abs(deviation(outside)) <= tolerance) {
    return evaluationFailed ? finiteFailure() : { ok: true, value: 0 };
  }
  // The bound is analytic for exact arithmetic. Expand if output rounding at
  // a very large target still leaves its computed position outside the band.
  while (Math.abs(deviation(upper)) > tolerance) {
    upper *= 2;
    if (!Number.isFinite(upper)) return finiteFailure();
  }
  const duration = bisectEntry(outside, upper, deviation, tolerance);
  return evaluationFailed ? finiteFailure() : finiteResult(duration);
};
