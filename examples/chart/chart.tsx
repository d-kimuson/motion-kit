import { useFrame, useTimeline } from '@kimuson/motion-kit';

import {
  clamp01,
  easeOutCubic,
  formatNumber,
  planChart,
  valueAxis,
  yearAxis,
  type ChartPoint,
  type ChartProps,
  type ChartSeries,
} from './scale.ts';

// One light ground, one ink, one accent per series. Phase 2 replaces these with /theme tokens; the
// tree below does not change.
const GROUND = '#faf7f2';
const INK = '#14161c';
const MUTED = '#6f6f77';
const GRID = '#e2ddd4';
const SERIES_COLORS = ['#c2410c', '#1d4ed8', '#0f766e'] as const;
const FONT_STACK =
  "'Helvetica Neue', Helvetica, Arial, 'Liberation Sans', 'DejaVu Sans', sans-serif";

const seriesColor = (index: number): string => SERIES_COLORS[index % SERIES_COLORS.length] ?? INK;

/** Every length this chart hands to the rasteriser is a whole pixel, and every font size a whole
 * size. Chromium antialiases a subpixel edge with a coverage value it recomputes per paint, and the
 * determinism suite compares PNG bytes: integer geometry is what makes one frame one file. */
const px = (value: number): number => Math.round(value);

/** The drawn part of one line: every point the draw has passed, plus the interpolated head. A
 * growing clip path would draw the same thing, but a clip is a mask the compositor rasterises on
 * its own path, so the head is computed here instead of clipped. */
const drawnPolyline = (
  points: readonly ChartPoint[],
  head: number,
  xOf: (year: number) => number,
  yOf: (value: number) => number,
): string => {
  const parts: string[] = [];
  for (const [index, point] of points.entries()) {
    if (index <= head) {
      parts.push(`${px(xOf(point.year))},${px(yOf(point.value))}`);
      continue;
    }
    const back = points[index - 1];
    if (back !== undefined) {
      const ratio = head - (index - 1);
      const year = back.year + (point.year - back.year) * ratio;
      const value = back.value + (point.value - back.value) * ratio;
      parts.push(`${px(xOf(year))},${px(yOf(value))}`);
    }
    break;
  }
  return parts.join(' ');
};

const lastPointOf = (series: readonly ChartSeries[]): ChartPoint | undefined =>
  series[0]?.points.at(-1);

/**
 * The chart. `chart`, `chart-ci` and `chart-probe` all render this component — only the props (the
 * data) and the Composition's duration differ. Every position and font size is a fraction of
 * `useTimeline().width/height`, and the axes come from the data, so the same tree fills 1920x1080,
 * 960x540 and 480x270 the same way and draws a 1995-2024 series and a 2005-2024 series on the same
 * layout with a different shape.
 */
export const ChartScene = ({ title, unit, source, series }: ChartProps) => {
  const frame = useFrame();
  const { width, height, frameRate, durationInFrames } = useTimeline();
  const fps = Number(frameRate.numerator) / Number(frameRate.denominator);
  const plan = planChart(durationInFrames, fps);
  const values = valueAxis(series);
  const years = yearAxis(series);

  // The plot box, in fractions of the frame: a left margin for the y labels, a top band for the
  // title, the legend and the unit, and a bottom band for the year labels and the source line.
  const left = px(width * 0.105);
  const right = px(width * 0.955);
  const top = px(height * 0.235);
  const bottom = px(height * 0.815);
  const plotWidth = Math.max(1, right - left);
  const plotHeight = Math.max(1, bottom - top);

  const xOf = (year: number): number =>
    left + ((year - years.min) / Math.max(1, years.max - years.min)) * plotWidth;
  const yOf = (value: number): number =>
    bottom - ((value - values.min) / Math.max(1, values.max - values.min)) * plotHeight;

  const drawProgress = clamp01(frame / plan.drawFrames);
  const entrance = clamp01(frame / plan.fadeFrames);

  const markerRadius = Math.max(2, px(height * 0.0062));
  const lineWidth = Math.max(1, px(height * 0.0035));
  const titleSize = px(height * 0.045);
  const legendSize = px(height * 0.026);
  const unitSize = px(height * 0.024);
  const tickSize = px(height * 0.024);
  const valueSize = px(height * 0.052);
  const sourceSize = px(height * 0.0222);
  // Axis-aligned strokes are two device pixels wide at an integer coordinate, which covers whole
  // pixels exactly: no antialiased half-covered column is left for a second paint to disagree about.
  const axisWidth = Math.max(2, 2 * px(height * 0.001));
  const gridWidth = Math.max(2, 2 * px(height * 0.0014));

  const finalPoint = lastPointOf(series);
  const countUpSpan = Math.max(1, plan.countUpEnd - plan.countUpStart);
  const countUp = clamp01((frame - plan.countUpStart) / countUpSpan);
  const countedValue = (finalPoint?.value ?? 0) * easeOutCubic(countUp);
  const valueOpacity = clamp01((frame - plan.countUpStart) / 4);

  // One legend row above the plot. The label widths are estimated from the glyph count rather than
  // measured, so the layout is a pure function of the data.
  const swatchWidth = Math.max(2, px(width * 0.016));
  const legendGap = px(width * 0.008);
  const legend: { label: string; color: string; x: number; y: number; swatchWidth: number }[] = [];
  let legendCursor = left;
  for (const [index, item] of series.entries()) {
    legend.push({
      label: item.label,
      color: seriesColor(index),
      x: legendCursor,
      y: px(height * 0.16),
      swatchWidth,
    });
    legendCursor +=
      swatchWidth + legendGap + item.label.length * legendSize * 0.52 + px(width * 0.028);
  }

  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', background: GROUND }}>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
        <text
          x={left}
          y={px(height * 0.105)}
          fill={INK}
          fontFamily={FONT_STACK}
          fontSize={titleSize}
          fontWeight={700}
        >
          {title}
        </text>

        {legend.map((item) => (
          <g key={`legend-${item.label}`} opacity={entrance}>
            <rect
              x={item.x}
              y={px(item.y - legendSize * 0.32)}
              width={item.swatchWidth}
              height={Math.max(2, px(legendSize * 0.26))}
              fill={item.color}
            />
            <text
              x={item.x + item.swatchWidth + legendGap}
              y={item.y}
              fill={MUTED}
              fontFamily={FONT_STACK}
              fontSize={legendSize}
              fontWeight={500}
            >
              {item.label}
            </text>
          </g>
        ))}

        <g opacity={entrance}>
          <text
            x={left}
            y={px(top - height * 0.035)}
            fill={MUTED}
            fontFamily={FONT_STACK}
            fontSize={unitSize}
            fontWeight={500}
          >
            {unit}
          </text>
          {values.ticks.map((tick) => (
            <g key={`y-${String(tick)}`}>
              <rect
                x={left}
                y={px(yOf(tick)) - gridWidth / 2}
                width={plotWidth}
                height={gridWidth}
                fill={GRID}
              />
              <text
                x={px(left - width * 0.014)}
                y={px(yOf(tick) + tickSize * 0.35)}
                fill={MUTED}
                fontFamily={FONT_STACK}
                fontSize={tickSize}
                textAnchor="end"
              >
                {formatNumber(tick, values.decimals)}
              </text>
            </g>
          ))}
          <rect x={left - axisWidth / 2} y={top} width={axisWidth} height={plotHeight} fill={INK} />
          <rect
            x={left}
            y={bottom - axisWidth / 2}
            width={plotWidth + axisWidth / 2}
            height={axisWidth}
            fill={INK}
          />
          {years.ticks.map((tick) => (
            <g key={`x-${String(tick)}`}>
              <rect
                x={px(xOf(tick)) - axisWidth / 2}
                y={bottom}
                width={axisWidth}
                height={px(bottom + height * 0.012) - bottom}
                fill={INK}
              />
              <text
                x={px(xOf(tick))}
                y={px(bottom + height * 0.048)}
                fill={MUTED}
                fontFamily={FONT_STACK}
                fontSize={tickSize}
                textAnchor="middle"
              >
                {String(tick)}
              </text>
            </g>
          ))}
        </g>

        {series.map((item, index) => {
          const head = drawProgress * Math.max(1, item.points.length - 1);
          return (
            <g key={`series-${item.label}`}>
              <polyline
                points={drawnPolyline(item.points, head, xOf, yOf)}
                fill="none"
                stroke={seriesColor(index)}
                strokeWidth={lineWidth}
                strokeLinecap="round"
                strokeLinejoin="round"
                shapeRendering="crispEdges"
              />
              {item.points.map((point, pointIndex) => {
                // A marker pops in as the draw reaches its year: the radius and the opacity carry
                // the arrival, and a marker the draw has not reached is not rendered at all.
                const revealed = clamp01(head - pointIndex + 1);
                if (revealed <= 0) return null;
                return (
                  <circle
                    key={`point-${item.label}-${String(point.year)}`}
                    cx={px(xOf(point.year))}
                    cy={px(yOf(point.value))}
                    r={markerRadius * (0.45 + 0.55 * easeOutCubic(revealed))}
                    fill={GROUND}
                    stroke={seriesColor(index)}
                    strokeWidth={Math.max(1, lineWidth * 0.75)}
                    opacity={clamp01(revealed * 1.6)}
                  />
                );
              })}
            </g>
          );
        })}

        {finalPoint === undefined ? null : (
          <text
            x={px(xOf(finalPoint.year) - width * 0.012)}
            y={px(yOf(finalPoint.value) - height * 0.03)}
            fill={seriesColor(0)}
            fontFamily={FONT_STACK}
            fontSize={valueSize}
            fontWeight={700}
            textAnchor="end"
            opacity={valueOpacity}
          >
            {formatNumber(countedValue, values.decimals)}
          </text>
        )}

        {source === '' ? null : (
          <text
            x={left}
            y={px(height * 0.955)}
            fill={MUTED}
            fontFamily={FONT_STACK}
            fontSize={sourceSize}
          >
            {source}
          </text>
        )}
      </svg>
    </div>
  );
};
