// Chapter 5: long term, instalments, diversification. The three words stand up as pillars; then
// the same amount goes in every month while the price wanders, and the bars show how much each month
// bought — taller in the cheap months — which is what Zundamon's last sentence points at.
import { type CSSProperties } from 'react';

import { SCENE_BODY, palette } from '../look.ts';
import { enter, leave, popIn, rise } from '../motion.ts';
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
import { linear, unitsBought } from './math.ts';

const PILLAR_WIDTH = 300;
const PILLAR_GAP = 56;
const PRICE_HEIGHT = 130;
const BARS_TOP = 150;
const BARS_HEIGHT = 190;
const LABELS_TOP = BARS_TOP + BARS_HEIGHT + 8;

const pillarColors = [palette.sky, palette.gold, palette.mint] as const;

export const InstalmentScene = ({ cue, clock, chapter }: SceneProps<'instalment'>) => {
  const { t } = clock;
  const motto = clock.at('長期・積立・分散');
  const plan = clock.at('決まった金額');
  const steady = clock.at('毎月コツコツ');
  const cheapAt = clock.at('高い時期も安い時期も');
  const pillars = leave(t, plan - 0.1, 0.45);
  const units = unitsBought(cue.monthly, cue.prices);
  const maxUnits = Math.max(...units);
  const months = cue.prices.length;
  const slot = SCENE_BODY.width / months;
  const priceY = linear(
    [Math.min(...cue.prices) * 0.9, Math.max(...cue.prices) * 1.05],
    [PRICE_HEIGHT - 8, 8],
  );
  const priceLine = cue.prices.map(
    (price, month) => [slot * (month + 0.5), priceY(price)] as const,
  );
  const cheapest = Math.min(...cue.prices);
  const dearest = Math.max(...cue.prices);
  const cheapLit = enter(t, cheapAt, 0.5);
  const monthAt = (month: number) => plan + 0.4 + month * 0.32;
  const pillarRow = cue.pillars.length * PILLAR_WIDTH + (cue.pillars.length - 1) * PILLAR_GAP;
  return (
    <SceneRoot>
      <Heading
        chapter={chapter}
        title={cue.title}
        t={t}
        note={
          <div style={popIn(t, steady, 0.6)}>
            <Tag color={palette.gold} size={26}>
              {`毎月 ${String(cue.monthly)}万円ずつ`}
            </Tag>
          </div>
        }
      />
      {pillars > 0 ? (
        <div style={{ position: 'absolute', inset: 0, opacity: pillars }}>
          {cue.pillars.map((pillar, index) => {
            const color = pillarColors[index] ?? palette.sky;
            const style: CSSProperties = {
              ...at(
                SCENE_BODY.left +
                  (SCENE_BODY.width - pillarRow) / 2 +
                  index * (PILLAR_WIDTH + PILLAR_GAP),
                SCENE_BODY.top + 40,
                PILLAR_WIDTH,
                340,
              ),
              ...cardStyle(color),
              ...popIn(t, motto + 0.1 + index * 0.35, 0.5),
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 10,
            };
            return (
              <div key={pillar} style={style}>
                <div style={{ fontSize: 26, fontWeight: 900, color, letterSpacing: '0.1em' }}>
                  {String(index + 1).padStart(2, '0')}
                </div>
                <div style={{ fontSize: 104, fontWeight: 900, lineHeight: 1.1 }}>{pillar}</div>
              </div>
            );
          })}
        </div>
      ) : null}
      {t >= plan - 0.3 ? (
        <div
          style={{
            ...at(SCENE_BODY.left, SCENE_BODY.top, SCENE_BODY.width, SCENE_BODY.height),
            ...rise(t, plan, 24),
          }}
        >
          <div style={{ ...at(0, -2, 200, 30), fontSize: 20, fontWeight: 700, color: palette.sky }}>
            価格
          </div>
          <svg
            width={SCENE_BODY.width}
            height={PRICE_HEIGHT}
            style={{ position: 'absolute', left: 0, top: 0 }}
          >
            <path
              d={pathThrough(priceLine)}
              fill="none"
              stroke={palette.sky}
              strokeWidth={5}
              strokeLinecap="round"
              strokeLinejoin="round"
              {...drawOn(enter(t, plan + 0.2, 0.32 * months))}
            />
            {priceLine.map(([x, y], month) => (
              <circle
                key={`price-${String(month)}`}
                cx={x}
                cy={y}
                r={7}
                fill={palette.sky}
                opacity={enter(t, monthAt(month), 0.2)}
              />
            ))}
          </svg>
          <div
            style={{
              ...at(0, BARS_TOP - 4, 200, 30),
              fontSize: 20,
              fontWeight: 700,
              color: palette.gold,
            }}
          >
            買えた量
          </div>
          {units.map((amount, month) => {
            const grow = enter(t, monthAt(month), 0.45);
            const price = cue.prices[month] ?? 0;
            const cheap = price === cheapest || price <= cheapest * 1.12;
            const dear = price === dearest || price >= dearest * 0.95;
            const height = (amount / maxUnits) * (BARS_HEIGHT - 40) * grow;
            const highlight = cheap ? cheapLit : 0;
            return (
              <div key={`bar-${String(month)}`}>
                <div
                  style={at(
                    slot * month + slot * 0.2,
                    BARS_TOP + BARS_HEIGHT - height,
                    slot * 0.6,
                    height,
                    {
                      borderRadius: '10px 10px 4px 4px',
                      background: highlight > 0 ? palette.mint : palette.gold,
                      opacity: dear ? 1 - 0.5 * cheapLit : 1,
                      boxShadow:
                        highlight > 0
                          ? `0 0 ${String(28 * highlight)}px rgba(94,234,212,0.6)`
                          : 'none',
                    },
                  )}
                />
                <div
                  style={at(
                    slot * month,
                    BARS_TOP + BARS_HEIGHT - height - 34 - (1 - grow) * 30,
                    slot,
                    30,
                    {
                      textAlign: 'center',
                      fontSize: 18,
                      fontWeight: 900,
                      color: palette.groundTop,
                      opacity:
                        enter(t, monthAt(month), 0.15) * leave(t, monthAt(month) + 0.5, 0.25),
                    },
                  )}
                >
                  <span style={{ background: palette.gold, borderRadius: 999, padding: '2px 8px' }}>
                    {`${String(cue.monthly)}万円`}
                  </span>
                </div>
                <div
                  style={at(slot * month, LABELS_TOP, slot, 26, {
                    textAlign: 'center',
                    fontSize: 19,
                    color: palette.muted,
                    opacity: grow,
                  })}
                >
                  {String(month + 1)}
                </div>
              </div>
            );
          })}
          <div
            style={{
              ...at(0, LABELS_TOP + 40, SCENE_BODY.width, 56),
              display: 'flex',
              justifyContent: 'center',
              ...popIn(t, cheapAt + 0.4, 0.6),
            }}
          >
            <Tag color={palette.mint} size={30}>
              {cue.takeaway}
            </Tag>
          </div>
        </div>
      ) : null}
    </SceneRoot>
  );
};
