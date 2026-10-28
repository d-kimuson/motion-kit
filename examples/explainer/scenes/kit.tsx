// What every scene shares: its props, the clock that turns a narrated phrase into a second, and the
// few building blocks every chapter draws with (the heading, a card, a tag, a check mark).
//
// A scene is a pure function of its cue and its clock. It draws in stage-local pixels — the
// `STAGE` box of `look.ts`, 1260x652 — and keys every beat to a phrase of its own narration through
// `clock.at`, so the picture moves when the voice says the word it illustrates.
import { type CSSProperties, type ReactNode } from 'react';

import { HEADING_HEIGHT, STAGE, STAGE_PADDING, palette } from '../look.ts';
import { enter, rise, slideIn } from '../motion.ts';
import { phraseTime, type PlannedSlide } from '../plan.ts';
import { type SlideCue } from '../script.schema.ts';

/**
 * A scene's time: `t` is seconds since the slide's own zero, and `at(phrase)` is when the narration
 * says `phrase`. A phrase this storyboard does not narrate (a short storyboard plays part of a
 * slide) is treated as said long ago, so the scene shows its finished state instead of a blank.
 */
export type Clock = {
  readonly t: number;
  readonly at: (phrase: string) => number;
};

/** Long enough before zero that every arrival keyed to it has landed, and finite for the spring. */
const LONG_AGO = -60;

export const sceneClock = (
  slide: PlannedSlide,
  time: number,
  fps: number,
  missing?: string[],
): Clock => ({
  t: time,
  at: (phrase) => {
    const at = phraseTime(slide, phrase, fps);
    if (at !== undefined) return at;
    missing?.push(phrase);
    return LONG_AGO;
  },
});

export type SceneProps<K extends SlideCue['kind']> = {
  readonly cue: Extract<SlideCue, { readonly kind: K }>;
  readonly clock: Clock;
  /** The chapter number the heading shows: the slide's index, the title slide being 0. */
  readonly chapter: number;
};

/** The scene's own layer: the stage box, in stage-local pixels. */
export const SceneRoot = ({ children }: { readonly children: ReactNode }) => (
  <div style={{ position: 'absolute', inset: 0, width: STAGE.width, height: STAGE.height }}>
    {children}
  </div>
);

/** A box in stage-local pixels. */
export const at = (
  left: number,
  top: number,
  width: number,
  height: number,
  style?: CSSProperties,
): CSSProperties => ({ position: 'absolute', left, top, width, height, ...style });

/** The chapter heading every content scene opens with: its number, its title, an optional note. */
export const Heading = ({
  chapter,
  title,
  t,
  note,
}: {
  readonly chapter: number;
  readonly title: string;
  readonly t: number;
  readonly note?: ReactNode;
}) => {
  const rule = enter(t, 0.3, 0.8);
  return (
    <div
      style={at(STAGE_PADDING, STAGE_PADDING - 12, STAGE.width - 2 * STAGE_PADDING, HEADING_HEIGHT)}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 22, height: 72 }}>
        <div
          style={{
            ...slideIn(t, 0.02, 24, 0.45),
            width: 64,
            height: 64,
            borderRadius: 18,
            background: `linear-gradient(135deg, ${palette.gold}, #ffb347)`,
            color: palette.groundTop,
            fontSize: 30,
            fontWeight: 900,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 8px 24px rgba(255, 209, 102, 0.25)',
          }}
        >
          {String(chapter).padStart(2, '0')}
        </div>
        <div
          style={{
            ...rise(t, 0.12, 18, 0.5),
            fontSize: 50,
            fontWeight: 900,
            letterSpacing: '0.02em',
          }}
        >
          {title}
        </div>
        {note === undefined ? null : (
          <div style={{ marginLeft: 'auto', textAlign: 'right' }}>{note}</div>
        )}
      </div>
      <div
        style={{
          marginTop: 12,
          height: 3,
          width: `${String(rule * 100)}%`,
          borderRadius: 2,
          background: `linear-gradient(90deg, ${palette.gold}, rgba(255, 209, 102, 0))`,
        }}
      />
    </div>
  );
};

/** A raised surface inside the stage. */
export const cardStyle = (accent?: string): CSSProperties => ({
  borderRadius: 24,
  background: 'linear-gradient(180deg, rgba(255,255,255,0.075), rgba(255,255,255,0.035))',
  border: `2px solid ${accent ?? 'rgba(255,255,255,0.09)'}`,
  boxShadow: '0 18px 40px rgba(0, 0, 0, 0.28)',
  boxSizing: 'border-box',
});

/** A rounded label: a pill of colour with dark type on it. */
export const Tag = ({
  color,
  children,
  size = 24,
  style,
}: {
  readonly color: string;
  readonly children: ReactNode;
  readonly size?: number;
  readonly style?: CSSProperties;
}) => (
  <div
    style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 8,
      padding: `${String(Math.round(size * 0.3))}px ${String(Math.round(size * 0.75))}px`,
      borderRadius: 999,
      background: color,
      color: palette.groundTop,
      fontSize: size,
      fontWeight: 900,
      whiteSpace: 'nowrap',
      ...style,
    }}
  >
    {children}
  </div>
);

/** A check mark drawn as a stroke, so it needs no glyph: `amount` draws it from 0 to 1. */
export const Check = ({
  size,
  color,
  amount,
}: {
  readonly size: number;
  readonly color: string;
  readonly amount: number;
}) => (
  <svg width={size} height={size} viewBox="0 0 24 24" style={{ display: 'block' }}>
    <path
      d="M5 12.5 L10 17.5 L19 7"
      fill="none"
      stroke={color}
      strokeWidth={3.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      pathLength={1}
      strokeDasharray="1 1"
      strokeDashoffset={1 - amount}
    />
  </svg>
);

/** An SVG polyline through `points`, as a path's `d`. */
export const pathThrough = (points: readonly (readonly [number, number])[]): string =>
  points
    .map(([x, y], index) => `${index === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`)
    .join(' ');

/** A stroke drawn on from its start: `amount` 0 hides it, 1 shows it whole. */
export const drawOn = (amount: number) => ({
  pathLength: 1,
  strokeDasharray: '1 1',
  strokeDashoffset: 1 - amount,
});

/** A small footnote line in the stage's lower edge. */
export const Footnote = ({
  children,
  style,
}: {
  readonly children: ReactNode;
  readonly style?: CSSProperties;
}) => (
  <div
    style={{
      ...at(STAGE_PADDING, STAGE.height - STAGE_PADDING + 8, STAGE.width - 2 * STAGE_PADDING, 30),
      fontSize: 19,
      color: palette.muted,
      textAlign: 'right',
      ...style,
    }}
  >
    {children}
  </div>
);

/** A cheap deterministic hash of an integer onto 0..1, for per-tile variation that never changes. */
export const hash01 = (value: number): number => {
  const x = Math.sin(value * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};
