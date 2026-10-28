// Chapter 7: which money suits it. Money needed within a few years goes to the guarded card on the
// left, money not needed for a long while to the growing one on the right; then the question
// Zundamon raises — would you keep going after a fall? — settles under both.
import { type ReactNode } from 'react';

import { SCENE_BODY, palette } from '../look.ts';
import { enter, popIn, rise, sway } from '../motion.ts';
import { at, cardStyle, drawOn, Heading, SceneRoot, Tag, type SceneProps } from './kit.tsx';

const CARD_WIDTH = 548;
const CARD_HEIGHT = 282;

const Shield = ({ amount }: { readonly amount: number }) => (
  <svg width={84} height={84} viewBox="0 0 48 48">
    <path
      d="M24 4 L40 10 V22 C40 33 33 40 24 44 C15 40 8 33 8 22 V10 Z"
      fill="none"
      stroke={palette.sky}
      strokeWidth={3.5}
      strokeLinejoin="round"
      {...drawOn(amount)}
    />
    <path
      d="M17 24 L22 29 L31 19"
      fill="none"
      stroke={palette.sky}
      strokeWidth={3.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...drawOn(enter(amount, 0.6, 0.4))}
    />
  </svg>
);

const Sprout = ({ amount }: { readonly amount: number }) => (
  <svg width={84} height={84} viewBox="0 0 48 48">
    <path
      d="M6 42 L18 30 L26 36 L42 14"
      fill="none"
      stroke={palette.mint}
      strokeWidth={3.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...drawOn(amount)}
    />
    <path
      d="M32 14 H42 V24"
      fill="none"
      stroke={palette.mint}
      strokeWidth={3.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...drawOn(enter(amount, 0.6, 0.4))}
    />
  </svg>
);

export const ScopeScene = ({ cue, clock, chapter }: SceneProps<'scope'>) => {
  const { t } = clock;
  const nearAt = clock.at('数年以内');
  const guardAt = clock.at('元本が保証されている');
  const farAt = clock.at('投資に向くお金');
  const sortAt = clock.at('分けて考える');
  const askAt = clock.at('値段が下がったときに');
  const right = SCENE_BODY.left + SCENE_BODY.width - CARD_WIDTH;
  const card = (
    left: number,
    label: string,
    detail: string,
    from: number,
    detailAt: number,
    color: string,
    icon: ReactNode,
    tag: string,
    tagColor: string,
  ) => (
    <div
      style={{
        ...at(left, SCENE_BODY.top, CARD_WIDTH, CARD_HEIGHT),
        ...cardStyle(color),
        ...rise(t, from, 36),
        padding: '30px 34px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 22 }}>
        {icon}
        <div style={{ fontSize: 38, fontWeight: 900, lineHeight: 1.3 }}>{label}</div>
      </div>
      <div
        style={{ ...rise(t, detailAt, 16), marginTop: 22, fontSize: 30, fontWeight: 700, color }}
      >
        → {detail}
      </div>
      <div
        style={{
          position: 'absolute',
          right: 26,
          top: -22,
          ...popIn(t, sortAt + (left === right ? 0.3 : 0), 0.5),
        }}
      >
        <Tag color={tagColor} size={24}>
          {tag}
        </Tag>
      </div>
    </div>
  );
  return (
    <SceneRoot>
      <Heading chapter={chapter} title={cue.title} t={t} />
      {card(
        SCENE_BODY.left,
        cue.near.label,
        cue.near.detail,
        nearAt,
        guardAt,
        palette.sky,
        <Shield amount={enter(t, nearAt + 0.3, 1)} />,
        '投資には向かない',
        palette.coral,
      )}
      {card(
        right,
        cue.far.label,
        cue.far.detail,
        farAt,
        farAt + 0.6,
        palette.mint,
        <Sprout amount={enter(t, farAt + 0.3, 1)} />,
        '投資を考えられる',
        palette.mint,
      )}
      <div
        style={{
          ...at(
            SCENE_BODY.left + 140,
            SCENE_BODY.top + CARD_HEIGHT + 34,
            SCENE_BODY.width - 280,
            120,
          ),
          ...cardStyle(palette.gold),
          ...popIn(t, askAt, 0.7),
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 26,
        }}
      >
        <div
          style={{
            width: 70,
            height: 70,
            borderRadius: 35,
            background: palette.gold,
            color: palette.groundTop,
            fontSize: 48,
            fontWeight: 900,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transform: `rotate(${String(sway(t, 2.4, 8))}deg)`,
          }}
        >
          ?
        </div>
        <div style={{ fontSize: 44, fontWeight: 900 }}>{cue.question}</div>
      </div>
    </SceneRoot>
  );
};
