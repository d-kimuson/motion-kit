// The explainer's whole look in one place: the palette, the committed face, the regions every layer
// draws in, the portrait paths, the arithmetic helpers the layers share, and the credit lines the
// asset licensing ADR requires.
//
// Every layer draws in one fixed 1920x1080 design space (`DESIGN`), and `ExplainerScene` scales that
// space to the Composition's own size once. A region is therefore a constant rather than a fraction
// each layer resolves on its own, and the CI twin at 960x540 is the same picture at half size.
//
// Phase 2 replaces the values here with /theme tokens and /motion curves; the tree that reads them
// does not change (docs/design-doc/20261025-reference-examples.md, "explainer").
import {
  createFrameRate,
  createTimelineTime,
  frameToTime,
  timeToFrameNearest,
  toSeconds,
  type FrameRate,
} from '@kimuson/motion-kit';

import { type Expression } from './script.schema.ts';

export type { Expression };

/**
 * A dark navy ground with one accent per meaning: gold for a number the narration names, coral for
 * a loss, sky for the index line, and each character's own colour for whatever they say. Every value
 * is an opaque `#rrggbb` so the probe can paint the same names as flat surfaces.
 */
export const palette = {
  groundTop: '#0a1322',
  groundBottom: '#142a4c',
  panel: '#111e35',
  panelEdge: '#24375a',
  text: '#f3f6fb',
  muted: '#93a4bf',
  faint: '#4d5f7d',
  grid: '#1a2c4a',
  gold: '#ffd166',
  coral: '#ff6b6b',
  sky: '#4cc9f0',
  mint: '#5eead4',
} as const;

/**
 * The committed face (OFL-1.1, `assets/fonts/OFL.txt` beside it). A root-relative URL, never a
 * JavaScript import: the loading session serves the project root, and the determinism suite copies
 * the same path into its temporary project. The file is a variable font, registered once per weight
 * the video sets (`FONT_WEIGHTS`), because the readiness check probes one weight per face.
 */
export const FONT_FAMILY = 'Noto Sans JP';
export const FONT_SOURCE = '/examples/explainer/assets/fonts/NotoSansJP[wght].woff2';
export const FONT_WEIGHTS = [400, 700, 900] as const;
/** The fallback stack the probe draws with, where no font is loaded. */
export const FONT_STACK = "'Noto Sans JP', 'Hiragino Sans', 'Noto Sans CJK JP', sans-serif";

/** Generated or fetched, never committed: the fetched portraits, the voice, the music and the cues. */
export const LOCAL_ROOT = '/examples/explainer/assets.local';
/** The same directory as a path from the repository root, which is what an `AudioTrack` names. */
export const LOCAL_PATH = 'examples/explainer/assets.local';

export type AssetsMode = 'placeholder' | 'final';
export type Character = 'zundamon' | 'metan';

export const CHARACTERS: readonly Character[] = ['zundamon', 'metan'];

/** What each character is called on screen; the voice credit block uses the same names. */
export const characterName: Record<Character, string> = {
  zundamon: 'ずんだもん',
  metan: '四国めたん',
};

/** Each character's own colour: their name chip, their speaking glow, their subtitle's accent. */
export const characterColor: Record<Character, string> = {
  zundamon: '#9be15d',
  metan: '#ff7eb6',
};

/** The deep shade of the same hue: the outline a subtitle glyph is stroked with. */
export const characterInk: Record<Character, string> = {
  zundamon: '#1d4d12',
  metan: '#6e1648',
};

/** The one letter a placeholder avatar shows in place of the portrait. */
export const characterInitial: Record<Character, string> = {
  zundamon: 'ず',
  metan: 'め',
};

/** Which side each character stands on: Metan leads from the left, Zundamon answers on the right. */
export const characterSide: Record<Character, 'left' | 'right'> = {
  metan: 'left',
  zundamon: 'right',
};

/**
 * Where a fetched portrait lives: `<root>/portraits/<character>.png`, the VOICEVOX engine's own
 * character portrait (`fetch-assets.ts` step 2). Only `assets: 'final'` draws it; a placeholder
 * render draws an avatar badge instead, so a fresh clone never needs the file.
 */
export const portraitSource = (character: Character): string =>
  `${LOCAL_ROOT}/portraits/${character}.png`;

/** The voice clip a line's audio track points at, and `fetch-assets.ts` writes. */
export const voiceSource = (lineId: string): string => `${LOCAL_PATH}/voice/${lineId}.wav`;
/** The music bed and the transition cue `fetch-assets.ts` synthesises. */
export const musicSource = `${LOCAL_PATH}/music/bed.wav`;
export const whooshSource = `${LOCAL_PATH}/sfx/whoosh.wav`;

/** The credit block the asset ADR requires in this example's README and on the video's tail slide. */
export const CREDITS = [
  '音声: VOICEVOX:ずんだもん / VOICEVOX:四国めたん',
  '立ち絵: 坂本アヒル',
  'キャラクター: 東北ずん子・ずんだもんプロジェクト (https://zunko.jp/)',
  'フォント: Noto Sans JP (SIL Open Font License 1.1 — ./assets/fonts/OFL.txt)',
] as const;

/** A rectangle in the design space. */
export type Box = {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
};

/** The space every layer draws in; `ExplainerScene` scales it to the Composition's size. */
export const DESIGN = { width: 1920, height: 1080 } as const;

/**
 * The frame's regions. Nothing a scene draws leaves `STAGE`, the subtitle owns `SUBTITLE`, and the two
 * characters stand in the side lanes outside the stage's columns, so no layer can paint over another
 * one's words:
 *
 *   TOP_BAR     the video's title, the chapter and the progress segments
 *   STAGE       the panel a scene draws in
 *   SUBTITLE    one sentence at a time, under the stage
 *   PORTRAIT    each character's slot, feet below the frame, head beside the stage
 */
export const TOP_BAR: Box = { left: 330, top: 30, width: 1260, height: 56 };
export const STAGE: Box = { left: 330, top: 112, width: 1260, height: 652 };
export const SUBTITLE: Box = { left: 330, top: 792, width: 1260, height: 256 };
/** A scene's own padding inside the stage, and its heading's band. */
export const STAGE_PADDING = 56;
export const HEADING_HEIGHT = 96;
/** The box a scene's body (below its heading) lays out in, in stage-local pixels. */
export const SCENE_BODY: Box = {
  left: STAGE_PADDING,
  top: STAGE_PADDING + HEADING_HEIGHT,
  width: STAGE.width - 2 * STAGE_PADDING,
  height: STAGE.height - 2 * STAGE_PADDING - HEADING_HEIGHT,
};

/** A character's slot: the portrait is drawn this tall, from this top, centred on `centre`. */
export const PORTRAIT_TOP = 420;
export const PORTRAIT_HEIGHT = 720;
export const portraitCentre: Record<Character, number> = { metan: 168, zundamon: 1752 };
/** Each portrait's width over its height (the engine ships 255x500 and 300x500 PNGs). */
export const portraitAspect: Record<Character, number> = { zundamon: 255 / 500, metan: 300 / 500 };
/**
 * The opaque part of each portrait, as fractions of the image's width: the art is centred in a wide
 * transparent margin, so a lane is checked against what is drawn, not against the image's box.
 */
export const portraitInk: Record<Character, { readonly left: number; readonly right: number }> = {
  zundamon: { left: 0.243, right: 0.918 },
  metan: { left: 0.147, right: 0.863 },
};

/** Where each face sits in its portrait, as fractions of the image: the reactions float beside it. */
export const portraitFace: Record<Character, { readonly x: number; readonly y: number }> = {
  zundamon: { x: 0.47, y: 0.22 },
  metan: { x: 0.5, y: 0.17 },
};

/** The subtitle's type: its target size and line count, and the floor a long sentence shrinks to. */
export const SUBTITLE_SIZE = 60;
export const SUBTITLE_MIN_SIZE = 44;
export const SUBTITLE_LINES = 2;
export const SUBTITLE_MAX_LINES = 3;
export const SUBTITLE_LINE_HEIGHT = 1.42;
/** A three-line sentence is set tighter, so it still fits the plate's height. */
export const SUBTITLE_TIGHT_LINE_HEIGHT = 1.26;
export const SUBTITLE_PADDING_X = 48;
export const SUBTITLE_PADDING_TOP = 30;
export const SUBTITLE_PADDING_BOTTOM = 20;
/** How far the plate sits below the box's top: the speaker's name chip rides on that edge. */
export const SUBTITLE_PLATE_OFFSET = 22;

/**
 * Every length handed to the rasteriser is a whole pixel: Chromium antialiases a subpixel edge with
 * a coverage value it recomputes per paint, and the determinism gate compares PNG bytes.
 */
export const px = (value: number): number => Math.round(value);

/** A cheap deterministic hash of an integer onto 0..1, for per-tile variation that never changes. */
export const hash01 = (value: number): number => {
  const x = Math.sin(value * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

export const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

export const easeOutCubic = (progress: number): number => 1 - (1 - clamp01(progress)) ** 3;

export const easeInCubic = (progress: number): number => clamp01(progress) ** 3;

/** A frame count as a `Sequence` duration: a rational, so no seconds ever round. */
export const framesToTime = (frames: number, fps: number) => ({
  numerator: frames,
  denominator: fps,
});

const frameRateOf = (fps: number): FrameRate => {
  const rate = createFrameRate({ numerator: fps, denominator: 1 });
  if (!rate.ok) throw new Error(`${String(fps)} fps: ${rate.error.message}`);
  return rate.value;
};

/**
 * Seconds as the nearest whole frame, by the Time Module. The script's seconds are sums of decimal
 * seconds, so they carry float noise; a time farther than that noise from a frame is a script
 * error, and it throws rather than move a boundary.
 */
export const secondsToFrames = (seconds: number, fps: number): number => {
  const rate = frameRateOf(fps);
  const time = createTimelineTime(seconds);
  if (!time.ok) throw new Error(`${String(seconds)} s: ${time.error.message}`);
  const frames = timeToFrameNearest(time.value, rate);
  if (Math.abs(toSeconds(frameToTime(frames, rate)) - seconds) * fps > 1e-6)
    throw new Error(`${String(seconds)} s is not a whole frame at ${String(fps)} fps`);
  return Number(frames);
};

/** A whole frame count in seconds, converted by the Time Module rather than by hand. */
export const framesToSeconds = (frames: number, fps: number): number => {
  const time = createTimelineTime(framesToTime(frames, fps));
  if (!time.ok)
    throw new Error(`${String(frames)} frames at ${String(fps)} fps: ${time.error.message}`);
  return toSeconds(time.value);
};
