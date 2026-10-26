// Everything the chart computes from its data, kept out of the component so the numbers are
// readable on their own: the clip's timing, the two axes, the ticks and the number format. No chart
// library, no `Intl` (ICU data differs between a developer machine and the CI runner, and the
// determinism suite compares PNG bytes), no `Date`, no `Math.random`.

/** One yearly close, exactly the shape the props schema accepts. */
export type ChartPoint = { readonly year: number; readonly value: number };

/** One line on the chart. `points` is at least two long and sorted by year in the committed data. */
export type ChartSeries = { readonly label: string; readonly points: readonly ChartPoint[] };

/** The Composition's whole props object, after the schema's defaults have been applied. */
export type ChartProps = {
  readonly title: string;
  readonly unit: string;
  /** Rendered under the chart; an empty string renders nothing. */
  readonly source: string;
  readonly series: readonly ChartSeries[];
};

/**
 * The clip's timing in whole frames, derived from the Composition's own length, so the full chart,
 * its `-ci` twin and its probe render one scene at three sizes: the line draws on for 3 s, the value
 * label counts up over 1.5 s and then holds for the last 4 s. A shorter clip keeps the shape and
 * scales every phase down (60 frames: 1 s draw, 0.5 s count-up, 0.4 s hold).
 */
export type ChartPlan = {
  readonly drawFrames: number;
  readonly countUpStart: number;
  readonly countUpEnd: number;
  /** How long the axes and gridlines take to appear. */
  readonly fadeFrames: number;
};

export const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

export const easeOutCubic = (progress: number): number => 1 - (1 - clamp01(progress)) ** 3;

const secondsToFrames = (seconds: number, fps: number, frames: number, share: number): number =>
  Math.max(1, Math.min(Math.round(fps * seconds), Math.round(frames * share)));

export const planChart = (durationInFrames: number, fps: number): ChartPlan => {
  const frames = Math.max(1, Math.round(durationInFrames));
  const perSecond = Number.isFinite(fps) && fps > 0 ? fps : 30;
  const drawFrames = secondsToFrames(3, perSecond, frames, 0.5);
  const holdFrames = secondsToFrames(4, perSecond, frames, 0.2);
  const countUpFrames = secondsToFrames(1.5, perSecond, frames, 0.25);
  const countUpEnd = Math.max(drawFrames + 1, frames - holdFrames);
  const countUpStart = Math.max(drawFrames, countUpEnd - countUpFrames);
  const fadeFrames = secondsToFrames(0.3, perSecond, drawFrames, 1);
  return { drawFrames, countUpStart, countUpEnd, fadeFrames };
};

/** The round steps a tick line may take; `2.5` keeps a narrow range from collapsing to two labels. */
const NICE_STEPS = [1, 2, 2.5, 5, 10] as const;

const niceStep = (rough: number): number => {
  if (!Number.isFinite(rough) || rough <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const fraction = rough / magnitude;
  const step = NICE_STEPS.find((candidate) => candidate >= fraction) ?? 10;
  return step * magnitude;
};

/** Decimal places the data actually needs, capped at two so a label never overflows its column. */
export const decimalsOf = (values: readonly number[]): number => {
  let decimals = 0;
  for (const value of values) {
    if (!Number.isFinite(value)) continue;
    const text = Math.abs(value).toString();
    const dot = text.indexOf('.');
    if (dot >= 0) decimals = Math.max(decimals, text.length - dot - 1);
  }
  return Math.min(decimals, 2);
};

export type ValueAxis = {
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly decimals: number;
  readonly ticks: readonly number[];
};

/**
 * The y-axis, computed from the data: a round step that lands near four intervals, a 6% pad so the
 * extremes never touch the frame, and the ticks that fall inside the padded domain. A 30-year series
 * and a 20-year series therefore get their own domain, their own step and their own tick count, and
 * neither is hard-coded.
 */
export const valueAxis = (series: readonly ChartSeries[]): ValueAxis => {
  const values = series.flatMap((item) => item.points.map((point) => point.value));
  const lowest = values.length === 0 ? 0 : Math.min(...values);
  const highest = values.length === 0 ? 1 : Math.max(...values);
  const spread = highest - lowest;
  const step = niceStep(spread === 0 ? Math.max(Math.abs(highest), 1) / 4 : spread / 4);
  const padding = spread === 0 ? step : spread * 0.06;
  const min = Math.floor((lowest - padding) / step) * step;
  const highestTick = Math.ceil((highest + padding) / step) * step;
  const max = highestTick === min ? min + step : highestTick;
  const count = Math.min(12, Math.max(1, Math.round((max - min) / step)));
  const ticks = Array.from({ length: count + 1 }, (_, index) => min + index * step);
  return {
    min,
    max: ticks.at(-1) ?? max,
    step,
    decimals: Math.max(decimalsOf(values), decimalsOf([step])),
    ticks,
  };
};

export type YearAxis = {
  readonly min: number;
  readonly max: number;
  readonly ticks: readonly number[];
};

/** The x-axis: the year range the points span, and as many round-year labels as stay legible. */
export const yearAxis = (series: readonly ChartSeries[]): YearAxis => {
  const years = series.flatMap((item) => item.points.map((point) => point.year));
  const lowest = years.length === 0 ? 2000 : Math.min(...years);
  const highest = years.length === 0 ? 2001 : Math.max(...years);
  const span = Math.max(1, highest - lowest);
  const step = [1, 2, 5, 10].find((candidate) => span / candidate <= 7) ?? 10;
  const first = Math.ceil(lowest / step) * step;
  const ticks: number[] = [];
  for (let year = first; year <= highest; year += step) ticks.push(year);
  if (ticks.length === 0) ticks.push(lowest, highest);
  return { min: lowest, max: lowest + span, ticks };
};

/**
 * A local thousands-grouped number format, deliberately not `Intl.NumberFormat`: ICU data differs
 * between a developer machine and the CI runner, and the determinism suite compares PNG bytes.
 */
export const formatNumber = (value: number, decimals: number): string => {
  const fixed = Math.abs(Number.isFinite(value) ? value : 0).toFixed(decimals);
  const dot = fixed.indexOf('.');
  const whole = dot < 0 ? fixed : fixed.slice(0, dot);
  const fraction = dot < 0 ? '' : fixed.slice(dot);
  let grouped = '';
  for (let index = 0; index < whole.length; index += 1) {
    const fromEnd = whole.length - index;
    grouped += `${whole[index] ?? ''}${fromEnd > 1 && fromEnd % 3 === 1 ? ',' : ''}`;
  }
  return `${value < 0 ? '-' : ''}${grouped}${fraction}`;
};
