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

/** Generated or fetched, never committed: step 2's fetched sprites and step 1's silent voice clips. */
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

/** The colour a placeholder character or a probe surface is drawn in. */
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

/**
 * Where one fetched sprite frame lives: `<root>/final/<character>/<expression>-<mouth>.png`. Only
 * the fetched set is an image: `assets: 'placeholder'` draws its character in the sprite layer
 * instead (`Sprites.tsx`), so there is no generated placeholder image to address.
 */
export const spriteSource = (character: Character, expression: Expression, mouth: Mouth): string =>
  `${SPRITE_ROOT}/final/${character}/${expression}-${mouth}.png`;

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

/**
 * The frame's one set of safe areas, as fractions of the frame, resolved to whole pixels by
 * `safeArea`. Every layer reads them, which is what stops the subtitle band from covering a slide:
 *
 *   body       SAFE_TOP .. SLIDE_BOTTOM — the only rows a slide may paint
 *   band       BAND_TOP .. (height − BAND_BOTTOM) — the subtitle plate, BAND_GAP under the body
 *   lanes      the two side strips the characters stand in, left of and right of the text column
 *
 * The band's own contents are fixed too: a name line, then `BODY_LINES` lines of body text at
 * `BODY_SIZE` (72 px at 1080p, the design doc's target). A longer line is shrunk to fit those lines
 * (`layout.ts`'s `bodyFontSize`) rather than pushing the plate taller and eating the body.
 */
export const SAFE_TOP = 0.06;
/** The plate's upper edge. */
export const BAND_TOP = 0.6;
/** Frame bottom to the plate's lower edge. */
export const BAND_BOTTOM = 0.03;
/** The plate's air under the body: no slide paints in these rows. */
export const BAND_GAP = 0.04;
/** The last row a slide may paint: `BAND_TOP` less the plate's air. */
export const SLIDE_BOTTOM = BAND_TOP - BAND_GAP;
/** Frame side to the plate, and the plate's own padding. */
export const BAND_INSET = 0.045;
export const BAND_PADDING_X = 0.022;
export const BAND_PADDING_Y = 0.02;
/** The speaker's name on the plate, and the body's target and reserved lines. */
export const NAME_SIZE = 0.0255;
export const NAME_LINE_HEIGHT = 1.4;
export const BODY_SIZE = 0.0667;
export const BODY_LINES = 3;
export const BODY_LINE_HEIGHT = 1.34;
/** The floor a long line's body size may fall to before the plate is allowed to be loud instead. */
export const BODY_MIN_SIZE = 0.052;
/** A character's lane: how tall it is drawn, its width for that height, and the gap to the text. */
export const SPRITE_INSET = 0.012;
export const SPRITE_HEIGHT = 0.5;
export const SPRITE_ASPECT = 0.62;
/** How far a character's feet tuck behind the plate, so it stands on it rather than floating. */
export const SPRITE_FOOT = 0.02;
export const LANE_GAP = 0.012;

/** The fractions above, resolved for one frame. Every value is a whole pixel. */
export type SafeArea = {
  readonly width: number;
  readonly height: number;
  /** First row and last row a slide may paint; the band starts `BAND_GAP` below `bodyBottom`. */
  readonly bodyTop: number;
  readonly bodyBottom: number;
  /** The text column: between the two character lanes. */
  readonly textLeft: number;
  readonly textWidth: number;
  /** The subtitle plate. */
  readonly bandTop: number;
  readonly bandLeft: number;
  readonly bandWidth: number;
  readonly bandHeight: number;
  readonly bandPaddingX: number;
  readonly bandPaddingY: number;
  /** The plate's width inside its padding: what a body line has to wrap in. */
  readonly bandInnerWidth: number;
  /** The characters' slots: both lanes are `spriteWidth` wide and share one top. */
  readonly spriteTop: number;
  readonly spriteLeft: number;
  readonly spriteRight: number;
  readonly spriteWidth: number;
  readonly spriteHeight: number;
};

export const safeArea = (width: number, height: number): SafeArea => {
  const bodyTop = px(height * SAFE_TOP);
  const bandTop = px(height * BAND_TOP);
  const spriteHeight = px(height * SPRITE_HEIGHT);
  const spriteWidth = px(spriteHeight * SPRITE_ASPECT);
  const lane = px(width * SPRITE_INSET) + spriteWidth + px(width * LANE_GAP);
  const bandLeft = px(width * BAND_INSET);
  const bandWidth = width - 2 * bandLeft;
  const bandPaddingX = px(width * BAND_PADDING_X);
  return {
    width,
    height,
    bodyTop,
    bodyBottom: px(height * SLIDE_BOTTOM),
    textLeft: lane,
    textWidth: width - 2 * lane,
    bandTop,
    bandLeft,
    bandWidth,
    bandHeight: height - px(height * BAND_BOTTOM) - bandTop,
    bandPaddingX,
    bandPaddingY: px(height * BAND_PADDING_Y),
    bandInnerWidth: bandWidth - 2 * bandPaddingX,
    spriteTop: bandTop + px(height * SPRITE_FOOT) - spriteHeight,
    spriteLeft: px(width * SPRITE_INSET),
    spriteRight: width - px(width * SPRITE_INSET) - spriteWidth,
    spriteWidth,
    spriteHeight,
  };
};

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
