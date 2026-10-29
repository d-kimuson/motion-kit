import { type Diagnostic } from '../../lib/diagnostic.ts';
import { type Result } from '../../lib/result.ts';
import { decodePng } from './png.ts';

/** How two captures are compared. `exact` claims byte identity; `pixels` decodes both captures
 * and claims a bounded visual difference instead.
 */
export type CheckComparison =
  | { readonly mode: 'exact' }
  | {
      readonly mode: 'pixels';
      /** Integer 0..255. A channel changed only when `|Δ| > channelTolerance`. */
      readonly channelTolerance: number;
      /** 0..1. A capture is within tolerance when `changedRatio <= maxChangedRatio`. */
      readonly maxChangedRatio: number;
      /** Chromium's PNG capture is opaque, so alpha is not compared yet. */
      readonly alpha: 'ignore';
    };

export const defaultCheckComparison: CheckComparison = {
  mode: 'pixels',
  channelTolerance: 32,
  maxChangedRatio: 0.002,
  alpha: 'ignore',
};

export type CheckDifference =
  | {
      readonly mode: 'exact';
      readonly differentBytes: number;
      readonly referenceBytes: number;
      readonly actualBytes: number;
    }
  | {
      readonly mode: 'pixels';
      readonly totalPixels: number;
      readonly changedPixels: number;
      readonly changedRatio: number;
      /** Maximum absolute difference over the compared channels, even within tolerance. */
      readonly maxChannelDelta: number;
    }
  | {
      readonly mode: 'dimensions';
      readonly reference: { readonly width: number; readonly height: number };
      readonly actual: { readonly width: number; readonly height: number };
    };

export type CheckStatus = 'identical' | 'within-tolerance' | 'differs';

export type CheckComparisonResult = {
  readonly status: CheckStatus;
  readonly difference: CheckDifference;
};

/** Argument validation for the boundary that receives user-chosen comparison settings. */
export const checkComparisonDiagnostic = (comparison: CheckComparison): Diagnostic | undefined => {
  if (comparison.mode === 'exact') return undefined;
  const valid =
    Number.isSafeInteger(comparison.channelTolerance) &&
    comparison.channelTolerance >= 0 &&
    comparison.channelTolerance <= 255 &&
    Number.isFinite(comparison.maxChangedRatio) &&
    comparison.maxChangedRatio >= 0 &&
    comparison.maxChangedRatio <= 1;
  return valid
    ? undefined
    : {
        code: 'cli.invalid-arguments',
        severity: 'error',
        message: 'The check comparison settings are invalid.',
        hint: 'Use an integer channelTolerance from 0 to 255 and a maxChangedRatio from 0 to 1.',
      };
};

const countDifferentBytes = (actual: Uint8Array, reference: Uint8Array): number => {
  const length = Math.max(actual.length, reference.length);
  let different = 0;
  for (let index = 0; index < length; index += 1) {
    if (actual[index] !== reference[index]) different += 1;
  }
  return different;
};

const pixelChannel = (pixels: Uint8Array, index: number): number => {
  const value = pixels[index];
  if (value === undefined) throw new Error('The decoded PNG pixel buffer is truncated.');
  return value;
};

const compareExact = (actual: Uint8Array, reference: Uint8Array): CheckComparisonResult => {
  const differentBytes = countDifferentBytes(actual, reference);
  return {
    status: differentBytes === 0 ? 'identical' : 'differs',
    difference: {
      mode: 'exact',
      differentBytes,
      referenceBytes: reference.length,
      actualBytes: actual.length,
    },
  };
};

const comparePixels = (
  actual: Uint8Array,
  reference: Uint8Array,
  comparison: Extract<CheckComparison, { mode: 'pixels' }>,
): CheckComparisonResult => {
  const decodedReference = decodePng(reference);
  const decodedActual = decodePng(actual);
  if (
    decodedReference.width !== decodedActual.width ||
    decodedReference.height !== decodedActual.height
  )
    return {
      status: 'differs',
      difference: {
        mode: 'dimensions',
        reference: { width: decodedReference.width, height: decodedReference.height },
        actual: { width: decodedActual.width, height: decodedActual.height },
      },
    };
  const totalPixels = decodedReference.width * decodedReference.height;
  let changedPixels = 0;
  let maxChannelDelta = 0;
  for (let pixel = 0; pixel < totalPixels; pixel += 1) {
    const referenceOffset = pixel * decodedReference.channels;
    const actualOffset = pixel * decodedActual.channels;
    let changed = false;
    for (let channel = 0; channel < 3; channel += 1) {
      const delta = Math.abs(
        pixelChannel(decodedReference.pixels, referenceOffset + channel) -
          pixelChannel(decodedActual.pixels, actualOffset + channel),
      );
      if (delta > maxChannelDelta) maxChannelDelta = delta;
      if (delta > comparison.channelTolerance) changed = true;
    }
    if (changed) changedPixels += 1;
  }
  const changedRatio = totalPixels === 0 ? 0 : changedPixels / totalPixels;
  const status: CheckStatus =
    changedPixels === 0
      ? 'identical'
      : changedRatio <= comparison.maxChangedRatio
        ? 'within-tolerance'
        : 'differs';
  return {
    status,
    difference: { mode: 'pixels', totalPixels, changedPixels, changedRatio, maxChannelDelta },
  };
};

/**
 * Compare decoded pixels unless `exact` was requested; exact mode never decodes the PNGs.
 *
 * This is an invariant API and throws when a capture cannot be decoded (a contract violation).
 * Callers at a boundary that hands user captures in use `compareCaptures`, which converts the
 * exception into a `Result` so nothing throws across the public API.
 */
export const comparePng = (
  actual: Uint8Array,
  reference: Uint8Array,
  comparison: CheckComparison,
): CheckComparisonResult =>
  comparison.mode === 'exact'
    ? compareExact(actual, reference)
    : comparePixels(actual, reference, comparison);

const comparisonFailure = (cause: unknown): Diagnostic => ({
  code: 'internal.unexpected',
  severity: 'error',
  message: 'The checker could not compare two captures.',
  hint: `Report this as a motion-kit bug: a capture was not a decodable PNG (${cause instanceof Error ? cause.message : String(cause)}).`,
});

/** The boundary form of `comparePng`: an undecodable capture becomes `internal.unexpected`. */
export const compareCaptures = (
  actual: Uint8Array,
  reference: Uint8Array,
  comparison: CheckComparison,
): Result<CheckComparisonResult, readonly Diagnostic[]> => {
  try {
    return { ok: true, value: comparePng(actual, reference, comparison) };
  } catch (cause) {
    return { ok: false, error: [comparisonFailure(cause)] };
  }
};
