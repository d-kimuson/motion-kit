// The slideshow's data, timing and look as plain values and arithmetic. `/motion` and `/theme` are
// Phase 2 and have no public subpath yet, so the Ken Burns move is computed from `useSequence()`'s
// seconds here; nothing in this file touches React (docs/design-doc/20261025-reference-examples.md,
// "slideshow").

export const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

export const easeInCubic = (value: number): number => clamp01(value) ** 3;

export const easeOutCubic = (value: number): number => 1 - (1 - clamp01(value)) ** 3;

/** 30 fps for every Composition this example declares. */
export const SLIDESHOW_FPS = 30;

/** 900 frames = 30 s, inside the design doc's 600–1200 (20–40 s). */
export const SLIDESHOW_FRAMES = 900;

/** The 0.5-second crossfade the acceptance look asks for, in seconds. Short Compositions scale it. */
export const CROSSFADE_SECONDS = 0.5;

/** Ken Burns: the zoom runs 1.00 → 1.12 over a slide's own duration. */
export const KEN_BURNS_ZOOM = 0.12;

/** Ken Burns: the pan is ±4% of the frame width, alternating direction per slide. */
export const KEN_BURNS_PAN = 0.04;

/** Which set of photos a render reads. The switch the design doc gives every media example. */
export type AssetSet = 'placeholder' | 'final';

export type Slide = Readonly<{
  /** Stable key; also the `useAsset` id. */
  readonly id: string;
  /** The caption in the lower third. It comes from these props, not from the file. */
  readonly caption: string;
  /** File name inside the photo directory; the directory itself depends on `assetSet`. */
  readonly file: string;
}>;

/** The eight photos, in order. Alternate slides pan left-to-right and right-to-left. */
export const slides: readonly Slide[] = [
  { id: 'dune-light', caption: 'Dunes at first light', file: '01-dune-light.png' },
  { id: 'cold-water', caption: 'Cold water, no wind', file: '02-cold-water.png' },
  { id: 'stone-stair', caption: 'A stair of warm stone', file: '03-stone-stair.png' },
  { id: 'pine-ridge', caption: 'Pine ridge, four in the afternoon', file: '04-pine-ridge.png' },
  { id: 'harbour', caption: 'Harbour before the boats', file: '05-harbour.png' },
  { id: 'long-field', caption: 'A field that goes on', file: '06-long-field.png' },
  { id: 'night-road', caption: 'The road after dark', file: '07-night-road.png' },
  { id: 'morning-window', caption: 'Morning through one window', file: '08-morning-window.png' },
];

/** The `-ci` Composition: the first three slides, so one crossfade starts and one completes. */
export const ciSlides = slides.slice(0, 3);

/** The probe: two slides, so it holds both sides of a crossfade and no second handoff. */
export const probeSlides = slides.slice(0, 2);

/** Root-relative URL of a photo. Never a JavaScript import: the loading session serves the project
 *  root, and `fetch-assets.ts` writes the placeholder set into the gitignored `assets.local/`. */
export const photoSource = (assetSet: AssetSet, slide: Slide): string =>
  assetSet === 'final'
    ? `/examples/slideshow/assets/photos/${slide.file}`
    : `/examples/slideshow/assets.local/photos/${slide.file}`;

/** Directory the placeholder generator writes, relative to the repository root. */
export const PLACEHOLDER_PHOTOS = 'examples/slideshow/assets.local/photos';

/** Directory the placeholder generator writes the tone bed into, relative to the repository root. */
export const PLACEHOLDER_MUSIC = 'examples/slideshow/assets.local/music';

/** The tone bed's length: the full `slideshow`'s duration, so the bed ends with the last slide. */
export const MUSIC_SECONDS = SLIDESHOW_FRAMES / SLIDESHOW_FPS;

/**
 * Slides and their crossfades in whole frames, derived from the Composition's own duration so the
 * vertical `slideshow`, its 16:9 twin, its `-ci` Composition and its probe all render the same tree
 * at four different sizes. Scene `i` lasts `sceneFrames[i]` and the next one starts `crossfadeFrames`
 * earlier, so the series lasts exactly `totalFrames`.
 */
export type SlidePlan = Readonly<{
  readonly crossfadeFrames: number;
  readonly sceneFrames: readonly number[];
  readonly startFrames: readonly number[];
}>;

/** Alternating pan direction per slide: even slides drift right, odd slides drift left. */
export const directionOf = (index: number): 1 | -1 => (index % 2 === 0 ? 1 : -1);

export const planSlides = (totalFrames: number, count: number, fps: number): SlidePlan => {
  const scenes = Math.max(1, count);
  // 0.5 s at the Composition's own rate, but never so long that a scene has no solo frames: the
  // `-ci` Composition (60 frames) still gets 15 frames and the probe (30 frames) gets 10.
  const crossfadeFrames = Math.max(
    2,
    Math.min(Math.round(fps * CROSSFADE_SECONDS), Math.floor(totalFrames / (scenes + 1))),
  );
  const evenFrames = Math.ceil((totalFrames + (scenes - 1) * crossfadeFrames) / scenes);
  const sceneFrames = Array.from({ length: scenes }, (_, index) =>
    index === scenes - 1
      ? Math.max(1, totalFrames + (scenes - 1) * crossfadeFrames - (scenes - 1) * evenFrames)
      : evenFrames,
  );
  const startFrames: number[] = [];
  let start = 0;
  for (const [index, frames] of sceneFrames.entries()) {
    startFrames.push(start);
    start += index === scenes - 1 ? frames : frames - crossfadeFrames;
  }
  return { crossfadeFrames, sceneFrames, startFrames };
};

/** Where the picture sits inside the frame at a given moment of its own scene. */
export type KenBurns = Readonly<{
  readonly scale: number;
  readonly offsetX: number;
  readonly offsetY: number;
}>;

/**
 * The Ken Burns move: a constant zoom from 1.0 to 1.12 across the slide's whole life, plus a pan of
 * ±4% that alternates direction per slide. `progress` is the slide's own position in its scene, so
 * the move is continuous through a crossfade and never restarts.
 *
 * The pan is scaled by the same progress as the zoom, so it is always inside the room the zoom has
 * created: at scale 1.0 the picture exactly fills the frame and cannot slide away from an edge, and
 * by the end of the scene the 12% zoom has paid for the 4% pan (6% of overscan per side). Panning a
 * picture that is not yet oversized is what would show the ground through a gap.
 *
 * `progress` is clamped, and the arithmetic has no randomness and no history: the same progress
 * always produces the same transform, which is what the determinism probe checks.
 */
export const kenBurns = (progress: number, direction: 1 | -1): KenBurns => {
  const p = clamp01(progress);
  return {
    scale: 1 + KEN_BURNS_ZOOM * p,
    offsetX: direction * KEN_BURNS_PAN * p,
    // A smaller vertical drift on the opposite diagonal, so the move is never a pure horizontal
    // slide and one slide drifts up-right while the next drifts down-left.
    offsetY: -0.5 * KEN_BURNS_PAN * direction * p,
  };
};

/**
 * Ken Burns progress for one side of a crossfade, in that side's own scene duration. The outgoing
 * picture picks up where its scene had reached; the incoming picture starts where its scene starts,
 * so a slide's move spans its own life rather than restarting at the cut.
 */
export const crossfadeProgress = (
  progress: number,
  side: 'outgoing' | 'incoming',
  crossfadeSeconds: number,
  sceneSeconds: number,
): number => {
  const share = sceneSeconds > 0 ? Math.min(0.5, crossfadeSeconds / sceneSeconds) : 0;
  return side === 'outgoing' ? 1 - (1 - clamp01(progress)) * share : clamp01(progress) * share;
};

/** The layout every slide reads from `useTimeline()`, so 1080×1920 and 1920×1080 share one tree. */
export type SlideLayout = Readonly<{
  readonly orientation: 'vertical' | 'landscape';
  /** Caption size in px; derived from the shorter side, so both aspects agree on the type scale. */
  readonly captionSize: number;
  readonly kickerSize: number;
  /** Horizontal safe-area inset in px. */
  readonly inset: number;
  /** Distance from the bottom edge to the caption block, in px: the lower third. */
  readonly captionBottom: number;
  /** A scrim height in px, so white type stays legible over a bright photo. */
  readonly scrimHeight: number;
  readonly shadow: string;
  /** max-width of the caption block in px, so a long caption wraps inside the safe area. */
  readonly captionWidth: number;
}>;

export const layoutFor = (width: number, height: number): SlideLayout => {
  const short = Math.max(1, Math.min(width, height));
  const vertical = height > width;
  const captionSize = Math.round(short * 0.075);
  return {
    orientation: vertical ? 'vertical' : 'landscape',
    captionSize,
    kickerSize: Math.max(10, Math.round(short * 0.028)),
    // 6% of the width, never less than 5% of the shorter side: the caption stays inside the safe
    // area at 9:16 as well as at 16:9.
    inset: Math.round(Math.max(width * 0.06, short * 0.05)),
    captionBottom: Math.round(height * (vertical ? 0.14 : 0.1)),
    scrimHeight: Math.round(height * 0.34),
    shadow: `0 ${Math.max(1, Math.round(captionSize * 0.04))}px ${Math.round(captionSize * 0.3)}px rgba(0, 0, 0, 0.55), 0 1px 2px rgba(0, 0, 0, 0.6)`,
    captionWidth: Math.round(width - 2 * Math.max(width * 0.06, short * 0.05)),
  };
};
