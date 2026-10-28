/** Exact PNG comparison for the Phase 1 determinism suite.
 * A tolerance is never implied. Callers opt in only for cross-environment runs.
 */

export const requiredDeterminismModes = [
  'sequential-then-n',
  'random',
  'reverse',
  'repeated',
  'fresh-realm',
  'held-session',
  'fresh-renderer',
  'concurrent',
] as const;

export type RequiredDeterminismMode = (typeof requiredDeterminismModes)[number];
export type DeterminismMode = RequiredDeterminismMode | 'sustained-session';

/** Opt-in allowance for §13.5 cross-environment runs. Same-environment calls omit this. */
export type CrossEnvironmentTolerance = {
  readonly purpose: 'cross-environment';
  readonly maxDifferentBytes: number;
};

export type ByteComparison = {
  readonly equal: boolean;
  readonly differentBytes: number;
};

const countDifferentBytes = (actual: Uint8Array, expected: Uint8Array): number => {
  const length = Math.max(actual.length, expected.length);
  let different = 0;
  for (let index = 0; index < length; index += 1) {
    if (actual[index] !== expected[index]) different += 1;
  }
  return different;
};

const buffersEqual = (actual: Uint8Array, expected: Uint8Array): boolean =>
  Buffer.isBuffer(actual) && Buffer.isBuffer(expected)
    ? actual.equals(expected)
    : countDifferentBytes(actual, expected) === 0;

/** Byte identity. `tolerance` is applied only when its purpose is cross-environment. */
export const pngBytesMatch = (
  actual: Uint8Array,
  expected: Uint8Array,
  tolerance?: CrossEnvironmentTolerance,
): ByteComparison => {
  if (
    tolerance === undefined ||
    tolerance.purpose !== 'cross-environment' ||
    !Number.isSafeInteger(tolerance.maxDifferentBytes) ||
    tolerance.maxDifferentBytes < 1
  ) {
    const equal = buffersEqual(actual, expected);
    return { equal, differentBytes: equal ? 0 : countDifferentBytes(actual, expected) };
  }
  const differentBytes = countDifferentBytes(actual, expected);
  return { equal: differentBytes <= tolerance.maxDifferentBytes, differentBytes };
};

const seededUnit = (state: number): number => (Math.imul(1664525, state) + 1013904223) >>> 0;

/** A non-sequential order that visits `focus`, then visits it again. Seeded, not entropic. */
export const randomOrder = (frames: readonly number[], focus: number): readonly number[] => {
  const order = [...frames];
  let state = 160;
  for (let index = order.length - 1; index > 0; index -= 1) {
    state = seededUnit(state);
    const swap = state % (index + 1);
    const current = order[index];
    const other = order[swap];
    if (current === undefined || other === undefined) continue;
    order[index] = other;
    order[swap] = current;
  }
  const ascending = [...frames].sort((left, right) => left - right);
  if (order.every((frame, index) => frame === ascending[index])) order.reverse();
  order.push(focus);
  return order;
};

export const reverseOrder = (focus: number): readonly number[] =>
  Array.from({ length: focus + 1 }, (_, index) => focus - index);

export const repeatedOrder = (focus: number): readonly number[] => [focus, focus, focus];

export const byteMismatchMessage = (
  composition: string,
  mode: DeterminismMode,
  frame: number,
  comparison: ByteComparison,
  actualLength: number,
  expectedLength: number,
): string =>
  comparison.equal
    ? `${composition}/${mode}: frame ${frame} PNG bytes match the sequential 0..N capture`
    : `${composition}/${mode}: frame ${frame} PNG bytes differ from the sequential 0..N capture (${comparison.differentBytes} differing bytes, ${actualLength} vs ${expectedLength})`;
