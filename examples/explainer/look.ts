// The explainer's whole look in one place: the palette, the committed face, the sprite paths, the
// two arithmetic helpers the layers share, and the credit lines the asset licensing ADR requires.
//
// Phase 2 replaces the values here with /theme tokens and /motion curves; the tree that reads them
// does not change (docs/design-doc/20261025-reference-examples.md, "explainer").
import { type Expression } from './script.schema.ts';

export type { Expression };

/** Warm off-white ground, one ink, one accent: the acceptance look's palette. */
export const GROUND = '#faf6ee';
export const PANEL = '#fffdf8';
export const INK = '#1b1a17';
export const MUTED = '#6b6558';
export const ACCENT = '#c2410c';
export const RULE = '#e3dccd';

/**
 * The committed face (OFL-1.1, `assets/fonts/OFL.txt` beside it). A root-relative URL, never a
 * JavaScript import: the loading session serves the project root, and the determinism suite copies
 * the same path into its temporary project.
 */
export const FONT_FAMILY = 'Noto Sans JP';
export const FONT_SOURCE = '/examples/explainer/assets/fonts/NotoSansJP[wght].woff2';
/** The fallback stack the probe draws with, where no font is loaded. */
export const FONT_STACK = "'Noto Sans JP', 'Hiragino Sans', 'Noto Sans CJK JP', sans-serif";

/** Generated or fetched, never committed: the FFmpeg placeholders and step 2's fetched sprites. */
export const SPRITE_ROOT = '/examples/explainer/assets.local/sprites';
/** The tone bed and the voice clips step 1 / step 2 write. */
export const VOICE_ROOT = 'examples/explainer/assets.local/voice';

export type AssetsMode = 'placeholder' | 'final';
export type Character = 'zundamon' | 'metan';
export type Mouth = 'rest' | 'open';

export const CHARACTERS: readonly Character[] = ['zundamon', 'metan'];
export const EXPRESSIONS: readonly Expression[] = [
  'normal',
  'happy',
  'surprised',
  'thinking',
  'wink',
  'serious',
];
export const MOUTHS: readonly Mouth[] = ['rest', 'open'];

/** What each character is called on screen; the voice credit block uses the same names. */
export const characterName: Record<Character, string> = {
  zundamon: 'ずんだもん',
  metan: '四国めたん',
};

/** The flat colour a placeholder sprite or a probe surface is drawn in. */
export const characterColor: Record<Character, string> = {
  zundamon: '#4f9d5d',
  metan: '#8b6ad6',
};

/**
 * The 60 % speaker highlight as a solid colour: `characterColor` blended over `GROUND` here, at
 * module load, so the probe draws the dim state as opaque paint instead of a fractional alpha.
 */
export const characterDimColor: Record<Character, string> = {
  zundamon: '#93c197',
  metan: '#b7a2e0',
};

/** Where one sprite frame lives: `<mode>/<character>/<expression>-<mouth>.png` under the root. */
export const spriteSource = (
  assets: AssetsMode,
  character: Character,
  expression: Expression,
  mouth: Mouth,
): string => `${SPRITE_ROOT}/${assets}/${character}/${expression}-${mouth}.png`;

/** The voice clip a line's audio track points at, and step 1 / step 2 write. */
export const voiceSource = (lineId: string): string => `${VOICE_ROOT}/${lineId}.wav`;

/** The credit block the asset ADR requires in this example's README and on the video's tail slide. */
export const CREDITS = [
  '音声: VOICEVOX:ずんだもん / VOICEVOX:四国めたん',
  '立ち絵: 坂本アヒル',
  'キャラクター: 東北ずん子・ずんだもんプロジェクト (https://zunko.jp/)',
  'フォント: Noto Sans JP (SIL Open Font License 1.1 — ./assets/fonts/OFL.txt)',
] as const;

/**
 * Every length handed to the rasteriser is a whole pixel: Chromium antialiases a subpixel edge with
 * a coverage value it recomputes per paint, and the determinism gate compares PNG bytes.
 */
export const px = (value: number): number => Math.round(value);

export const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

export const easeOutCubic = (progress: number): number => 1 - (1 - clamp01(progress)) ** 3;

export const easeInCubic = (progress: number): number => clamp01(progress) ** 3;

/** 0.15 s of rest, then 0.15 s of open mouth: the mouth axis with no lip-sync asset contract. */
export const mouthSwitchSeconds = 0.15;

/** The mouth a speaking sprite holds at `seconds` into its own line. */
export const mouthAt = (seconds: number): Mouth =>
  Math.floor(Math.max(0, seconds) / mouthSwitchSeconds) % 2 === 0 ? 'rest' : 'open';

/** A frame count as a `Sequence` duration: a rational, so no seconds ever round. */
export const framesToTime = (frames: number, fps: number) => ({
  numerator: frames,
  denominator: fps,
});
