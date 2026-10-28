// Chapter 2: diversification. One big holding on the left, the same money spread over many small
// ones on the right; when Metan says one failure does not break the whole, one holding on each side
// fails, and the meters under the cards show how much of the money each failure touched. Zundamon's
// snack-box analogy turns the tiles into boxes and lights the spread side.
import { SCENE_BODY, palette } from '../look.ts';
import { enter, lerp, popIn, rise } from '../motion.ts';
import { at, cardStyle, Check, Heading, SceneRoot, Tag, type SceneProps } from './kit.tsx';

const CARD_WIDTH = 540;
const CARD_HEIGHT = 330;
const CARD_GAP = SCENE_BODY.width - 2 * CARD_WIDTH;

/** One holding: a tile that may fail (turn coral and drop) and may be drawn as a lidded box. */
const Holding = ({
  left,
  top,
  size,
  failed,
  boxed,
  arrive,
}: {
  readonly left: number;
  readonly top: number;
  readonly size: number;
  readonly failed: number;
  readonly boxed: number;
  readonly arrive: number;
}) => (
  <div
    style={at(left, top, size, size, {
      borderRadius: lerp(size * 0.22, size * 0.1, boxed),
      background: failed > 0 ? palette.coral : palette.mint,
      opacity: arrive * lerp(1, 0.4, failed),
      transform: `translateY(${String(failed * size * 0.18)}px) rotate(${String(failed * 9)}deg) scale(${String(0.5 + 0.5 * arrive)})`,
      overflow: 'hidden',
      boxShadow: failed > 0 ? '0 0 24px rgba(255,107,107,0.55)' : 'none',
    })}
  >
    <div
      style={{
        height: `${String(boxed * 24)}%`,
        background: 'rgba(10, 19, 34, 0.32)',
        borderBottom: boxed > 0 ? '2px solid rgba(10, 19, 34, 0.4)' : 'none',
      }}
    />
  </div>
);

const Meter = ({
  left,
  share,
  label,
  color,
  amount,
}: {
  readonly left: number;
  readonly share: number;
  readonly label: string;
  readonly color: string;
  readonly amount: number;
}) => (
  <div
    style={{
      ...at(left, SCENE_BODY.top + CARD_HEIGHT + 32, CARD_WIDTH, 80),
      opacity: enter(amount, 0, 0.2),
    }}
  >
    <div
      style={{ display: 'flex', justifyContent: 'space-between', fontSize: 26, fontWeight: 700 }}
    >
      <span style={{ color: palette.muted }}>1社の失敗の影響</span>
      <span style={{ color, fontWeight: 900, fontSize: 34 }}>{label}</span>
    </div>
    <div
      style={{ marginTop: 8, height: 16, borderRadius: 8, background: 'rgba(255,255,255,0.08)' }}
    >
      <div
        style={{
          height: 16,
          borderRadius: 8,
          width: `${String(share * amount * 100)}%`,
          minWidth: amount > 0 ? 16 : 0,
          background: color,
        }}
      />
    </div>
  </div>
);

export const SpreadScene = ({ cue, clock, chapter }: SceneProps<'spread'>) => {
  const { t } = clock;
  const failAt = clock.at('ひとつの失敗');
  const snacks = clock.at('お菓子');
  const split = clock.at('小分けにしておく');
  const failed = enter(t, failAt + 0.3, 0.5);
  const boxed = enter(t, snacks, 0.6);
  const side = Math.ceil(Math.sqrt(cue.companies));
  const tile = Math.floor((CARD_HEIGHT - 90) / side) - 10;
  const failing = Math.floor(cue.companies / 2) - 3;
  const right = SCENE_BODY.left + CARD_WIDTH + CARD_GAP;
  const glow = enter(t, split, 0.5);
  return (
    <SceneRoot>
      <Heading
        chapter={chapter}
        title={cue.title}
        t={t}
        note={
          <div style={popIn(t, snacks + 0.2, 0.7)}>
            <Tag color={palette.gold} size={28}>
              {cue.analogy}
            </Tag>
          </div>
        }
      />
      <div
        style={{
          ...at(SCENE_BODY.left, SCENE_BODY.top, CARD_WIDTH, CARD_HEIGHT),
          ...cardStyle(),
          ...rise(t, 0.3, 30),
        }}
      >
        <div style={{ textAlign: 'center', fontSize: 32, fontWeight: 900, marginTop: 20 }}>
          {cue.concentrated}
        </div>
        <Holding
          left={(CARD_WIDTH - 200) / 2}
          top={92}
          size={200}
          failed={failed}
          boxed={boxed}
          arrive={enter(t, 0.6, 0.5)}
        />
      </div>
      <div
        style={{
          ...at(right, SCENE_BODY.top, CARD_WIDTH, CARD_HEIGHT),
          ...cardStyle(glow > 0 ? `rgba(94, 234, 212, ${String(0.15 + 0.6 * glow)})` : undefined),
          ...rise(t, 0.5, 30),
          boxShadow: `0 18px 40px rgba(0,0,0,0.28), 0 0 ${String(40 * glow)}px rgba(94,234,212,${String(0.35 * glow)})`,
        }}
      >
        <div style={{ textAlign: 'center', fontSize: 32, fontWeight: 900, marginTop: 20 }}>
          {cue.diversified}
        </div>
        <div
          style={at(
            (CARD_WIDTH - side * (tile + 10) + 10) / 2,
            82,
            side * (tile + 10),
            side * (tile + 10),
          )}
        >
          {Array.from({ length: cue.companies }, (_, index) => (
            <Holding
              key={`holding-${String(index)}`}
              left={(index % side) * (tile + 10)}
              top={Math.floor(index / side) * (tile + 10)}
              size={tile}
              failed={index === failing ? failed : 0}
              boxed={boxed}
              arrive={enter(t, 0.8 + index * 0.03, 0.35)}
            />
          ))}
        </div>
        <div style={{ ...at(CARD_WIDTH - 76, 18, 56, 56), opacity: glow }}>
          <Check size={56} color={palette.mint} amount={enter(t, split + 0.2, 0.4)} />
        </div>
      </div>
      <Meter
        left={SCENE_BODY.left}
        share={1}
        label="100%"
        color={palette.coral}
        amount={enter(t, failAt + 0.6, 0.8)}
      />
      <Meter
        left={right}
        share={1 / cue.companies}
        label={`${String(Math.round(100 / cue.companies))}%`}
        color={palette.mint}
        amount={enter(t, failAt + 0.6, 0.8)}
      />
    </SceneRoot>
  );
};
