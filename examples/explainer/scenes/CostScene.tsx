// Chapter 4: cost. The two fee levels sit on the left, with thirty dots for the thirty years they
// are charged; on the right the same principal compounds under each fee, and when Zundamon says the
// cheaper one keeps more, the gap between the two totals is bracketed. Every number is `compound`'s,
// from the cue, and the footnote says it is an illustration.
import { type CSSProperties } from 'react';

import { SCENE_BODY, palette } from '../look.ts';
import { enter, popIn, rise, slideIn } from '../motion.ts';
import {
  at,
  cardStyle,
  drawOn,
  Footnote,
  Heading,
  pathThrough,
  SceneRoot,
  Tag,
  type SceneProps,
} from './kit.tsx';
import { compound, formatInteger, linear } from './math.ts';

const COLUMN = 360;
const CHART_LEFT = SCENE_BODY.left + COLUMN + 48;
const CHART_WIDTH = SCENE_BODY.left + SCENE_BODY.width - CHART_LEFT;
const CHART_HEIGHT = SCENE_BODY.height;

const percent = (fee: number): string => `${(fee * 100).toFixed(1)}%`;
const man = (value: number): string => `約${formatInteger(value)}万円`;

const FeeCard = ({
  top,
  label,
  fee,
  color,
  style,
}: {
  readonly top: number;
  readonly label: string;
  readonly fee: number;
  readonly color: string;
  readonly style: CSSProperties;
}) => (
  <div
    style={{
      ...at(SCENE_BODY.left, top, COLUMN, 140),
      ...cardStyle(color),
      ...style,
      padding: '18px 28px',
    }}
  >
    <div style={{ fontSize: 24, fontWeight: 700, color: palette.muted }}>{label}</div>
    <div style={{ fontSize: 64, fontWeight: 900, color, lineHeight: 1.15 }}>
      <span style={{ fontSize: 32, marginRight: 8 }}>年</span>
      {percent(fee)}
    </div>
  </div>
);

export const CostScene = ({ cue, clock, chapter }: SceneProps<'cost'>) => {
  const { t } = clock;
  const feeAt = clock.at('信託報酬');
  const growAt = clock.at('何年も積み重なって');
  const gapAt = clock.at('コストが低いほう');
  const low = compound(cue.principal, cue.growth, cue.fees.low, cue.years);
  const high = compound(cue.principal, cue.growth, cue.fees.high, cue.years);
  const lowEnd = low.at(-1) ?? cue.principal;
  const highEnd = high.at(-1) ?? cue.principal;
  const top = Math.ceil(lowEnd / 100) * 100;
  const x = linear([0, cue.years], [70, CHART_WIDTH - 210]);
  const y = linear([0, top], [CHART_HEIGHT - 40, 16]);
  const drawn = enter(t, growAt, 3.2);
  const lowLine = low.map((value, year) => [x(year), y(value)] as const);
  const highLine = high.map((value, year) => [x(year), y(value)] as const);
  const charged = enter(t, feeAt + 0.6, 2);
  return (
    <SceneRoot>
      <Heading chapter={chapter} title={cue.title} t={t} />
      <div
        style={{
          ...at(SCENE_BODY.left, SCENE_BODY.top, COLUMN, 30),
          ...rise(t, feeAt, 16),
          fontSize: 24,
          fontWeight: 900,
          whiteSpace: 'nowrap',
        }}
      >
        信託報酬
        <span style={{ color: palette.muted, fontWeight: 700, fontSize: 20 }}>
          （持っているあいだ毎年）
        </span>
      </div>
      <FeeCard
        top={SCENE_BODY.top + 46}
        label="コストが低い"
        fee={cue.fees.low}
        color={palette.mint}
        style={slideIn(t, feeAt + 0.2, 40)}
      />
      <FeeCard
        top={SCENE_BODY.top + 202}
        label="コストが高い"
        fee={cue.fees.high}
        color={palette.coral}
        style={slideIn(t, feeAt + 0.45, 40)}
      />
      <div
        style={{
          ...at(SCENE_BODY.left, SCENE_BODY.top + 362, COLUMN, 80),
          opacity: enter(t, feeAt + 0.6, 0.4),
        }}
      >
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, width: COLUMN }}>
          {Array.from({ length: cue.years }, (_, year) => (
            <div
              key={`year-${String(year)}`}
              style={{
                width: 8,
                height: 22,
                borderRadius: 3,
                background: year < charged * cue.years ? palette.gold : 'rgba(255,255,255,0.12)',
              }}
            />
          ))}
        </div>
        <div style={{ fontSize: 22, fontWeight: 700, color: palette.muted, marginTop: 8 }}>
          {`${String(cue.years)}年間、毎年かかり続ける`}
        </div>
      </div>
      <svg
        style={{
          ...at(CHART_LEFT, SCENE_BODY.top, CHART_WIDTH, CHART_HEIGHT),
          ...rise(t, growAt - 0.3, 20),
        }}
        width={CHART_WIDTH}
        height={CHART_HEIGHT}
      >
        {Array.from({ length: top / 100 + 1 }, (_, step) => step * 100).map((value) => (
          <g key={`grid-${String(value)}`}>
            <line
              x1={70}
              x2={CHART_WIDTH - 200}
              y1={y(value)}
              y2={y(value)}
              stroke="rgba(255,255,255,0.07)"
              strokeWidth={2}
            />
            <text x={58} y={y(value) + 7} fill={palette.muted} fontSize={19} textAnchor="end">
              {value}
            </text>
          </g>
        ))}
        {[0, 10, 20, 30]
          .filter((year) => year <= cue.years)
          .map((year) => (
            <text
              key={`x-${String(year)}`}
              x={x(year)}
              y={CHART_HEIGHT - 8}
              fill={palette.muted}
              fontSize={20}
              textAnchor="middle"
            >
              {`${String(year)}年`}
            </text>
          ))}
        <path
          d={pathThrough(highLine)}
          fill="none"
          stroke={palette.coral}
          strokeWidth={6}
          strokeLinecap="round"
          strokeLinejoin="round"
          {...drawOn(drawn)}
        />
        <path
          d={pathThrough(lowLine)}
          fill="none"
          stroke={palette.mint}
          strokeWidth={6}
          strokeLinecap="round"
          strokeLinejoin="round"
          {...drawOn(drawn)}
        />
        <circle cx={x(0)} cy={y(cue.principal)} r={9} fill={palette.text} />
        <line
          x1={x(cue.years) + 26}
          x2={x(cue.years) + 26}
          y1={y(lowEnd)}
          y2={y(lowEnd) + (y(highEnd) - y(lowEnd)) * enter(t, gapAt, 0.6)}
          stroke={palette.gold}
          strokeWidth={5}
          strokeLinecap="round"
        />
      </svg>
      <div
        style={{
          ...at(CHART_LEFT + x(0) - 10, SCENE_BODY.top + y(cue.principal) + 14, 200, 40),
          ...rise(t, growAt, 10),
          fontSize: 22,
          fontWeight: 900,
        }}
      >
        {`${formatInteger(cue.principal)}万円から`}
      </div>
      <div
        style={{
          ...at(CHART_LEFT + x(cue.years) + 44, SCENE_BODY.top + y(lowEnd) - 24, 170, 48),
          ...popIn(t, growAt + 3.2, 0.6),
        }}
      >
        <Tag color={palette.mint} size={24}>
          {man(lowEnd)}
        </Tag>
      </div>
      <div
        style={{
          ...at(CHART_LEFT + x(cue.years) + 44, SCENE_BODY.top + y(highEnd) - 24, 170, 48),
          ...popIn(t, growAt + 3.4, 0.6),
        }}
      >
        <Tag color={palette.coral} size={24}>
          {man(highEnd)}
        </Tag>
      </div>
      <div
        style={{
          ...at(
            CHART_LEFT + x(cue.years) - 260,
            SCENE_BODY.top + (y(lowEnd) + y(highEnd)) / 2 - 34,
            260,
            68,
          ),
          display: 'flex',
          justifyContent: 'flex-end',
          ...popIn(t, gapAt + 0.4, 0.5),
        }}
      >
        <Tag
          color={palette.gold}
          size={32}
          style={{ boxShadow: '0 10px 30px rgba(255,209,102,0.35)' }}
        >
          {`差 ${man(lowEnd - highEnd)}`}
        </Tag>
      </div>
      <Footnote style={{ opacity: enter(t, feeAt, 0.5) }}>{cue.note}</Footnote>
    </SceneRoot>
  );
};
