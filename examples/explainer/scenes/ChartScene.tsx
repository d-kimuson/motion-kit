// Chapter 3: the long view. Thirty years of a synthetic index draw on; the trend arrow says "up over
// the long run" while the valleys say how deep the falls were, each labelled with the depth
// `math.ts` measures from the data; a short window shows what judging by one stretch looks like.
// Zundamon's line raises the year-by-year bars underneath, the deep falls and the slow years lit.
import { SCENE_BODY, palette } from '../look.ts';
import { enter, popIn, rise, slideIn } from '../motion.ts';
import { dataset, datasetSource } from './datasets.ts';
import {
  at,
  drawOn,
  Footnote,
  Heading,
  pathThrough,
  SceneRoot,
  Tag,
  type SceneProps,
} from './kit.tsx';
import { drawdowns, formatPercent, linear, yearlyChanges } from './math.ts';

const WIDTH = SCENE_BODY.width;
const CHART_HEIGHT = 262;
const STRIP_TOP = 300;
const STRIP_HEIGHT = SCENE_BODY.height - STRIP_TOP;
const AXIS = 64;
const VALLEY_LABEL_WIDTH = 140;

export const ChartScene = ({ cue, clock, chapter }: SceneProps<'chart'>) => {
  const { t } = clock;
  const points = dataset(cue.chartId);
  const first = points[0];
  const last = points.at(-1);
  if (first === undefined || last === undefined) return null;
  const lineAt = clock.at('この線');
  const trendAt = clock.at('右肩上がり');
  const valleyAt = clock.at('深い谷');
  const shortAt = clock.at('短い期間');
  const stripAt = clock.at('値段はずっと');
  const fallsAt = clock.at('大きく下がる年');
  const slowAt = clock.at('ゆっくり上がる年');
  const max = Math.max(...points.map((point) => point.value));
  const x = linear([first.year, last.year], [AXIS + 10, WIDTH - 40]);
  const ceiling = Math.ceil(max / 200) * 200;
  const y = linear([0, ceiling], [CHART_HEIGHT - 28, 12]);
  const grid = Array.from({ length: ceiling / 200 }, (_, index) => index * 200);
  const line = points.map((point) => [x(point.year), y(point.value)] as const);
  const drawn = enter(t, lineAt + 0.2, 3);
  const area = `${pathThrough(line)} L${String(x(last.year))} ${String(y(0))} L${String(x(first.year))} ${String(y(0))} Z`;
  const valleys = drawdowns(points, 0.2);
  const changes = yearlyChanges(points);
  const extreme = Math.max(...changes.map((item) => Math.abs(item.change)));
  const barWidth = (WIDTH - AXIS - 26) / changes.length;
  const barScale = (STRIP_HEIGHT - 40) / 2 / extreme;
  const lit = (change: number): number =>
    change <= -0.15
      ? enter(t, fallsAt, 0.4)
      : change > 0 && change < 0.06
        ? enter(t, slowAt, 0.4)
        : 0;
  const deepest = changes.reduce((low, item) => (item.change < low.change ? item : low));
  // "A short period" is framed around the worst single year, one year either side.
  const short = { from: deepest.year - 1, to: deepest.year + 1 };
  const valleyIn = (index: number): number => valleyAt + 0.2 + index * 0.4;
  // A valley's depth sits on the axis row under its trough, so the year it would cover fades out.
  const yearOpacity = (year: number): number =>
    valleys.reduce(
      (opacity, valley, index) =>
        Math.abs(x(year) - x(valley.troughYear)) < VALLEY_LABEL_WIDTH / 2 + 30
          ? opacity * (1 - enter(t, valleyIn(index), 0.3))
          : opacity,
      enter(t, 0.4, 0.5),
    );
  return (
    <SceneRoot>
      <Heading
        chapter={chapter}
        title={cue.title}
        t={t}
        note={
          <div
            style={{
              ...rise(t, valleyAt + 1, 12),
              fontSize: 22,
              color: palette.muted,
              fontWeight: 700,
            }}
          >
            {cue.caption}
          </div>
        }
      />
      <svg
        style={at(SCENE_BODY.left, SCENE_BODY.top, WIDTH, CHART_HEIGHT + 30)}
        width={WIDTH}
        height={CHART_HEIGHT + 30}
      >
        <defs>
          <linearGradient id="chart-area" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor={palette.sky} stopOpacity={0.35} />
            <stop offset="1" stopColor={palette.sky} stopOpacity={0} />
          </linearGradient>
        </defs>
        {grid.map((value) => (
          <g key={`grid-${String(value)}`} opacity={enter(t, 0.3, 0.5)}>
            <line
              x1={AXIS}
              x2={WIDTH}
              y1={y(value)}
              y2={y(value)}
              stroke="rgba(255,255,255,0.07)"
              strokeWidth={2}
            />
            <text
              x={AXIS - 12}
              y={y(value) + 7}
              fill={palette.muted}
              fontSize={20}
              textAnchor="end"
            >
              {value}
            </text>
          </g>
        ))}
        {points
          .filter((point) => point.year % 5 === 0 || point === last)
          .map((point) => (
            <text
              key={`year-${String(point.year)}`}
              x={x(point.year)}
              y={CHART_HEIGHT + 4}
              fill={palette.muted}
              fontSize={20}
              textAnchor="middle"
              opacity={yearOpacity(point.year)}
            >
              {point.year}
            </text>
          ))}
        {valleys.map((valley, index) => (
          <rect
            key={`band-${String(valley.peakYear)}`}
            x={x(valley.peakYear)}
            y={12}
            width={x(valley.troughYear) - x(valley.peakYear)}
            height={CHART_HEIGHT - 40}
            fill={palette.coral}
            opacity={0.14 * enter(t, valleyAt + index * 0.4, 0.5)}
          />
        ))}
        <path d={area} fill="url(#chart-area)" opacity={enter(t, lineAt + 2.6, 0.8)} />
        <path
          d={pathThrough(line)}
          fill="none"
          stroke={palette.sky}
          strokeWidth={6}
          strokeLinecap="round"
          strokeLinejoin="round"
          {...drawOn(drawn)}
        />
        <line
          x1={x(first.year)}
          y1={y(first.value) - 24}
          x2={x(last.year) - 12}
          y2={y(last.value) - 30}
          stroke={palette.mint}
          strokeWidth={4}
          strokeDasharray="12 10"
          opacity={enter(t, trendAt, 0.6)}
        />
        <polygon
          points={`${String(x(last.year) - 4)},${String(y(last.value) - 32)} ${String(x(last.year) - 26)},${String(y(last.value) - 40)} ${String(x(last.year) - 22)},${String(y(last.value) - 18)}`}
          fill={palette.mint}
          opacity={enter(t, trendAt + 0.4, 0.4)}
        />
        <rect
          x={x(short.from) - 14}
          y={8}
          width={x(short.to) - x(short.from) + 28}
          height={CHART_HEIGHT - 32}
          rx={14}
          fill="none"
          stroke={palette.gold}
          strokeWidth={3}
          strokeDasharray="8 8"
          opacity={enter(t, shortAt, 0.4)}
        />
      </svg>
      {valleys.map((valley, index) => (
        <div
          key={`valley-${String(valley.peakYear)}`}
          style={{
            ...at(
              SCENE_BODY.left + x(valley.troughYear) - VALLEY_LABEL_WIDTH / 2,
              SCENE_BODY.top + CHART_HEIGHT - 30,
              VALLEY_LABEL_WIDTH,
              50,
            ),
            display: 'flex',
            justifyContent: 'center',
            ...popIn(t, valleyIn(index), 0.4),
          }}
        >
          <Tag color={palette.coral} size={26}>
            {formatPercent(valley.depth)}
          </Tag>
        </div>
      ))}
      <div
        style={{
          ...at(SCENE_BODY.left + x(first.year), SCENE_BODY.top - 6, 360, 44),
          ...slideIn(t, trendAt + 0.2, 20),
        }}
      >
        <Tag color={palette.mint} size={22}>
          長い目で見ると右肩上がり
        </Tag>
      </div>
      <div
        style={{
          ...at(SCENE_BODY.left + x(short.to) + 24, SCENE_BODY.top + 186, 260, 44),
          ...slideIn(t, shortAt + 0.2, 20),
        }}
      >
        <Tag color={palette.gold} size={22}>
          短い期間だけで判断しない
        </Tag>
      </div>
      <div
        style={{
          ...at(SCENE_BODY.left, SCENE_BODY.top + STRIP_TOP, WIDTH, STRIP_HEIGHT),
          ...rise(t, stripAt, 24),
        }}
      >
        <div
          style={{
            ...at(0, 0, AXIS + 120, 30),
            fontSize: 20,
            color: palette.muted,
            fontWeight: 700,
          }}
        >
          毎年の上下
        </div>
        <svg width={WIDTH} height={STRIP_HEIGHT} style={{ position: 'absolute', inset: 0 }}>
          <line
            x1={AXIS}
            x2={WIDTH}
            y1={STRIP_HEIGHT / 2 + 8}
            y2={STRIP_HEIGHT / 2 + 8}
            stroke="rgba(255,255,255,0.18)"
            strokeWidth={2}
          />
          {changes.map((item, index) => {
            const grow = enter(t, stripAt + 0.2 + index * 0.04, 0.4);
            const height = Math.abs(item.change) * barScale * grow;
            const centre = STRIP_HEIGHT / 2 + 8;
            const glow = lit(item.change);
            return (
              <rect
                key={`bar-${String(item.year)}`}
                x={AXIS + 6 + index * barWidth}
                y={item.change >= 0 ? centre - height : centre}
                width={barWidth - 8}
                height={Math.max(0, height)}
                rx={4}
                fill={item.change >= 0 ? palette.mint : palette.coral}
                opacity={0.45 + 0.55 * Math.max(glow, fallsAt > t && slowAt > t ? 1 : 0)}
                stroke={glow > 0 ? palette.gold : 'none'}
                strokeWidth={glow * 3}
              />
            );
          })}
        </svg>
        <div
          style={{
            ...at(
              AXIS + 6 + changes.indexOf(deepest) * barWidth - 50,
              STRIP_HEIGHT / 2 + 12 + Math.abs(deepest.change) * barScale - 40,
              100,
              40,
            ),
            display: 'flex',
            justifyContent: 'center',
            ...popIn(t, fallsAt + 0.2, 0.5),
          }}
        >
          <Tag color={palette.coral} size={20}>
            {`${String(deepest.year)}年 ${formatPercent(deepest.change)}`}
          </Tag>
        </div>
      </div>
      <Footnote>{datasetSource}</Footnote>
    </SceneRoot>
  );
};
