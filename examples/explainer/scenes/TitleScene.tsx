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
          ...at(80, 250, STAGE.width - 160, 330),
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 22,
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
              padding: '22px 26px',
              display: 'flex',
              alignItems: 'center',
              gap: 18,
            }}
          >
            <div style={{ fontSize: 38, fontWeight: 900, color: palette.gold, minWidth: 52 }}>
              {String(index + 1).padStart(2, '0')}
            </div>
            <div style={{ fontSize: 29, fontWeight: 700, lineHeight: 1.3 }}>{item}</div>
          </div>
        ))}
      </div>
    </SceneRoot>
  );
};
