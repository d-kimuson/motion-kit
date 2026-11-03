import { useSequence } from '@kimuson/motion-kit';
import { easing } from '@kimuson/motion-kit/motion';

import {
  agentFacts,
  determinismModes,
  headings,
  installCommand,
  pipelineStages,
  pipelineSteps,
  productName,
  renderCommand,
  renderEnvelope,
  repositoryUrl,
  sceneCode,
  tagline,
  timeClaim,
  timeFormula,
} from './copy.ts';
import {
  ACCENT_GRADIENT,
  AMBER,
  CHALK,
  CYAN,
  INK,
  MONO,
  MUTED,
  PANEL,
  PANEL_EDGE,
  PINK,
  VIOLET,
} from './look.ts';
import { ease, phase, pop, revealed, steps } from './motion.ts';
import { CodeView, codeLength, Heading, Mark, useLocalFrame, Window } from './parts.tsx';

const Wordmark = ({ start, fontSize }: { readonly start: number; readonly fontSize: number }) => {
  const { time } = useSequence();
  return (
    <div style={{ display: 'flex', fontSize, fontWeight: 800, letterSpacing: -fontSize * 0.035 }}>
      {productName.split('').map((letter, index) => {
        const value = pop(time, start + index * 0.045);
        return (
          <span
            key={`letter-${String(index)}`}
            style={{
              display: 'inline-block',
              opacity: Math.min(1, value),
              transform: `translateY(${(1 - value) * fontSize * 0.5}px) scale(${0.6 + 0.4 * value})`,
              color: letter === '-' ? CYAN : CHALK,
            }}
          >
            {letter}
          </span>
        );
      })}
    </div>
  );
};

const centred = {
  position: 'absolute',
  inset: 0,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
} as const;

export const IntroScene = () => {
  const { time } = useSequence();
  const mark = pop(time, 0.05, 180, 14);
  const rule = ease(time, [0.9, 1.6], [0, 1]);
  const line = pop(time, 1.3);
  const tags = ['React / TSX', 'Deterministic frames', 'Agent-first CLI'];
  return (
    <div style={centred}>
      <Mark
        size={180}
        style={{
          opacity: Math.min(1, mark),
          transform: `rotate(${(1 - mark) * -90}deg) scale(${mark})`,
        }}
      />
      <div style={{ marginTop: 40 }}>
        <Wordmark start={0.3} fontSize={176} />
      </div>
      <div
        style={{
          width: 760 * rule,
          height: 8,
          borderRadius: 4,
          marginTop: 18,
          background: ACCENT_GRADIENT,
        }}
      />
      <div
        style={{
          marginTop: 40,
          fontSize: 52,
          fontWeight: 500,
          color: CHALK,
          opacity: Math.min(1, line),
          transform: `translateY(${(1 - line) * 30}px)`,
        }}
      >
        {tagline}
      </div>
      <div style={{ display: 'flex', gap: 20, marginTop: 44 }}>
        {tags.map((tag, index) => {
          const value = pop(time, 1.8 + index * 0.12);
          return (
            <div
              key={tag}
              style={{
                padding: '12px 26px',
                borderRadius: 999,
                border: `1.5px solid ${PANEL_EDGE}`,
                background: `${PANEL}cc`,
                fontFamily: MONO,
                fontSize: 24,
                color: MUTED,
                opacity: Math.min(1, value),
                transform: `scale(${0.8 + 0.2 * value})`,
              }}
            >
              {tag}
            </div>
          );
        })}
      </div>
    </div>
  );
};

/** The ball the code scene's snippet moves: `interpolate(t, [0, 1], [0, 560], easeOutBack)` on a
 * 1.6 s loop, drawn at `width / 560` of the snippet's units. */
const ballX = (seconds: number, width: number): number =>
  (ease(phase(seconds, 1.6) * 1.6, [0, 1], [0, 560], easing.easeOutBack) / 560) * width;

const BallTrack = ({
  seconds,
  width,
  height,
}: {
  readonly seconds: number;
  readonly width: number;
  readonly height: number;
}) => {
  const ball = height * 0.5;
  return (
    <div style={{ position: 'relative', width, height }}>
      <div
        style={{
          position: 'absolute',
          left: ball / 2,
          right: ball / 2,
          top: height / 2 - 1,
          height: 2,
          background: PANEL_EDGE,
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: ballX(seconds, width - ball),
          top: (height - ball) / 2,
          width: ball,
          height: ball,
          borderRadius: ball / 2,
          background: ACCENT_GRADIENT,
        }}
      />
    </div>
  );
};

export const CodeScene = () => {
  const { time } = useSequence();
  const { frame, rate } = useLocalFrame();
  const shown = revealed(frame, rate, 600, 70, codeLength(sceneCode));
  const editor = pop(time, 0.25);
  const preview = pop(time, 0.45);
  const looped = phase(time, 1.6) * 1.6;
  const x = ballX(time, 560);
  return (
    <>
      <Heading kicker={headings.code.kicker} title={headings.code.title} />
      <Window
        title="examples/promo/hello.tsx"
        style={{
          left: 140,
          top: 340,
          width: 1000,
          height: 560,
          opacity: Math.min(1, editor),
          transform: `translateY(${(1 - editor) * 60}px)`,
        }}
      >
        <div style={{ padding: '34px 40px' }}>
          <CodeView lines={sceneCode} shown={shown} fontSize={27} caret />
        </div>
      </Window>
      <Window
        title={`preview · t = ${looped.toFixed(2)} s`}
        style={{
          left: 1190,
          top: 340,
          width: 590,
          height: 560,
          opacity: Math.min(1, preview),
          transform: `translateY(${(1 - preview) * 60}px)`,
        }}
      >
        <div style={{ padding: '130px 40px 0' }}>
          {/* The trail is the same function sampled a little earlier: no state carries over. */}
          <div style={{ position: 'relative', height: 96 }}>
            {[0.24, 0.16, 0.08, 0].map((lag) => (
              <div
                key={`ball-${String(lag)}`}
                style={{ position: 'absolute', inset: 0, opacity: lag === 0 ? 1 : 0.5 - lag * 1.6 }}
              >
                <BallTrack seconds={time - lag} width={510} height={96} />
              </div>
            ))}
          </div>
          <div style={{ marginTop: 90, fontFamily: MONO, fontSize: 30, color: MUTED }}>
            <div>
              t = <span style={{ color: CYAN }}>{looped.toFixed(3)}</span> s
            </div>
            <div style={{ marginTop: 10 }}>
              x = <span style={{ color: AMBER }}>{x.toFixed(1)}</span>
            </div>
          </div>
        </div>
      </Window>
    </>
  );
};

/** The order the time scene "captures" its eight thumbnails in: shuffled on purpose. */
const CAPTURE_ORDER: readonly number[] = [5, 2, 7, 0, 3, 6, 1, 4];
const THUMB = { width: 190, height: 120, gap: 24, top: 380 } as const;
const thumbLeft = (index: number): number =>
  (1920 - (8 * THUMB.width + 7 * THUMB.gap)) / 2 + index * (THUMB.width + THUMB.gap);

export const TimeScene = () => {
  const { time } = useSequence();
  const { frame, rate } = useLocalFrame();
  // Whole milliseconds, so the capture step is counted in integers (see `steps`).
  const stepMs = 300;
  const firstCaptureMs = 800;
  const step = steps(frame, rate, firstCaptureMs, stepMs);
  const captured = new Set(CAPTURE_ORDER.slice(0, Math.max(0, Math.min(8, step + 1))));
  const current = CAPTURE_ORDER[Math.max(0, Math.min(7, step))] ?? 0;
  const previous = CAPTURE_ORDER[Math.max(0, Math.min(7, step - 1))] ?? current;
  const jump = pop(time, (firstCaptureMs + Math.max(0, step) * stepMs) / 1000, 420, 32);
  const cursor = thumbLeft(previous) + (thumbLeft(current) - thumbLeft(previous)) * jump;
  const cursorShown = ease(time, [(firstCaptureMs - 200) / 1000, firstCaptureMs / 1000], [0, 1]);
  const claim = pop(time, 3.2);
  return (
    <>
      <Heading kicker={headings.time.kicker} title={headings.time.title} />
      {Array.from({ length: 8 }, (_, index) => {
        const enter = pop(time, 0.3 + index * 0.05);
        const done = captured.has(index);
        return (
          <div
            key={`thumb-${String(index)}`}
            style={{
              position: 'absolute',
              left: thumbLeft(index),
              top: THUMB.top,
              width: THUMB.width,
              height: THUMB.height,
              borderRadius: 14,
              background: PANEL,
              border: `2px solid ${done ? CYAN : PANEL_EDGE}`,
              opacity: Math.min(1, enter),
              transform: `translateY(${(1 - enter) * 40}px)`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {/* Thumbnail i is the code scene's ball at t = i × 0.14 s: the same function, sampled. */}
            <BallTrack seconds={index * 0.14} width={150} height={44} />
            <div
              style={{
                position: 'absolute',
                left: 12,
                bottom: 8,
                fontFamily: MONO,
                fontSize: 17,
                color: MUTED,
              }}
            >
              t={(index * 0.14).toFixed(2)}
            </div>
            <div
              style={{
                position: 'absolute',
                right: 12,
                top: 6,
                fontSize: 22,
                fontWeight: 700,
                color: CYAN,
                opacity: done ? 1 : 0,
              }}
            >
              ✓
            </div>
          </div>
        );
      })}
      <div
        style={{
          position: 'absolute',
          left: cursor - 10,
          top: THUMB.top - 10,
          width: THUMB.width + 20,
          height: THUMB.height + 20,
          borderRadius: 20,
          border: `3px solid ${PINK}`,
          opacity: cursorShown * (step >= 8 ? ease(time, [3.3, 3.6], [1, 0]) : 1),
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: 560,
          textAlign: 'center',
          fontFamily: MONO,
          fontSize: 34,
          color: MUTED,
          opacity: ease(time, [0.8, 1.4], [0, 1]),
        }}
      >
        capture order: {CAPTURE_ORDER.slice(0, Math.max(0, Math.min(8, step + 1))).join(' → ')}
      </div>
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: 640,
          textAlign: 'center',
          fontSize: 46,
          fontWeight: 700,
          opacity: Math.min(1, claim),
          transform: `translateY(${(1 - claim) * 30}px)`,
        }}
      >
        <span style={{ fontFamily: MONO, color: CYAN }}>{timeFormula}</span>
        <span style={{ color: MUTED }}> — </span>
        {timeClaim}
      </div>
      <div
        style={{
          position: 'absolute',
          left: 100,
          right: 100,
          top: 760,
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'center',
          gap: 14,
        }}
      >
        {determinismModes.map((mode, index) => {
          const value = pop(time, 3.6 + index * 0.1);
          return (
            <div
              key={mode}
              style={{
                padding: '10px 18px',
                borderRadius: 999,
                background: `${PANEL}e6`,
                border: `1.5px solid ${PANEL_EDGE}`,
                fontFamily: MONO,
                fontSize: 22,
                opacity: Math.min(1, value),
                transform: `scale(${0.7 + 0.3 * value})`,
              }}
            >
              <span style={{ color: CYAN }}>✓ </span>
              {mode}
            </div>
          );
        })}
      </div>
    </>
  );
};

const NODE = { width: 330, height: 190, gap: 130, top: 430 } as const;
const nodeLeft = (index: number): number =>
  (1920 - (4 * NODE.width + 3 * NODE.gap)) / 2 + index * (NODE.width + NODE.gap);

export const PipelineScene = () => {
  const { time } = useSequence();
  const encoded = Math.round(ease(time, [1.4, 4.2], [0, 900], easing.easeInOutCubic));
  const footer = ease(time, [1.4, 1.9], [0, 1]);
  return (
    <>
      <Heading kicker={headings.pipeline.kicker} title={headings.pipeline.title} />
      {pipelineStages.map((stage, index) => {
        const value = pop(time, 0.35 + index * 0.18);
        const last = index === pipelineStages.length - 1;
        return (
          <div
            key={stage.title}
            style={{
              position: 'absolute',
              left: nodeLeft(index),
              top: NODE.top,
              width: NODE.width,
              height: NODE.height,
              borderRadius: 24,
              background: last ? ACCENT_GRADIENT : `${PANEL}f2`,
              border: last ? 'none' : `1.5px solid ${PANEL_EDGE}`,
              color: last ? INK : CHALK,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              opacity: Math.min(1, value),
              transform: `scale(${0.6 + 0.4 * value})`,
            }}
          >
            <div style={{ fontSize: 44, fontWeight: 800, letterSpacing: -1 }}>{stage.title}</div>
            <div
              style={{
                marginTop: 12,
                fontFamily: MONO,
                fontSize: 22,
                color: last ? INK : MUTED,
                opacity: last ? 0.75 : 1,
              }}
            >
              {stage.detail}
            </div>
          </div>
        );
      })}
      {[0, 1, 2].map((index) => {
        const drawn = ease(time, [0.7 + index * 0.18, 1.1 + index * 0.18], [0, 1]);
        const left = nodeLeft(index) + NODE.width + 16;
        const length = NODE.gap - 32;
        return (
          <div
            key={`link-${String(index)}`}
            style={{ position: 'absolute', left, top: NODE.top + NODE.height / 2 - 2 }}
          >
            <div
              style={{ width: length * drawn, height: 4, borderRadius: 2, background: VIOLET }}
            />
            {[0, 1, 2].map((packet) => (
              <div
                key={`packet-${String(packet)}`}
                style={{
                  position: 'absolute',
                  left: phase(time * 0.9 + packet / 3 + index * 0.17, 1) * (length - 14),
                  top: -6,
                  width: 16,
                  height: 16,
                  borderRadius: 4,
                  background: CYAN,
                  opacity: drawn >= 1 ? 1 : 0,
                }}
              />
            ))}
          </div>
        );
      })}
      <div
        style={{
          position: 'absolute',
          left: nodeLeft(0),
          right: 1920 - nodeLeft(3) - NODE.width,
          top: 720,
          opacity: footer,
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            fontFamily: MONO,
            fontSize: 28,
            color: MUTED,
          }}
        >
          <span>{pipelineSteps}</span>
          <span>
            <span style={{ color: CHALK }}>{String(encoded).padStart(3, ' ')}</span> / 900 frames
          </span>
        </div>
        <div
          style={{
            marginTop: 22,
            height: 12,
            borderRadius: 6,
            background: PANEL_EDGE,
            overflow: 'hidden',
          }}
        >
          <div
            style={{ width: `${(encoded / 900) * 100}%`, height: 12, background: ACCENT_GRADIENT }}
          />
        </div>
      </div>
    </>
  );
};

export const AgentScene = () => {
  const { time } = useSequence();
  const terminal = pop(time, 0.2);
  const { frame, rate } = useLocalFrame();
  const typed = revealed(frame, rate, 500, 64, renderCommand.length);
  const progress = ease(time, [2.0, 3.1], [0, 1], easing.linear);
  const bars = Math.round(progress * 24);
  const envelopeLines = revealed(frame, rate, 3250, 9, renderEnvelope.length);
  const envelopeShown = codeLength(renderEnvelope.slice(0, envelopeLines));
  return (
    <>
      <Heading kicker={headings.agent.kicker} title={headings.agent.title} />
      <Window
        title="zsh — coding agent"
        style={{
          left: 140,
          top: 340,
          width: 1060,
          height: 600,
          opacity: Math.min(1, terminal),
          transform: `translateY(${(1 - terminal) * 60}px)`,
        }}
      >
        <div style={{ padding: '30px 36px', fontFamily: MONO, fontSize: 23, lineHeight: 1.6 }}>
          <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
            <span style={{ color: PINK }}>$ </span>
            {renderCommand.slice(0, typed)}
            {typed < renderCommand.length ? (
              <span
                style={{
                  display: 'inline-block',
                  width: 13,
                  height: 26,
                  marginBottom: -5,
                  background: CYAN,
                }}
              />
            ) : null}
          </div>
          <div style={{ color: MUTED, marginTop: 14, opacity: time >= 2.0 ? 1 : 0 }}>
            rendering <span style={{ color: CYAN }}>{'█'.repeat(bars)}</span>
            {'░'.repeat(24 - bars)} {String(Math.round(progress * 900)).padStart(3, ' ')}/900
          </div>
          <div style={{ marginTop: 16 }}>
            <CodeView lines={renderEnvelope} shown={envelopeShown} fontSize={23} caret={false} />
          </div>
        </div>
      </Window>
      {agentFacts.map((fact, index) => {
        const value = pop(time, 1.0 + index * 0.25);
        return (
          <div
            key={fact.title}
            style={{
              position: 'absolute',
              left: 1260,
              top: 340 + index * 206,
              width: 520,
              height: 180,
              boxSizing: 'border-box',
              padding: '0 34px',
              borderRadius: 22,
              background: `${PANEL}e6`,
              border: `1.5px solid ${PANEL_EDGE}`,
              borderLeft: `6px solid ${index === 1 ? PINK : index === 2 ? AMBER : CYAN}`,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              opacity: Math.min(1, value),
              transform: `translateX(${(1 - value) * 80}px)`,
            }}
          >
            <div style={{ fontSize: 36, fontWeight: 750 }}>{fact.title}</div>
            <div style={{ marginTop: 10, fontFamily: MONO, fontSize: 22, color: MUTED }}>
              {fact.detail}
            </div>
          </div>
        );
      })}
    </>
  );
};

export const OutroScene = () => {
  const { time } = useSequence();
  const mark = pop(time, 0.1, 180, 14);
  const line = pop(time, 1.0);
  const pill = pop(time, 1.35);
  const url = ease(time, [1.8, 2.3], [0, 1]);
  const caret = phase(time, 1) < 0.5;
  return (
    <div style={centred}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 44 }}>
        <Mark size={150} style={{ opacity: Math.min(1, mark), transform: `scale(${mark})` }} />
        <Wordmark start={0.25} fontSize={150} />
      </div>
      <div
        style={{
          marginTop: 36,
          fontSize: 46,
          color: CHALK,
          opacity: Math.min(1, line),
          transform: `translateY(${(1 - line) * 24}px)`,
        }}
      >
        {tagline}
      </div>
      <div
        style={{
          marginTop: 56,
          padding: '22px 40px',
          borderRadius: 18,
          background: `${PANEL}f2`,
          border: `1.5px solid ${VIOLET}`,
          fontFamily: MONO,
          fontSize: 38,
          opacity: Math.min(1, pill),
          transform: `scale(${0.8 + 0.2 * pill})`,
        }}
      >
        <span style={{ color: PINK }}>$ </span>
        {installCommand}
        <span
          style={{
            display: 'inline-block',
            width: 20,
            height: 40,
            marginLeft: 8,
            marginBottom: -7,
            background: CYAN,
            opacity: caret ? 1 : 0,
          }}
        />
      </div>
      <div style={{ marginTop: 34, fontFamily: MONO, fontSize: 30, color: MUTED, opacity: url }}>
        {repositoryUrl}
      </div>
    </div>
  );
};
