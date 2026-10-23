import { type DiagnosticCode } from '../../lib/diagnostic.ts';
import { type Result } from '../../lib/result.ts';

const timelineTime = Symbol('TimelineTime');
const frameRate = Symbol('FrameRate');

/** Exact, normalized seconds; construct at a boundary with createTimelineTime. */
export type TimelineTime = {
  readonly numerator: bigint;
  readonly denominator: bigint;
  readonly [timelineTime]: true;
};

/** Positive rational frames per second, constructed with createFrameRate. */
export type FrameRate = TimelineTime & { readonly [frameRate]: true };

/** The CLI-compatible rational input shape. Both components must be safe integers. */
export type RationalInput = { readonly numerator: number; readonly denominator: number };

export const timeFailure = (
  message: string,
  hint: string,
  code: DiagnosticCode = 'composition.props-invalid',
): Result<never> => ({
  ok: false,
  error: { code, severity: 'error', message, hint },
});

// Denominators are positive by construction. BigInt preserves exact intermediate products.
const rational = (numerator: bigint, denominator = 1n): TimelineTime => {
  let a = numerator < 0n ? -numerator : numerator;
  let b = denominator;
  while (b !== 0n) {
    const remainder = a % b;
    a = b;
    b = remainder;
  }
  return Object.freeze({
    numerator: numerator / a,
    denominator: denominator / a,
    [timelineTime]: true,
  } satisfies TimelineTime);
};

/** Number seconds mean the decimal represented by String(value), not its IEEE binary fraction.
 * Use RationalInput to avoid passing an exact value through floating point.
 */
export const createTimelineTime = (input: number | RationalInput): Result<TimelineTime> => {
  if (typeof input !== 'number') {
    if (
      !Number.isSafeInteger(input.numerator) ||
      !Number.isSafeInteger(input.denominator) ||
      input.denominator <= 0
    ) {
      return timeFailure(
        'Timeline time must have safe integer components and a positive denominator.',
        'Supply an integer numerator and a positive integer denominator within Number.MAX_SAFE_INTEGER.',
      );
    }
    return { ok: true, value: rational(BigInt(input.numerator), BigInt(input.denominator)) };
  }
  if (!Number.isFinite(input) || Math.abs(input) > Number.MAX_SAFE_INTEGER) {
    return timeFailure(
      'Seconds must be finite and within the safe numeric range.',
      'Supply finite seconds or an exact rational with safe integer components.',
    );
  }
  const [mantissa = '0', exponentText = '0'] = String(input).split('e');
  const [whole = '0', fraction = ''] = mantissa.split('.');
  const exponent = Number(exponentText) - fraction.length;
  const numerator = BigInt(whole + fraction);
  return {
    ok: true,
    value:
      exponent >= 0
        ? rational(numerator * 10n ** BigInt(exponent))
        : rational(numerator, 10n ** BigInt(-exponent)),
  };
};

export const createFrameRate = (input: RationalInput): Result<FrameRate> => {
  const result = createTimelineTime(input);
  if (!result.ok) return result;
  if (result.value.numerator <= 0n) {
    return timeFailure(
      'Frame rate must be positive.',
      'Supply positive numerator and denominator values, such as 30000/1001.',
    );
  }
  return {
    ok: true,
    value: Object.freeze({ ...result.value, [frameRate]: true } satisfies FrameRate),
  };
};

export const addTime = (a: TimelineTime, b: TimelineTime): TimelineTime =>
  rational(
    a.numerator * b.denominator + b.numerator * a.denominator,
    a.denominator * b.denominator,
  );

export const subtractTime = (a: TimelineTime, b: TimelineTime): TimelineTime =>
  rational(
    a.numerator * b.denominator - b.numerator * a.denominator,
    a.denominator * b.denominator,
  );

export const compareTime = (a: TimelineTime, b: TimelineTime): -1 | 0 | 1 => {
  const difference = a.numerator * b.denominator - b.numerator * a.denominator;
  return difference < 0n ? -1 : difference > 0n ? 1 : 0;
};

/** Lossy seconds for expression libraries only; never feed this back into boundary comparisons. */
export const toSeconds = (time: TimelineTime): number => {
  const n = time.numerator.toString();
  const d = time.denominator.toString();
  const negative = n.startsWith('-');
  const digits = negative ? n.slice(1) : n;
  const head = (text: string): number => Number(`${text[0]}.${text.slice(1, 17)}`);
  const mantissa = ((negative ? -1 : 1) * head(digits)) / head(d);
  return Number(`${mantissa}e${digits.length - d.length}`);
};

export const frameToTime = (frame: bigint, fps: FrameRate): TimelineTime =>
  rational(frame * fps.denominator, fps.numerator);

export const framePosition = (time: TimelineTime, fps: FrameRate): TimelineTime =>
  rational(time.numerator * fps.numerator, time.denominator * fps.denominator);

// Lean Rat.floor uses Euclidean division; JS BigInt division truncates toward zero.
const floor = (value: TimelineTime): bigint => {
  const quotient = value.numerator / value.denominator;
  return value.numerator < 0n && value.numerator % value.denominator !== 0n
    ? quotient - 1n
    : quotient;
};

/** Default presentation-time conversion; exact boundaries belong to that frame. */
export const timeToFrameFloor = (time: TimelineTime, fps: FrameRate): bigint =>
  floor(framePosition(time, fps));

/** Explicit helper; never selected implicitly by the runtime. */
export const timeToFrameCeil = (time: TimelineTime, fps: FrameRate): bigint => {
  const position = framePosition(time, fps);
  return -floor(rational(-position.numerator, position.denominator));
};

/** Explicit nearest helper; signed half-frame ties go toward positive infinity. */
export const timeToFrameNearest = (time: TimelineTime, fps: FrameRate): bigint =>
  floor(addTime(framePosition(time, fps), rational(1n, 2n)));

export const frameCount = (duration: TimelineTime, fps: FrameRate): Result<bigint> =>
  duration.numerator < 0n
    ? timeFailure(
        'Duration must be nonnegative.',
        'Supply a zero or positive duration.',
        'composition.duration-invalid',
      )
    : { ok: true, value: timeToFrameCeil(duration, fps) };

export const durationFromFrameCount = (count: bigint, fps: FrameRate): Result<TimelineTime> =>
  count < 0n
    ? timeFailure(
        'Frame count must be nonnegative.',
        'Supply a zero or positive frame count.',
        'composition.duration-invalid',
      )
    : { ok: true, value: frameToTime(count, fps) };

/** Output requests are safe integer indices in [0, total); signed conversion itself is unrestricted.
 * Only safe-integer rejections carry location.frame: the Diagnostic schema cannot represent others.
 */
export const validateOutputFrame = (frame: number, total: bigint): Result<bigint> => {
  if (!Number.isSafeInteger(frame) || frame < 0 || BigInt(frame) >= total) {
    return {
      ok: false,
      error: {
        code: 'composition.props-invalid',
        severity: 'error',
        message: Number.isSafeInteger(frame)
          ? 'Output frame is outside the composition frame range.'
          : `Output frame "${String(frame)}" must be a finite safe integer.`,
        hint: 'Request a safe integer frame greater than or equal to zero and less than the frame count.',
        ...(Number.isSafeInteger(frame) ? { location: { frame } } : {}),
      },
    };
  }
  return { ok: true, value: BigInt(frame) };
};

/** Internal exact ratio for transition progress; callers establish a positive denominator time. */
export const divideTime = (a: TimelineTime, b: TimelineTime): TimelineTime =>
  rational(a.numerator * b.denominator, a.denominator * b.numerator);

export const zeroTime: TimelineTime = rational(0n);
export const oneTime: TimelineTime = rational(1n);
