// The tail: the disclaimer the script ends on, word for word, and the credit block the asset
// licensing ADR requires on the video itself. No heading number — it is not a chapter.
import { CREDITS, STAGE, palette } from '../look.ts';
import { rise } from '../motion.ts';
import { at, cardStyle, SceneRoot, type SceneProps } from './kit.tsx';

const CARD_WIDTH = 1000;

export const DisclaimerScene = ({ cue, clock }: SceneProps<'disclaimer'>) => {
  const { t } = clock;
  return (
    <SceneRoot>
      <div
        style={{
          ...at((STAGE.width - CARD_WIDTH) / 2, 70, CARD_WIDTH, 300),
          ...cardStyle(palette.panelEdge),
          ...rise(t, 0.1, 24),
          padding: '40px 56px',
        }}
      >
        <div
          style={{ fontSize: 26, fontWeight: 900, color: palette.gold, letterSpacing: '0.12em' }}
        >
          ご注意
        </div>
        <div
          style={{
            marginTop: 16,
            fontSize: 36,
            fontWeight: 700,
            lineHeight: 1.6,
            wordBreak: 'auto-phrase',
          }}
        >
          {cue.text}
        </div>
      </div>
      <div
        style={{ ...at((STAGE.width - CARD_WIDTH) / 2, 410, CARD_WIDTH, 200), ...rise(t, 0.5, 16) }}
      >
        <div
          style={{
            fontSize: 22,
            fontWeight: 900,
            color: palette.muted,
            letterSpacing: '0.12em',
            marginBottom: 10,
          }}
        >
          クレジット
        </div>
        {CREDITS.map((credit) => (
          <div key={credit} style={{ fontSize: 22, lineHeight: 1.65, color: palette.muted }}>
            {credit}
          </div>
        ))}
      </div>
    </SceneRoot>
  );
};
