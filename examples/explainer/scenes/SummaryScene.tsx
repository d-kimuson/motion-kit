// Chapter 8: the summary. Each point of the checklist is ticked as Metan says it; "this is index
// investing" lights the whole list, Zundamon's "not a recommendation" sits under it in muted type,
// and the closing tag lands on "whether it suits you". A small plant grows on the right as the list
// fills — one leaf per ticked point.
import { SCENE_BODY, palette } from '../look.ts';
import { enter, popIn, rise, slideIn, springStep, sway } from '../motion.ts';
import { at, cardStyle, Check, Heading, SceneRoot, Tag, type SceneProps } from './kit.tsx';

const LIST_WIDTH = 720;
const ROW_HEIGHT = 78;
const ROW_GAP = 14;
const PLANT_LEFT = SCENE_BODY.left + LIST_WIDTH + 60;
const PLANT_WIDTH = SCENE_BODY.left + SCENE_BODY.width - PLANT_LEFT;

const Plant = ({
  t,
  leaves,
  bloom,
}: {
  readonly t: number;
  readonly leaves: readonly number[];
  readonly bloom: number;
}) => {
  const height = 50 + leaves.reduce((sum, leaf) => sum + leaf, 0) * 44;
  const base = 330;
  const lean = sway(t, 3.2, 2.5);
  return (
    <svg width={PLANT_WIDTH} height={360} viewBox={`0 0 ${String(PLANT_WIDTH)} 360`}>
      <ellipse cx={PLANT_WIDTH / 2} cy={base + 8} rx={120} ry={16} fill="rgba(0,0,0,0.3)" />
      <path
        d={`M${String(PLANT_WIDTH / 2 - 70)} ${String(base - 54)} L${String(PLANT_WIDTH / 2 + 70)} ${String(base - 54)} L${String(PLANT_WIDTH / 2 + 54)} ${String(base + 6)} L${String(PLANT_WIDTH / 2 - 54)} ${String(base + 6)} Z`}
        fill="#c7835a"
      />
      <rect x={PLANT_WIDTH / 2 - 78} y={base - 66} width={156} height={18} rx={6} fill="#d99a70" />
      <g transform={`rotate(${String(lean)} ${String(PLANT_WIDTH / 2)} ${String(base - 60)})`}>
        <line
          x1={PLANT_WIDTH / 2}
          x2={PLANT_WIDTH / 2}
          y1={base - 60}
          y2={base - 60 - height}
          stroke={palette.mint}
          strokeWidth={8}
          strokeLinecap="round"
        />
        {leaves.map((leaf, index) => {
          const side = index % 2 === 0 ? -1 : 1;
          const y = base - 60 - 44 - index * 44;
          return (
            <ellipse
              key={`leaf-${String(index)}`}
              cx={PLANT_WIDTH / 2 + side * 38 * leaf}
              cy={y}
              rx={40 * leaf}
              ry={17 * leaf}
              fill={index % 2 === 0 ? palette.mint : '#3fcf9f'}
              transform={`rotate(${String(side * -28)} ${String(PLANT_WIDTH / 2 + side * 38 * leaf)} ${String(y)})`}
            />
          );
        })}
        <circle
          cx={PLANT_WIDTH / 2}
          cy={base - 60 - height - 6}
          r={22 * bloom}
          fill={palette.gold}
        />
        <circle cx={PLANT_WIDTH / 2} cy={base - 60 - height - 6} r={9 * bloom} fill="#ffb347" />
      </g>
    </svg>
  );
};

export const SummaryScene = ({ cue, clock, chapter }: SceneProps<'summary'>) => {
  const { t } = clock;
  const tickAt = cue.items.map((item) => clock.at(item));
  const allAt = clock.at('これがインデックス投資');
  const noteAt = clock.at('特定の商品');
  const closeAt = clock.at('自分に合うかどうか');
  const all = enter(t, allAt, 0.6);
  const leaves = tickAt.map((tick) => enter(t, tick + 0.25, 0.6));
  return (
    <SceneRoot>
      <Heading chapter={chapter} title={cue.title} t={t} />
      {cue.items.map((item, index) => {
        const tick = tickAt[index] ?? 0;
        const done = enter(t, tick, 0.4);
        return (
          <div
            key={item}
            style={{
              ...at(
                SCENE_BODY.left,
                SCENE_BODY.top + index * (ROW_HEIGHT + ROW_GAP),
                LIST_WIDTH,
                ROW_HEIGHT,
              ),
              ...cardStyle(done > 0 ? `rgba(94,234,212,${String(0.25 + 0.5 * done)})` : undefined),
              ...slideIn(t, Math.min(tick - 0.5, 0.3 + index * 0.15), 40),
              display: 'flex',
              alignItems: 'center',
              gap: 22,
              padding: '0 26px',
              boxShadow:
                all > 0 ? `0 0 ${String(30 * all)}px rgba(94,234,212,0.3)` : cardStyle().boxShadow,
            }}
          >
            <div
              style={{
                width: 48,
                height: 48,
                flex: 'none',
                borderRadius: 14,
                border: `3px solid ${done > 0 ? palette.mint : palette.faint}`,
                background: done > 0 ? 'rgba(94,234,212,0.15)' : 'transparent',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Check size={38} color={palette.mint} amount={done} />
            </div>
            <div
              style={{
                fontSize: 38,
                fontWeight: 900,
                color: done > 0 ? palette.text : palette.muted,
              }}
            >
              {item}
            </div>
          </div>
        );
      })}
      <div
        style={{
          ...at(
            SCENE_BODY.left,
            SCENE_BODY.top + cue.items.length * (ROW_HEIGHT + ROW_GAP) + 4,
            LIST_WIDTH,
            40,
          ),
          ...rise(t, noteAt, 12),
          fontSize: 24,
          fontWeight: 700,
          color: palette.muted,
        }}
      >
        ※ 特定の商品や会社をすすめるものではありません
      </div>
      <div style={{ ...at(PLANT_LEFT, SCENE_BODY.top, PLANT_WIDTH, 360), ...rise(t, 0.3, 20) }}>
        <Plant t={t} leaves={leaves} bloom={springStep(t - allAt - 0.3, 0.55, 14)} />
      </div>
      <div
        style={{
          ...at(PLANT_LEFT - 60, SCENE_BODY.top + 360, PLANT_WIDTH + 60, 60),
          display: 'flex',
          justifyContent: 'center',
          ...popIn(t, closeAt, 0.6),
        }}
      >
        <Tag
          color={palette.gold}
          size={30}
          style={{ boxShadow: '0 10px 30px rgba(255,209,102,0.35)' }}
        >
          {cue.closing}
        </Tag>
      </div>
    </SceneRoot>
  );
};
