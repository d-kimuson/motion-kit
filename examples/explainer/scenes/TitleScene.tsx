// Chapter 0: the video's title, then the agenda the rest of the video walks through.
//
// The title arrives a character at a time on a spring, over a rising line that hints at what the
// video is about; when Zundamon starts the second line, the title lifts to the top and the agenda
// deals out under it, one card per chapter.
import { STAGE, palette } from '../look.ts';
import { enter, lerp, popIn, rise, stagger } from '../motion.ts';
import { at, drawOn, pathThrough, SceneRoot, type SceneProps } from './kit.tsx';

/** The rising line behind the title: a fixed, gently noisy climb across the stage. */
const climb = Array.from({ length: 24 }, (_, index) => {
  const x = 40 + (index / 23) * (STAGE.width - 80);
  const trend = 520 - index * 15;
  const wobble = Math.sin(index * 1.7) * 22 + Math.sin(index * 0.6) * 14;
  return [x, trend + wobble] as const;
});

/** The agenda grid: two columns, so the longest chapter title sits on one line in its card. */
const AGENDA_WIDTH = STAGE.width - 160;
const AGENDA_COLUMNS = 2;
const AGENDA_GAP = 22;
const CARD_PADDING = 26;
const NUMBER_WIDTH = 52;
const NUMBER_GAP = 18;
export const AGENDA_SIZE = 29;
/** What a card leaves for its chapter title, in design pixels; `scenes.test.ts` fits every title in it. */
export const AGENDA_TEXT_WIDTH =
  (AGENDA_WIDTH - AGENDA_GAP * (AGENDA_COLUMNS - 1)) / AGENDA_COLUMNS -
  2 * CARD_PADDING -
  NUMBER_WIDTH -
  NUMBER_GAP;

export const TitleScene = ({ cue, clock }: SceneProps<'title'>) => {
  const { t } = clock;
  const agendaAt = clock.at('投資ってなんだか');
  const lift = enter(t, agendaAt, 0.7);
  const characters = Array.from(cue.text);
  const titleSize = 86;
  return (
    <SceneRoot>
      <svg
        width={STAGE.width}
        height={STAGE.height}
        style={{ position: 'absolute', inset: 0, opacity: lerp(0.55, 0.18, lift) }}
      >
        <defs>
          <linearGradient id="title-climb" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0" stopColor={palette.sky} stopOpacity={0} />
            <stop offset="1" stopColor={palette.sky} stopOpacity={0.9} />
          </linearGradient>
        </defs>
        <path
          d={pathThrough(climb)}
          fill="none"
          stroke="url(#title-climb)"
          strokeWidth={5}
          strokeLinecap="round"
          strokeLinejoin="round"
          {...drawOn(enter(t, 0.1, 2.4))}
        />
      </svg>
      <div
        style={{
          ...at(0, 0, STAGE.width, STAGE.height),
          transform: `translateY(${String(lerp(0, -190, lift))}px) scale(${String(lerp(1, 0.72, lift))})`,
          transformOrigin: '50% 50%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 26,
        }}
      >
        <div
          style={{
            ...rise(t, 0.05, 20),
            fontSize: 30,
            fontWeight: 700,
            color: palette.gold,
            letterSpacing: '0.18em',
          }}
        >
          {cue.kicker}
        </div>
        <div style={{ display: 'flex', fontSize: titleSize, fontWeight: 900, lineHeight: 1.1 }}>
          {characters.map((character, index) => (
            <span
              key={`${String(index)}-${character}`}
              style={{ display: 'inline-block', ...popIn(t, stagger(0.35, index, 0.05), 0.3) }}
            >
              {character}
            </span>
          ))}
        </div>
        <div
          style={{
            height: 8,
            width: lerp(0, 760, enter(t, 1.1, 0.9)),
            borderRadius: 4,
            background: `linear-gradient(90deg, ${palette.mint}, ${palette.sky}, ${palette.gold})`,
          }}
        />
      </div>
      <div
        style={{
          ...at(80, 250, AGENDA_WIDTH, 330),
          display: 'grid',
          gridTemplateColumns: `repeat(${String(AGENDA_COLUMNS)}, 1fr)`,
          gap: AGENDA_GAP,
        }}
      >
        {cue.agenda.map((item, index) => (
          <div
            key={item}
            style={{
              ...rise(t, stagger(agendaAt + 0.35, index, 0.18), 36),
              borderRadius: 22,
              background: 'rgba(255,255,255,0.06)',
              border: '2px solid rgba(255,255,255,0.1)',
              padding: `0 ${String(CARD_PADDING)}px`,
              display: 'flex',
              alignItems: 'center',
              gap: NUMBER_GAP,
            }}
          >
            <div
              style={{ fontSize: 38, fontWeight: 900, color: palette.gold, minWidth: NUMBER_WIDTH }}
            >
              {String(index + 1).padStart(2, '0')}
            </div>
            <div
              style={{
                fontSize: AGENDA_SIZE,
                fontWeight: 700,
                lineHeight: 1.3,
                whiteSpace: 'nowrap',
              }}
            >
              {item}
            </div>
          </div>
        ))}
      </div>
    </SceneRoot>
  );
};
