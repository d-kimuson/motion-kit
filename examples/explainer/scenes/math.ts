// The arithmetic behind the scenes' pictures: compounding under a fee, the units an instalment buys,
// the valleys of a price series. Pure functions of the cue's own numbers, so a label and the shape
// it sits on are computed from one value and cannot disagree, and `math.test.ts` pins every number
// the narration or a label states.

export type Point = { readonly year: number; readonly value: number };

/** `domain` onto `range`, linearly; a reversed range is how an SVG's y axis points up. */
export const linear =
  ([d0, d1]: readonly [number, number], [r0, r1]: readonly [number, number]) =>
  (value: number): number =>
    d1 === d0 ? r0 : r0 + ((value - d0) / (d1 - d0)) * (r1 - r0);

/**
 * A balance at the end of every year from 0 to `years`: grown by `growth`, then charged `fee` on what
 * it holds — the way a trust fee is taken from the fund's assets every year it is held.
 */
export const compound = (
  principal: number,
  growth: number,
  fee: number,
  years: number,
): readonly number[] => {
  const balances = [principal];
  for (let year = 1; year <= years; year += 1)
    balances.push((balances[year - 1] ?? principal) * (1 + growth) * (1 - fee));
  return balances;
};

/** The units one fixed instalment buys at each price: more when the price is low. */
export const unitsBought = (amount: number, prices: readonly number[]): readonly number[] =>
  prices.map((price) => Math.round((amount / price) * 1e6) / 1e6);

/**
 * What one unit cost on average after buying the same amount at every price: the harmonic mean of
 * the prices, which is never above their arithmetic mean.
 */
export const averageCost = (prices: readonly number[]): number =>
  prices.length / prices.reduce((sum, price) => sum + 1 / price, 0);

/** One valley of a price series: the peak before it, its lowest point, and when the peak returned. */
export type Drawdown = {
  readonly peakYear: number;
  readonly peakValue: number;
  readonly troughYear: number;
  readonly troughValue: number;
  /** The fall from the peak to the trough, as a negative fraction. */
  readonly depth: number;
  /** The first year the series closed at or above the peak again; `null` if it never did. */
  readonly recoveryYear: number | null;
};

/** Every valley at least `threshold` deep, in order. */
export const drawdowns = (points: readonly Point[], threshold: number): readonly Drawdown[] => {
  const found: Drawdown[] = [];
  let peak = points[0];
  let trough = points[0];
  const close = (recoveryYear: number | null) => {
    if (peak === undefined || trough === undefined) return;
    const depth = trough.value / peak.value - 1;
    if (-depth >= threshold)
      found.push({
        peakYear: peak.year,
        peakValue: peak.value,
        troughYear: trough.year,
        troughValue: trough.value,
        depth,
        recoveryYear,
      });
  };
  for (const point of points.slice(1)) {
    if (peak === undefined || trough === undefined) break;
    if (point.value >= peak.value) {
      if (trough !== peak) close(point.year);
      peak = point;
      trough = point;
    } else if (point.value < trough.value) trough = point;
  }
  if (peak !== trough) close(null);
  return found;
};

/** One year's change on the year before, as a fraction rounded to a hundredth of a percent. */
export const yearlyChanges = (
  points: readonly Point[],
): readonly { readonly year: number; readonly change: number }[] =>
  points.slice(1).map((point, index) => ({
    year: point.year,
    change: Math.round((point.value / (points[index]?.value ?? point.value) - 1) * 1e4) / 1e4,
  }));

/** A whole number with thousands separators: what every counter on screen prints. */
export const formatInteger = (value: number): string =>
  Math.round(value).toLocaleString('ja-JP', { maximumFractionDigits: 0 });

/** A fraction as a signed percentage: `-0.402` → `−40%`. */
export const formatPercent = (fraction: number, digits = 0): string => {
  const value = (fraction * 100).toFixed(digits);
  return fraction < 0 ? `−${value.slice(1)}%` : `+${value}%`;
};
