import type { CSSProperties, ReactNode } from 'react';

import { useSequence, useTimeline, useTransitionProgress } from '@kimuson/motion-kit';
import { easing } from '@kimuson/motion-kit/motion';

import type { CodeLine } from './copy.ts';

import {
  ACCENT_GRADIENT,
  AMBER,
  CHALK,
  CYAN,
  DESIGN_HEIGHT,
  DESIGN_WIDTH,
  INK,
  MONO,
  MUTED,
  PANEL,
  PANEL_EDGE,
  PINK,
  SANS,
  TOKEN_COLOURS,
  VIOLET,
} from './look.ts';
import { ease, phase, pop, type Rate } from './motion.ts';

/** The 1920x1080 design grid, scaled to the Composition's own size so `promo-ci` draws the same
 * tree at half resolution. */
export const Stage = ({ children }: { readonly children: ReactNode }) => {
  const { width, height } = useTimeline();
  const scale = Math.min(width / DESIGN_WIDTH, height / DESIGN_HEIGHT);
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        overflow: 'hidden',
        background: INK,
        color: CHALK,
        fontFamily: SANS,
        // `--json` must read as two hyphens, not a ligature dash.
        fontVariantLigatures: 'none',
      }}
    >
      <div
        style={{
          position: 'absolute',
          left: (width - DESIGN_WIDTH * scale) / 2,
          top: (height - DESIGN_HEIGHT * scale) / 2,
          width: DESIGN_WIDTH,
          height: DESIGN_HEIGHT,
          transform: `scale(${scale})`,
          transformOrigin: '0 0',
        }}
      >
        {children}
      </div>
    </div>
  );
};

/** The current Sequence's local frame as a whole number and the Composition's exact rate, for
 * motion that steps on frame boundaries (typewriters, capture steps) rather than easing through them. */
export const useLocalFrame = (): { readonly frame: number; readonly rate: Rate } => {
  const { localFramePosition } = useSequence();
  const { frameRate } = useTimeline();
  return { frame: Math.floor(localFramePosition), rate: frameRate };
};

const formatTimecode = (seconds: number): string => {
  const whole = Math.floor(seconds);
  const minutes = Math.floor(whole / 60);
  const hundredths = Math.floor((seconds - whole) * 100);
  return `${String(minutes).padStart(2, '0')}:${String(whole % 60).padStart(2, '0')}.${String(hundredths).padStart(2, '0')}`;
};

/** Everything that moves for the whole clip, on Composition time: two drifting glows, a dot grid
 * sliding diagonally, the timecode and frame counter in the corner and the progress rule. */
export const Backdrop = () => {
  const { time, globalFrame, progress } = useTimeline();
  const drift = phase(time, 6) * 48;
  const glowA = { x: 0.3 + 0.12 * Math.sin(time * 0.45), y: 0.32 + 0.1 * Math.cos(time * 0.38) };
  const glowB = { x: 0.74 + 0.1 * Math.cos(time * 0.33), y: 0.7 + 0.12 * Math.sin(time * 0.41) };
  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: [
            `radial-gradient(900px circle at ${glowA.x * 100}% ${glowA.y * 100}%, ${VIOLET}33, transparent 60%)`,
            `radial-gradient(800px circle at ${glowB.x * 100}% ${glowB.y * 100}%, ${CYAN}24, transparent 60%)`,
          ].join(', '),
        }}
      />
      <div
        style={{
          position: 'absolute',
          inset: -48,
          backgroundImage: `radial-gradient(${CHALK}1f 1.5px, transparent 1.5px)`,
          backgroundSize: '48px 48px',
          transform: `translate(${drift}px, ${drift}px)`,
        }}
      />
      <div
        style={{
          position: 'absolute',
          right: 64,
          top: 48,
          fontFamily: MONO,
          fontSize: 22,
          color: MUTED,
          letterSpacing: 1,
        }}
      >
        {formatTimecode(time)} · frame {String(globalFrame).padStart(4, '0')}
      </div>
      <div
        style={{
          position: 'absolute',
          left: 64,
          top: 44,
          fontSize: 26,
          fontWeight: 700,
          letterSpacing: -0.5,
          display: 'flex',
          alignItems: 'center',
          gap: 14,
        }}
      >
        <Mark size={30} />
        motion-kit
      </div>
      <div
        style={{
          position: 'absolute',
          left: 0,
          bottom: 0,
          height: 6,
          width: `${progress * 100}%`,
          background: ACCENT_GRADIENT,
        }}
      />
    </div>
  );
};

/** The product mark: a rounded tile with a play triangle and a playhead rule. */
export const Mark = ({
  size,
  style,
}: {
  readonly size: number;
  readonly style?: CSSProperties;
}) => (
  <svg width={size} height={size} viewBox="0 0 64 64" style={style} aria-hidden="true">
    <defs>
      <linearGradient id={`mark-${String(size)}`} x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor={VIOLET} />
        <stop offset="1" stopColor={CYAN} />
      </linearGradient>
    </defs>
    <rect width="64" height="64" rx="16" fill={`url(#mark-${String(size)})`} />
    <path d="M24 18 L46 32 L24 46 Z" fill={INK} />
    <rect x="14" y="52" width="36" height="4" rx="2" fill={INK} opacity="0.55" />
  </svg>
);

type SceneShellProps = {
  /** The scene's own length and its two overlaps, in frames, as `placeScenes` gives them. */
  readonly frames: number;
  readonly enterFrames: number;
  readonly exitFrames: number;
  readonly children: ReactNode;
};

/** Fades a scene in over the overlap it shares with the previous one and out over the next one.
 * `TransitionSeries` keeps both scenes mounted during an overlap, so each scene owns its half of
 * the handoff and the `Transition` itself only draws the wipe. Both fades are measured in frames, the
 * unit the `Transition` is placed in, so they end on the same frame as the wipe at any rate. */
export const SceneShell = ({ frames, enterFrames, exitFrames, children }: SceneShellProps) => {
  const { localFramePosition } = useSequence();
  const enter = enterFrames > 0 ? ease(localFramePosition, [0, enterFrames], [0, 1]) : 1;
  const exit =
    exitFrames > 0
      ? ease(frames - localFramePosition, [0, exitFrames], [0, 1], easing.easeInCubic)
      : 1;
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        opacity: enter * exit,
        transform: `translateY(${(1 - enter) * 40 - (1 - exit) * 40}px)`,
      }}
    >
      {children}
    </div>
  );
};

/** The `Transition` child: a gradient bar that sweeps across the frame during the overlap. */
export const Wipe = () => {
  const progress = useTransitionProgress();
  const x = ease(progress, [0, 1], [-0.25, 1.05], easing.easeInOutCubic);
  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        bottom: 0,
        left: `${x * 100}%`,
        width: '18%',
        background: `linear-gradient(90deg, transparent, ${VIOLET}40, ${CYAN}66, transparent)`,
        opacity: Math.sin(progress * Math.PI),
      }}
    />
  );
};

type HeadingProps = { readonly kicker: string; readonly title: string; readonly at?: number };

/** A scene's kicker and title, popping in on a spring. */
export const Heading = ({ kicker, title, at = 0.15 }: HeadingProps) => {
  const { time } = useSequence();
  const kick = pop(time, at);
  const head = pop(time, at + 0.12);
  return (
    <div style={{ position: 'absolute', left: 140, top: 150, right: 140 }}>
      <div
        style={{
          fontFamily: MONO,
          fontSize: 26,
          color: CYAN,
          letterSpacing: 2,
          textTransform: 'uppercase',
          opacity: Math.min(1, kick),
          transform: `translateX(${(1 - kick) * -30}px)`,
        }}
      >
        {kicker}
      </div>
      <div
        style={{
          marginTop: 14,
          fontSize: 76,
          fontWeight: 800,
          letterSpacing: -2,
          opacity: Math.min(1, head),
          transform: `translateY(${(1 - head) * 36}px)`,
        }}
      >
        {title}
      </div>
    </div>
  );
};

type WindowProps = {
  readonly title: string;
  readonly style: CSSProperties;
  readonly children: ReactNode;
};

/** An editor or terminal window: three dots, a title and a dark body. */
export const Window = ({ title, style, children }: WindowProps) => (
  <div
    style={{
      position: 'absolute',
      background: `${PANEL}f2`,
      border: `1.5px solid ${PANEL_EDGE}`,
      borderRadius: 22,
      boxShadow: '0 40px 80px #00000066',
      overflow: 'hidden',
      ...style,
    }}
  >
    <div
      style={{
        height: 54,
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '0 22px',
        borderBottom: `1.5px solid ${PANEL_EDGE}`,
      }}
    >
      {[PINK, AMBER, CYAN].map((colour) => (
        <div
          key={colour}
          style={{ width: 14, height: 14, borderRadius: 7, background: colour, opacity: 0.85 }}
        />
      ))}
      <div style={{ marginLeft: 14, fontFamily: MONO, fontSize: 20, color: MUTED }}>{title}</div>
    </div>
    {children}
  </div>
);

type CodeViewProps = {
  readonly lines: readonly CodeLine[];
  /** Characters written so far, counted across lines; the rest is not drawn. */
  readonly shown: number;
  readonly fontSize: number;
  readonly caret: boolean;
};

/** Pre-tokenised code, typed out to `shown` characters, with a caret after the last one. */
export const CodeView = ({ lines, shown, fontSize, caret }: CodeViewProps) => {
  let budget = shown;
  return (
    <div style={{ fontFamily: MONO, fontSize, lineHeight: 1.65, whiteSpace: 'pre' }}>
      {lines.map((line, row) => {
        const length = line.reduce((sum, [, text]) => sum + text.length, 0);
        const visible = Math.min(length, budget);
        const typing = budget >= 0 && budget <= length;
        budget -= length + 1;
        let left = visible;
        return (
          <div key={`line-${String(row)}`} style={{ minHeight: fontSize * 1.65 }}>
            {line.map(([kind, text], index) => {
              const part = text.slice(0, Math.max(0, left));
              left -= text.length;
              return part.length === 0 ? null : (
                <span key={`token-${String(index)}`} style={{ color: TOKEN_COLOURS[kind] }}>
                  {part}
                </span>
              );
            })}
            {caret && typing ? (
              <span
                style={{
                  display: 'inline-block',
                  width: fontSize * 0.55,
                  height: fontSize * 1.1,
                  marginBottom: -fontSize * 0.2,
                  background: CYAN,
                }}
              />
            ) : null}
          </div>
        );
      })}
    </div>
  );
};

/** Total characters of tokenised code, counting one per line break, as `CodeView` counts them. */
export const codeLength = (lines: readonly CodeLine[]): number =>
  lines.reduce((sum, line) => sum + line.reduce((acc, [, text]) => acc + text.length, 0) + 1, 0);
