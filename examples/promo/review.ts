// The review scene's choreography as plain data and arithmetic: where each control of the mock
// preview sits, when each beat happens, and where the pointer is. Everything is a function of the
// scene's local seconds or whole frame, so the scene derives every pixel and keeps no state.

import { easing } from '@kimuson/motion-kit/motion';

import { ease, type Rate, revealed } from './motion.ts';

export type Point = readonly [number, number];
export type Rect = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

/** The scene's length and the handoff at its tail, as `promoStoryboard` gives them (315 and 12 frames
 * at 30 fps). */
export const REVIEW_SECONDS = 10.5;
export const REVIEW_EXIT_SECONDS = 0.4;

/** The mock preview's body, below its title bar, in its own pixels. Every rect below is in it. */
export const PREVIEW_BODY: Rect = { x: 0, y: 0, width: 980, height: 606 };

export const layout = {
  /** The Composition under review, 1920x1080 drawn at a third. */
  stage: { x: 20, y: 20, width: 640, height: 360 },
  panel: { x: 680, y: 20, width: 280, height: 360 },
  /** The `h1` the reviewer clicks, before the agent grows it. */
  title: { x: 120, y: 112, width: 440, height: 80 },
  draft: { x: 692, y: 68, width: 256, height: 170 },
  save: { x: 880, y: 202, width: 56, height: 26 },
  copy: { x: 692, y: 274, width: 256, height: 34 },
  comment: { x: 836, y: 398, width: 124, height: 32 },
  timeline: { x: 20, y: 452, width: 940, height: 134 },
} as const satisfies Record<string, Rect>;

export type Control = keyof typeof layout;

/** The Composition under review: 30 fps and 300 frames. Playback runs from `START_FRAME` and
 * pauses on `PAUSE_FRAME`, the frame the comment is about. */
export const HELLO_FPS = 30;
export const HELLO_FRAMES = 300;
export const START_FRAME = 6;
export const PAUSE_FRAME = 36;

/** When each beat happens, in the scene's seconds. */
export const beats = {
  launch: 0.35,
  url: 1.25,
  preview: 1.45,
  play: 1.6,
  pause: 1.6 + (PAUSE_FRAME - START_FRAME) / HELLO_FPS,
  commentMode: 3.1,
  hover: 3.7,
  select: 3.95,
  type: 4.1,
  save: 5.5,
  copy: 5.9,
  paste: 6.2,
  read: 6.7,
  edit: 7.0,
  reload: 7.6,
  run: 8.0,
  rendered: 8.5,
  reply: 8.8,
} as const;

/** The beats the agent's transcript lines hang on. */
export type AgentBeat = 'paste' | 'read' | 'edit' | 'run' | 'rendered' | 'reply';

const ms = (seconds: number): number => Math.round(seconds * 1000);

/** Characters of the `preview` command typed so far: 80 a second from `beats.launch`. */
export const launchTyped = (frame: number, rate: Rate, total: number): number =>
  revealed(frame, rate, ms(beats.launch), 80, total);

/** The preview's playhead: real-time playback from `START_FRAME`, held on `PAUSE_FRAME`. */
export const previewFrame = (frame: number, rate: Rate): number =>
  START_FRAME + revealed(frame, rate, ms(beats.play), HELLO_FPS, PAUSE_FRAME - START_FRAME);

/** Characters of the review comment typed so far: 32 a second from `beats.type`. */
export const commentTyped = (frame: number, rate: Rate, total: number): number =>
  revealed(frame, rate, ms(beats.type), 32, total);

/** Comment mode is on from the click on Comment until the click that picks the title. */
export const commentMode = (time: number): boolean =>
  time >= beats.commentMode && time < beats.select;

// The pointer clicks right of and below a control's centre, so the arrow, which hangs down and to
// the right of its tip, leaves the label readable.
const aim = (rect: Rect): Point => [rect.x + rect.width * 0.8, rect.y + rect.height * 0.7];

/** The four clicks, each on the control its beat names. */
export const clicks: readonly { readonly at: number; readonly target: Control }[] = [
  { at: beats.commentMode, target: 'comment' },
  { at: beats.select, target: 'title' },
  { at: beats.save, target: 'save' },
  { at: beats.copy, target: 'copy' },
];

// Where the pointer rests first, then each move: it leaves at `depart` and arrives at `arrive`,
// before the click on that control. The moves never overlap.
const pointerStart: Point = [560, 300];
const pointerMoves: readonly { readonly depart: number; readonly arrive: number; to: Point }[] = [
  { depart: 2.65, arrive: 3.0, to: aim(layout.comment) },
  { depart: 3.25, arrive: beats.hover, to: aim(layout.title) },
  { depart: 5.15, arrive: 5.45, to: aim(layout.save) },
  { depart: 5.6, arrive: 5.85, to: aim(layout.copy) },
];

export const pointerAt = (time: number): Point =>
  pointerMoves.reduce<Point>(
    ([x, y], move) => [
      ease(time, [move.depart, move.arrive], [x, move.to[0]], easing.easeInOutCubic),
      ease(time, [move.depart, move.arrive], [y, move.to[1]], easing.easeInOutCubic),
    ],
    pointerStart,
  );

/** The pointer fades in once playback has paused and out after the last click. */
export const pointerShown = (time: number): number =>
  ease(time, [beats.pause, beats.pause + 0.15], [0, 1]) *
  ease(time, [beats.copy + 0.2, beats.copy + 0.45], [1, 0]);

/** How far the ring of the latest click has spread, 0 to 1, and 0 when no click is recent. */
export const clickRing = (time: number): number => {
  const latest = clicks.findLast((click) => click.at <= time);
  if (latest === undefined || time - latest.at > 0.3) return 0;
  return (time - latest.at) / 0.3;
};

/** Seconds between two transcript lines of the same beat. */
const LINE_STAGGER = 0.1;

/** When transcript line `index` appears: its beat, plus a stagger for each earlier line of it. */
export const lineShownAt = (
  lines: readonly { readonly beat: AgentBeat }[],
  index: number,
): number => {
  const beat = lines[index]?.beat ?? 'paste';
  const before = lines.slice(0, index).filter((line) => line.beat === beat).length;
  return beats[beat] + before * LINE_STAGGER;
};

/** How far the title has grown into the agent's edit, 0 to 1: nothing until the preview reloads. */
export const titleGrowth = (time: number): number =>
  ease(time, [beats.reload, beats.reload + 0.6], [0, 1]);
