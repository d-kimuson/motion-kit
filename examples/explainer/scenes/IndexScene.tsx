// Chapter 1: what an index is. Many stocks' tiles flicker on the left, one line sums them on the
// right and the constituent count runs up as Metan names it; then the tiles give way to two lines
// that move together — the index and the fund built to follow it — and the takeaway stamps in.
import { SCENE_BODY, hash01, palette } from '../look.ts';
import { countUp, enter, leave, popIn, rise, slideIn } from '../motion.ts';
import {
  at,
  cardStyle,
  Check,
  drawOn,
  Heading,
  pathThrough,
  SceneRoot,
  Tag,
  type SceneProps,
} from './kit.tsx';
import { formatInteger, linear } from './math.ts';

const TILE = 22;
const GAP = 6;
const tileColors = [palette.sky, palette.mint, '#7aa2ff', '#b28dff'] as const;

/** A gently rising, noisy series: what "the index" looks like, without being any real one. */
const indexSeries = Array.from(
  { length: 40 },
  (_, index) => 100 + index * 2.2 + 14 * Math.sin(index * 0.55) + 7 * Math.sin(index * 1.9),
);

const Tiles = ({ count, t }: { readonly count: number; readonly t: number }) => {
  const side = Math.ceil(Math.sqrt(count));
  return (
    <div style={at(SCENE_BODY.left, SCENE_BODY.top + 16, side * (TILE + GAP), side * (TILE + GAP))}>
      {Array.from({ length: count }, (_, index) => {
        const row = Math.floor(index / side);
        const column = index % side;
        const seed = hash01(index);
        const arrive = enter(t, 0.2 + (row + column) * 0.035, 0.35);
        const flicker = 0.62 + 0.38 * Math.sin(t * (1.6 + seed * 2.4) + seed * 6.28);
        return (
          <div
            key={`tile-${String(index)}`}
            style={at(column * (TILE + GAP), row * (TILE + GAP), TILE, TILE, {
              borderRadius: 6,
              background: tileColors[Math.floor(seed * tileColors.length)] ?? palette.sky,
              opacity: arrive * flicker,
              transform: `scale(${String(0.4 + 0.6 * arrive)})`,
            })}
          />
        );
      })}
    </div>
  );
};

const TrackingChart = ({
  t,
  from,
  indexLabel,
  fundLabel,
}: {
  readonly t: number;
  readonly from: number;
  readonly indexLabel: string;
  readonly fundLabel: string;
}) => {
  const width = SCENE_BODY.width;
  const height = 360;
  const x = linear([0, indexSeries.length - 1], [24, width - 24]);
  const y = linear([80, 200], [height - 20, 20]);
  const index = indexSeries.map((value, step) => [x(step), y(value)] as const);
  const fund = indexSeries.map((value, step) => [x(step), y(value * 0.985 - 1.5)] as const);
  return (
    <div
      style={{
        ...at(SCENE_BODY.left, SCENE_BODY.top + 14, width, height + 70),
        ...rise(t, from, 30),
      }}
    >
      <div style={{ display: 'flex', gap: 18, marginBottom: 14 }}>
        <Tag color={palette.sky} size={24} style={slideIn(t, from + 0.1, 24)}>
          指数（{indexLabel}）
        </Tag>
        <Tag color={palette.gold} size={24} style={slideIn(t, from + 0.5, 24)}>
          {fundLabel}
        </Tag>
      </div>
      <svg width={width} height={height}>
        {[0, 1, 2, 3].map((row) => (
          <line
            key={`grid-${String(row)}`}
            x1={0}
            x2={width}
            y1={20 + (row * (height - 40)) / 3}
            y2={20 + (row * (height - 40)) / 3}
            stroke="rgba(255,255,255,0.07)"
            strokeWidth={2}
          />
        ))}
        <path
          d={pathThrough(index)}
          fill="none"
          stroke={palette.sky}
          strokeWidth={7}
          strokeLinecap="round"
          strokeLinejoin="round"
          {...drawOn(enter(t, from + 0.1, 2.2))}
        />
        <path
          d={pathThrough(fund)}
          fill="none"
          stroke={palette.gold}
          strokeWidth={5}
          strokeLinecap="round"
          strokeLinejoin="round"
          {...drawOn(enter(t, from + 0.5, 2.2))}
        />
      </svg>
    </div>
  );
};

export const IndexScene = ({ cue, clock, chapter }: SceneProps<'index'>) => {
  const { t } = clock;
  const indicator = clock.at('ひとつにした指標');
  const named = clock.at('日経平均株価');
  const fund = clock.at('その指数と同じ');
  const takeaway = clock.at('自分で選ばなくて');
  const before = leave(t, fund - 0.1, 0.45);
  const right = SCENE_BODY.left + 500;
  const rightWidth = SCENE_BODY.left + SCENE_BODY.width - right;
  return (
    <SceneRoot>
      <Heading chapter={chapter} title={cue.title} t={t} />
      {before > 0 ? (
        <div style={{ position: 'absolute', inset: 0, opacity: before }}>
          <Tiles count={cue.constituents} t={t} />
          <div
            style={{
              ...at(right, SCENE_BODY.top + 8, rightWidth, 170),
              ...cardStyle(),
              ...rise(t, indicator - 0.2, 28),
              padding: '26px 32px',
            }}
          >
            <div style={{ fontSize: 26, color: palette.muted, fontWeight: 700 }}>
              たくさんの銘柄の値動きを
            </div>
            <div style={{ fontSize: 44, fontWeight: 900, marginTop: 10 }}>
              ひとつにまとめた<span style={{ color: palette.sky }}>「指標」</span>
            </div>
          </div>
          <div
            style={{
              ...at(right, SCENE_BODY.top + 210, rightWidth, 220),
              ...cardStyle('rgba(255, 209, 102, 0.45)'),
              ...rise(t, named - 0.1, 28),
              padding: '22px 32px',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
            }}
          >
            <div style={{ fontSize: 36, fontWeight: 900 }}>{cue.indexLabel}</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
              <span
                style={{
                  fontSize: 120,
                  fontWeight: 900,
                  color: palette.gold,
                  lineHeight: 1,
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {formatInteger(countUp(t, named + 0.2, cue.constituents, 1.4))}
              </span>
              <span style={{ fontSize: 40, fontWeight: 900 }}>社の平均</span>
            </div>
          </div>
        </div>
      ) : null}
      {t >= fund - 0.2 ? (
        <TrackingChart t={t} from={fund} indexLabel={cue.indexLabel} fundLabel={cue.fundLabel} />
      ) : null}
      <div
        style={{
          ...at(
            SCENE_BODY.left + SCENE_BODY.width - 470,
            SCENE_BODY.top + SCENE_BODY.height - 96,
            470,
            90,
          ),
          display: 'flex',
          justifyContent: 'flex-end',
          alignItems: 'center',
          ...popIn(t, takeaway, 0.5),
        }}
      >
        <Tag
          color={palette.mint}
          size={38}
          style={{ boxShadow: '0 12px 30px rgba(94,234,212,0.35)' }}
        >
          <Check size={40} color={palette.groundTop} amount={enter(t, takeaway + 0.15, 0.4)} />
          {cue.takeaway}
        </Tag>
      </div>
    </SceneRoot>
  );
};
