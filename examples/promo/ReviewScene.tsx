import type { CSSProperties, ReactNode } from 'react';

import { useSequence } from '@kimuson/motion-kit';

import {
  headings,
  helloSource,
  helloTitle,
  launchCommand,
  previewHost,
  previewServing,
  reviewComment,
  reviewTranscript,
  type TranscriptLine,
} from './copy.ts';
import {
  AMBER,
  CHALK,
  CYAN,
  INK,
  MAGENTA,
  MONO,
  MUTED,
  PANEL,
  PANEL_EDGE,
  PINK,
  VIOLET,
} from './look.ts';
import { ease, phase, pop } from './motion.ts';
import { Heading, useLocalFrame, Window } from './parts.tsx';
import {
  beats,
  clickRing,
  commentMode,
  commentTyped,
  HELLO_FPS,
  HELLO_FRAMES,
  launchTyped,
  layout,
  lineShownAt,
  PAUSE_FRAME,
  pointerAt,
  pointerShown,
  previewFrame,
  type Rect,
  titleGrowth,
} from './review.ts';

const WINDOW_TOP = 340;
const PREVIEW_LEFT = 140;
const PREVIEW_WIDTH = 980;
const AGENT_LEFT = 1150;
const AGENT_WIDTH = 630;
const WINDOW_HEIGHT = 660;

const box = (rect: Rect): CSSProperties => ({
  position: 'absolute',
  left: rect.x,
  top: rect.y,
  width: rect.width,
  height: rect.height,
  boxSizing: 'border-box',
});

/** `mm:ss.hh` of a frame of the 30 fps Composition under review. */
const clock = (frame: number): string => {
  const total = Math.floor((frame * 100) / HELLO_FPS);
  const whole = Math.floor(total / 100);
  return `${String(Math.floor(whole / 60)).padStart(2, '0')}:${String(whole % 60).padStart(2, '0')}.${String(total % 100).padStart(2, '0')}`;
};

const Caret = ({ size, colour = CYAN }: { readonly size: number; readonly colour?: string }) => (
  <span
    style={{
      display: 'inline-block',
      width: size * 0.55,
      height: size * 1.1,
      marginBottom: -size * 0.2,
      background: colour,
    }}
  />
);

/** The shell that starts the preview; the preview window takes its place once it serves. */
const LaunchTerminal = () => {
  const { time } = useSequence();
  const { frame, rate } = useLocalFrame();
  const shown = pop(time, 0.2) * ease(time, [beats.preview - 0.05, beats.preview + 0.2], [1, 0]);
  const typed = launchTyped(frame, rate, launchCommand.length);
  return (
    <Window
      title="zsh — ~/hello"
      style={{
        left: PREVIEW_LEFT,
        top: WINDOW_TOP,
        width: PREVIEW_WIDTH,
        height: 170,
        opacity: Math.max(0, Math.min(1, shown)),
        transform: `translateY(${(1 - Math.min(1, shown)) * 30}px)`,
      }}
    >
      <div style={{ padding: '24px 32px', fontFamily: MONO, fontSize: 21, lineHeight: 1.6 }}>
        <div>
          <span style={{ color: PINK }}>$ </span>
          {launchCommand.slice(0, typed)}
          {typed < launchCommand.length ? <Caret size={21} /> : null}
        </div>
        <div style={{ color: MUTED, opacity: time >= beats.url ? 1 : 0 }}>{previewServing}</div>
      </div>
    </Window>
  );
};

/** The Composition under review: a title over a bouncing ball, drawn at a third of 1920x1080. */
const HelloStage = ({ shownFrame }: { readonly shownFrame: number }) => {
  const { time } = useSequence();
  const growth = titleGrowth(time);
  const along = shownFrame / PAUSE_FRAME;
  const reload =
    ease(time, [beats.reload, beats.reload + 0.15], [0, 1]) *
    ease(time, [beats.reload + 1.0, beats.reload + 1.3], [1, 0]);
  const stage = layout.stage;
  const title = layout.title;
  return (
    <div
      style={{
        ...box(stage),
        overflow: 'hidden',
        borderRadius: 6,
        background: `radial-gradient(420px circle at 30% 30%, ${VIOLET}40, transparent 70%), #0d1020`,
      }}
    >
      <div
        style={{
          ...box({ ...title, x: title.x - stage.x, y: title.y - stage.y }),
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          whiteSpace: 'nowrap',
          fontSize: 40 + 20 * growth,
          fontWeight: 800,
          letterSpacing: -1,
          color: `color-mix(in srgb, ${AMBER} ${String(growth * 100)}%, ${CHALK})`,
        }}
      >
        {helloTitle}
      </div>
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: 192,
          textAlign: 'center',
          fontFamily: MONO,
          fontSize: 14,
          color: MUTED,
        }}
      >
        a motion-kit Composition
      </div>
      <div
        style={{
          position: 'absolute',
          left: 70 + along * 460,
          top: 290 - 46 * Math.abs(Math.sin(along * Math.PI * 2)),
          width: 30,
          height: 30,
          borderRadius: 15,
          background: CYAN,
        }}
      />
      <div
        style={{
          position: 'absolute',
          right: 12,
          top: 12,
          padding: '4px 10px',
          borderRadius: 6,
          background: `${INK}cc`,
          fontFamily: MONO,
          fontSize: 13,
          color: CYAN,
          opacity: reload,
        }}
      >
        ↻ reloaded
      </div>
    </div>
  );
};

/** Comment mode's marks over the stage: the magenta frame, the hint, and the hovered element. */
const CommentOverlay = () => {
  const { time } = useSequence();
  const on = commentMode(time);
  const hovered = time >= beats.hover && time < beats.save;
  const stage = layout.stage;
  const title = layout.title;
  return (
    <>
      <div
        style={{
          ...box({
            x: stage.x - 3,
            y: stage.y - 3,
            width: stage.width + 6,
            height: stage.height + 6,
          }),
          border: `3px solid ${MAGENTA}`,
          borderRadius: 8,
          opacity: on ? 1 : 0,
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: stage.x,
          width: stage.width,
          top: stage.y + stage.height - 44,
          display: 'flex',
          justifyContent: 'center',
          opacity: on ? 1 : 0,
        }}
      >
        <div
          style={{
            padding: '6px 14px',
            borderRadius: 8,
            background: `${INK}e6`,
            border: `1.5px solid ${MAGENTA}`,
            fontSize: 14,
            color: CHALK,
          }}
        >
          Click an element to comment on it · Esc to stop
        </div>
      </div>
      <div
        style={{
          ...box(title),
          background: `${MAGENTA}26`,
          outline: `2px solid ${MAGENTA}`,
          opacity: hovered ? 1 : 0,
        }}
      >
        <div
          style={{
            position: 'absolute',
            left: -2,
            top: -26,
            padding: '2px 8px',
            borderRadius: 4,
            background: MAGENTA,
            fontFamily: MONO,
            fontSize: 13,
            color: CHALK,
            whiteSpace: 'nowrap',
          }}
        >
          h1 · {helloSource}
        </div>
      </div>
    </>
  );
};

const Button = ({
  rect,
  active,
  children,
}: {
  readonly rect: Rect;
  readonly active: boolean;
  readonly children: ReactNode;
}) => (
  <div
    style={{
      ...box(rect),
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      borderRadius: 6,
      border: `1.5px solid ${active ? MAGENTA : PANEL_EDGE}`,
      background: active ? `${MAGENTA}33` : '#ffffff0d',
      fontSize: 14,
      color: CHALK,
    }}
  >
    {children}
  </div>
);

/** The side panel: the Composition's info until the click, then the comment draft and the saved
 * comment, with Copy Markdown under it. */
const SidePanel = () => {
  const { time } = useSequence();
  const { frame, rate } = useLocalFrame();
  const open = time >= beats.select;
  const saved = time >= beats.save;
  const copied = time >= beats.copy && time < beats.copy + 1.2;
  const card = pop(time, beats.select);
  const typed = commentTyped(frame, rate, reviewComment.length);
  const panel = layout.panel;
  const draft = layout.draft;
  const tabs = ['Info', 'Sequences', 'Comments'];
  return (
    <>
      <div
        style={{
          ...box(panel),
          borderRadius: 6,
          background: '#ffffff08',
          border: `1.5px solid ${PANEL_EDGE}`,
        }}
      >
        <div style={{ display: 'flex', gap: 4, padding: 6 }}>
          {tabs.map((tab) => {
            const active = open ? tab === 'Comments' : tab === 'Info';
            return (
              <div
                key={tab}
                style={{
                  padding: '4px 10px',
                  borderRadius: 5,
                  fontSize: 14,
                  color: active ? CHALK : MUTED,
                  background: active ? '#ffffff14' : 'transparent',
                }}
              >
                {tab}
              </div>
            );
          })}
        </div>
        {open ? null : (
          <div style={{ padding: '10px 14px', fontSize: 14, lineHeight: 2, color: MUTED }}>
            {[
              ['Composition', 'hello'],
              ['Size', '1920×1080'],
              ['Frame rate', `${String(HELLO_FPS)} fps`],
              ['Duration', `${String(HELLO_FRAMES)} frames`],
            ].map(([key, value]) => (
              <div key={key} style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>{key}</span>
                <span style={{ color: CHALK, fontFamily: MONO }}>{value}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      {open ? (
        <>
          <div
            style={{
              ...box(draft),
              height: saved ? 'auto' : draft.height,
              padding: 10,
              borderRadius: 8,
              background: PANEL,
              border: `1.5px solid ${saved ? PANEL_EDGE : MAGENTA}`,
              opacity: Math.min(1, card),
              transform: `scale(${0.94 + 0.06 * card})`,
              transformOrigin: 'top center',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                fontFamily: MONO,
                fontSize: 12,
              }}
            >
              <span style={{ fontWeight: 700 }}>{clock(PAUSE_FRAME)}</span>
              <span style={{ color: MUTED }}>h1 · {helloSource}</span>
            </div>
            <div
              style={{
                marginTop: 8,
                height: saved ? 'auto' : 92,
                padding: saved ? 0 : 8,
                boxSizing: 'border-box',
                borderRadius: 6,
                border: saved ? 'none' : `1.5px solid ${PANEL_EDGE}`,
                background: saved ? 'transparent' : INK,
                fontSize: saved ? 16 : 15,
                lineHeight: 1.4,
                color: typed === 0 ? MUTED : CHALK,
              }}
            >
              {typed === 0 ? 'What should change here?' : reviewComment.slice(0, typed)}
              {!saved && typed > 0 && typed < reviewComment.length ? <Caret size={15} /> : null}
            </div>
            {saved ? (
              <div style={{ marginTop: 10, fontFamily: MONO, fontSize: 12, color: MUTED }}>
                One frame
              </div>
            ) : (
              <div
                style={{
                  marginTop: 10,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  fontSize: 13,
                  color: MUTED,
                }}
              >
                <span
                  style={{ padding: '2px 8px', borderRadius: 5, border: `1px solid ${PANEL_EDGE}` }}
                >
                  One frame
                </span>
                <span style={{ marginLeft: 'auto', marginRight: 66, color: CHALK }}>Cancel</span>
              </div>
            )}
          </div>
          {saved ? null : (
            <Button rect={layout.save} active={false}>
              Save
            </Button>
          )}
          <Button rect={layout.copy} active={copied}>
            {copied ? '✓ Copied' : 'Copy Markdown'}
          </Button>
        </>
      ) : null}
    </>
  );
};

/** The transport row and the timeline under the stage. */
const Transport = ({ shownFrame }: { readonly shownFrame: number }) => {
  const { time } = useSequence();
  const playing = time >= beats.play && time < beats.pause;
  const last = HELLO_FRAMES - 1;
  const timeline = layout.timeline;
  const laneLeft = timeline.x + 110;
  const laneWidth = timeline.width - 120;
  const at = (frame: number) => laneLeft + (frame / HELLO_FRAMES) * laneWidth;
  const lanes = [
    { name: 'title', from: 0, to: 150, row: 0 },
    { name: 'ball', from: 0, to: 300, row: 1 },
  ];
  return (
    <>
      <div
        style={{
          position: 'absolute',
          left: 20,
          top: 398,
          width: 600,
          height: 32,
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          fontFamily: MONO,
          fontSize: 15,
        }}
      >
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: 6,
            background: '#ffffff1a',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 14,
          }}
        >
          {playing ? '❚❚' : '▶'}
        </div>
        <span>
          {clock(shownFrame)} <span style={{ color: MUTED }}>/ {clock(HELLO_FRAMES)}</span>
        </span>
        <div
          style={{
            position: 'relative',
            flex: 1,
            height: 4,
            borderRadius: 2,
            background: PANEL_EDGE,
          }}
        >
          <div
            style={{
              position: 'absolute',
              left: `${String((shownFrame / last) * 100)}%`,
              top: -5,
              width: 14,
              height: 14,
              marginLeft: -7,
              borderRadius: 7,
              background: CHALK,
            }}
          />
        </div>
      </div>
      <div
        style={{
          position: 'absolute',
          left: 640,
          top: 398,
          height: 32,
          display: 'flex',
          alignItems: 'center',
          fontFamily: MONO,
          fontSize: 15,
          color: MUTED,
        }}
      >
        frame {shownFrame} / {last}
      </div>
      <Button rect={layout.comment} active={commentMode(time)}>
        ✎ Comment
      </Button>
      <div style={{ ...box(timeline), borderTop: `1.5px solid ${PANEL_EDGE}` }}>
        {[0, 2, 4, 6, 8].map((second) => (
          <div
            key={second}
            style={{
              position: 'absolute',
              left: at(second * HELLO_FPS) - timeline.x,
              top: 8,
              fontFamily: MONO,
              fontSize: 12,
              color: MUTED,
            }}
          >
            {clock(second * HELLO_FPS).slice(0, 5)}
          </div>
        ))}
        {['Comments', 'Sequences'].map((label, row) => (
          <div
            key={label}
            style={{
              position: 'absolute',
              left: 0,
              top: 34 + row * 34,
              fontSize: 13,
              color: MUTED,
            }}
          >
            {label}
          </div>
        ))}
        <div
          style={{
            position: 'absolute',
            left: at(PAUSE_FRAME) - timeline.x - 7,
            top: 36,
            width: 14,
            height: 14,
            borderRadius: 7,
            background: MAGENTA,
            opacity: time >= beats.save ? 1 : 0,
          }}
        />
        {lanes.map((lane) => (
          <div
            key={lane.name}
            style={{
              position: 'absolute',
              left: at(lane.from) - timeline.x,
              width: ((lane.to - lane.from) / HELLO_FRAMES) * laneWidth,
              top: 66 + lane.row * 30,
              height: 24,
              boxSizing: 'border-box',
              padding: '0 8px',
              borderRadius: 5,
              background: '#1d3a9e',
              fontSize: 13,
              lineHeight: '24px',
              color: CHALK,
            }}
          >
            {lane.name}
          </div>
        ))}
        <div
          style={{
            position: 'absolute',
            left: at(shownFrame) - timeline.x - 1,
            top: 4,
            bottom: 0,
            width: 2,
            background: PINK,
          }}
        />
      </div>
    </>
  );
};

/** The reviewer's pointer and the ring each click leaves. */
const Pointer = () => {
  const { time } = useSequence();
  const [x, y] = pointerAt(time);
  const ring = clickRing(time);
  return (
    <div style={{ position: 'absolute', left: x, top: y, opacity: pointerShown(time) }}>
      <div
        style={{
          position: 'absolute',
          left: -22 * ring,
          top: -22 * ring,
          width: 44 * ring,
          height: 44 * ring,
          borderRadius: '50%',
          border: `3px solid ${CHALK}`,
          opacity: ring > 0 ? 1 - ring : 0,
        }}
      />
      <svg
        width="30"
        height="36"
        viewBox="0 0 30 36"
        style={{ position: 'absolute', left: -3, top: -2 }}
      >
        <path
          d="M3 2 L3 29 L10 22 L15 33 L20 31 L15 20 L25 20 Z"
          fill={CHALK}
          stroke={INK}
          strokeWidth="2"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
};

/** The preview page: stage, side panel, transport and timeline, and the reviewer's pointer. */
const MockPreview = () => {
  const { time } = useSequence();
  const { frame, rate } = useLocalFrame();
  const shownFrame = previewFrame(frame, rate);
  const shown = pop(time, beats.preview);
  return (
    <Window
      title={`${previewHost} — motion-kit preview`}
      style={{
        left: PREVIEW_LEFT,
        top: WINDOW_TOP,
        width: PREVIEW_WIDTH,
        height: WINDOW_HEIGHT,
        opacity: Math.min(1, shown),
        transform: `translateY(${(1 - shown) * 50}px) scale(${0.96 + 0.04 * shown})`,
      }}
    >
      <div style={{ position: 'relative', height: WINDOW_HEIGHT - 54 }}>
        <HelloStage shownFrame={shownFrame} />
        <CommentOverlay />
        <SidePanel />
        <Transport shownFrame={shownFrame} />
        <Pointer />
      </div>
    </Window>
  );
};

const indented: CSSProperties = { color: MUTED, paddingLeft: 30 };
const lineStyle: Readonly<Record<TranscriptLine['kind'], CSSProperties>> = {
  prompt: {},
  quote: {},
  tool: {},
  detail: indented,
  removed: { color: PINK, background: `${PINK}1f`, paddingLeft: 30 },
  added: { color: CYAN, background: `${CYAN}1f`, paddingLeft: 30 },
  result: indented,
  reply: {},
};

const linePrefix: Readonly<Record<TranscriptLine['kind'], ReactNode>> = {
  prompt: <span style={{ color: PINK }}>{'> '}</span>,
  quote: <span style={{ color: MUTED }}>{'  '}</span>,
  tool: <span style={{ color: CYAN }}>● </span>,
  detail: null,
  removed: '- ',
  added: '+ ',
  result: null,
  reply: <span style={{ color: CHALK }}>● </span>,
};

/** The coding agent: idle until the review is pasted in, then reading, editing and re-rendering. */
const AgentSession = () => {
  const { time } = useSequence();
  const shown = pop(time, 0.45);
  const caret = phase(time, 1) < 0.5;
  const visible = reviewTranscript.filter(
    (_, index) => lineShownAt(reviewTranscript, index) <= time,
  );
  const pasted = visible.filter((line) => line.beat === 'paste');
  const worked = visible.filter((line) => line.beat !== 'paste');
  const busy = time >= beats.paste && time < beats.reply;
  const line = (item: TranscriptLine, index: number) => (
    <div
      key={`line-${String(index)}`}
      style={{ whiteSpace: 'pre-wrap', color: CHALK, ...lineStyle[item.kind] }}
    >
      {linePrefix[item.kind]}
      {item.text}
    </div>
  );
  return (
    <Window
      title="coding agent — ~/hello"
      style={{
        left: AGENT_LEFT,
        top: WINDOW_TOP,
        width: AGENT_WIDTH,
        height: WINDOW_HEIGHT,
        opacity: Math.min(1, shown),
        transform: `translateY(${(1 - shown) * 60}px)`,
      }}
    >
      <div style={{ padding: '22px 26px', fontFamily: MONO, fontSize: 18, lineHeight: 1.6 }}>
        {pasted.length > 0 ? (
          <div
            style={{
              padding: '10px 14px',
              marginBottom: 14,
              borderRadius: 10,
              background: '#ffffff0a',
              border: `1.5px solid ${PANEL_EDGE}`,
            }}
          >
            {pasted.map(line)}
          </div>
        ) : null}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>{worked.map(line)}</div>
        <div style={{ marginTop: 16, color: MUTED }}>
          {busy ? (
            <span style={{ color: VIOLET }}>
              working{'.'.repeat(1 + Math.floor(phase(time, 0.9) * 3))}
            </span>
          ) : (
            <>
              <span style={{ color: PINK }}>{'> '}</span>
              {caret ? <Caret size={18} colour={MUTED} /> : null}
            </>
          )}
        </div>
      </div>
    </Window>
  );
};

/** The preview's review loop: start the preview, comment on an element, paste the review into a
 * coding agent, and watch the preview reload with its fix. */
export const ReviewScene = () => (
  <>
    <Heading kicker={headings.review.kicker} title={headings.review.title} />
    <LaunchTerminal />
    <MockPreview />
    <AgentSession />
  </>
);
