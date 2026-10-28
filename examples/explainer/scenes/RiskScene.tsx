// Chapter 6: the risks. The series' first deep valley is drawn close up, and each warning is stacked
// beside it as the narration names it: the fall from the peak, the years spent under the old peak
// (measured by `drawdowns`), and the stamp on the bottom that selling there makes the loss real.
import { SCENE_BODY, palette } from '../look.ts';
import { enter, popIn, slideIn, springStep } from '../motion.ts';
import { dataset } from './datasets.ts';
import {
  at,
  cardStyle,
  drawOn,
  Heading,
  pathThrough,
  SceneRoot,
  Tag,
  type SceneProps,
} from './kit.tsx';
import { drawdowns, formatPercent, linear } from './math.ts';

const CHART_WIDTH = 600;
const WARNINGS_LEFT = SCENE_BODY.left + CHART_WIDTH + 40;
const WARNINGS_WIDTH = SCENE_BODY.left + SCENE_BODY.width - WARNINGS_LEFT;
const HEIGHT = SCENE_BODY.height;

export const RiskScene = ({ cue, clock, chapter }: SceneProps<'risk'>) => {
  const { t } = clock;
  const all = dataset(cue.chartId);
  const valley = drawdowns(all, 0.2)[0];
  if (valley === undefined) return null;
  const end = (valley.recoveryYear ?? valley.troughYear) + 2;
  const points = all.filter((point) => point.year <= end);
  const first = points[0];
  const last = points.at(-1);
  if (first === undefined || last === undefined) return null;
  const warnAt = [clock.at('元本は保証されません'), clock.at('大きく下がる'), clock.at('何年も')];
  const sellAt = clock.at('途中で売って');
  const x = linear([first.year, last.year], [24, CHART_WIDTH - 24]);
  const y = linear([0, Math.ceil(valley.peakValue / 100) * 100 + 60], [HEIGHT - 40, 20]);
  const line = points.map((point) => [x(point.year), y(point.value)] as const);
  const lineAt = warnAt[0] ?? 0;
  const fallAt = warnAt[1] ?? 0;
  const waterAt = warnAt[2] ?? 0;
  const recovered = valley.recoveryYear ?? last.year;
  const underwater = points.filter(
    (point) => point.year >= valley.peakYear && point.year <= recovered,
  );
  const water = `${pathThrough(underwater.map((point) => [x(point.year), y(Math.min(point.value, valley.peakValue))] as const))} L${String(x(recovered))} ${String(y(valley.peakValue))} L${String(x(valley.peakYear))} ${String(y(valley.peakValue))} Z`;
  const stamp = springStep(t - sellAt, 0.5, 13);
  return (
    <SceneRoot>
      <Heading chapter={chapter} title={cue.title} t={t} />
      <svg
        style={at(SCENE_BODY.left, SCENE_BODY.top, CHART_WIDTH, HEIGHT)}
        width={CHART_WIDTH}
        height={HEIGHT}
      >
        <rect
          x={0}
          y={0}
          width={CHART_WIDTH}
          height={HEIGHT}
          rx={24}
          fill="rgba(255,255,255,0.04)"
        />
        <path d={water} fill={palette.coral} opacity={0.22 * enter(t, waterAt, 0.6)} />
        <line
          x1={x(valley.peakYear)}
          x2={x(valley.peakYear) + (x(recovered) - x(valley.peakYear)) * enter(t, waterAt + 0.2, 1)}
          y1={y(valley.peakValue)}
          y2={y(valley.peakValue)}
          stroke={palette.gold}
          strokeWidth={3}
          strokeDasharray="10 8"
        />
        <path
          d={pathThrough(line)}
          fill="none"
          stroke={palette.sky}
          strokeWidth={6}
          strokeLinecap="round"
          strokeLinejoin="round"
          {...drawOn(enter(t, lineAt, 2.4))}
        />
        <line
          x1={x(valley.troughYear)}
          x2={x(valley.troughYear)}
          y1={y(valley.peakValue)}
          y2={
            y(valley.peakValue) +
            (y(valley.troughValue) - y(valley.peakValue)) * enter(t, fallAt + 0.2, 0.6)
          }
          stroke={palette.coral}
          strokeWidth={5}
          strokeLinecap="round"
        />
        <circle
          cx={x(valley.troughYear)}
          cy={y(valley.troughValue)}
          r={11}
          fill={palette.coral}
          opacity={enter(t, fallAt + 0.6, 0.2)}
        />
        {points
          .filter((point) => point.year % 5 === 0)
          .map((point) => (
            <text
              key={`year-${String(point.year)}`}
              x={x(point.year)}
              y={HEIGHT - 12}
              fill={palette.muted}
              fontSize={20}
              textAnchor="middle"
            >
              {point.year}
            </text>
          ))}
      </svg>
      <div
        style={{
          ...at(
            SCENE_BODY.left + x(valley.troughYear) + 18,
            SCENE_BODY.top + (y(valley.peakValue) + y(valley.troughValue)) / 2 - 24,
            140,
            48,
          ),
          ...popIn(t, fallAt + 0.5, 0.5),
        }}
      >
        <Tag color={palette.coral} size={28}>
          {formatPercent(valley.depth)}
        </Tag>
      </div>
      <div
        style={{
          ...at(
            SCENE_BODY.left + (x(valley.peakYear) + x(recovered)) / 2 - 130,
            SCENE_BODY.top + y(valley.peakValue) - 62,
            260,
            48,
          ),
          display: 'flex',
          justifyContent: 'center',
          ...popIn(t, waterAt + 0.8, 0.5),
        }}
      >
        <Tag color={palette.gold} size={26}>
          {`もとに戻るまで ${String(recovered - valley.peakYear)}年`}
        </Tag>
      </div>
      <div
        style={{
          ...at(
            SCENE_BODY.left + x(valley.troughYear) - 110,
            SCENE_BODY.top + y(valley.troughValue) + 22,
            220,
            76,
          ),
          opacity: enter(t, sellAt, 0.12),
          transform: `rotate(-9deg) scale(${String(1.8 - 0.8 * stamp)})`,
          border: `5px double ${palette.coral}`,
          borderRadius: 14,
          color: palette.coral,
          background: 'rgba(10,19,34,0.85)',
          fontSize: 36,
          fontWeight: 900,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          letterSpacing: '0.08em',
        }}
      >
        損が確定
      </div>
      {cue.warnings.map((warning, index) => (
        <div
          key={warning}
          style={{
            ...at(WARNINGS_LEFT, SCENE_BODY.top + index * 152, WARNINGS_WIDTH, 128),
            ...cardStyle('rgba(255,107,107,0.45)'),
            ...slideIn(t, warnAt[index] ?? 0, -40),
            display: 'flex',
            alignItems: 'center',
            gap: 22,
            padding: '0 28px',
          }}
        >
          <div
            style={{
              width: 52,
              height: 52,
              flex: 'none',
              borderRadius: 26,
              background: palette.coral,
              color: palette.groundTop,
              fontSize: 34,
              fontWeight: 900,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            !
          </div>
          <div style={{ fontSize: 28, fontWeight: 900, lineHeight: 1.3, whiteSpace: 'nowrap' }}>
            {warning}
          </div>
        </div>
      ))}
    </SceneRoot>
  );
};
