// The storyboard: which scene plays for how many frames, as data. Every layer reads its timing from
// here, so the full promo and its CI twin differ only in the board they pass to `PromoScene`.

export type SceneKind = 'intro' | 'code' | 'time' | 'three' | 'pipeline' | 'agent' | 'outro';

export type SceneSlot = { readonly kind: SceneKind; readonly frames: number };

/** Scenes back to back, each one starting `overlapFrames` before the previous one ends. */
export type Storyboard = {
  readonly overlapFrames: number;
  readonly scenes: readonly SceneSlot[];
};

export type PlacedScene = SceneSlot & {
  readonly startFrame: number;
  /** Frames at the head shared with the previous scene: 0 for the first. */
  readonly enterFrames: number;
  /** Frames at the tail shared with the next scene: 0 for the last. */
  readonly exitFrames: number;
};

export const placeScenes = (board: Storyboard): readonly PlacedScene[] => {
  const placed: PlacedScene[] = [];
  let start = 0;
  for (const [index, scene] of board.scenes.entries()) {
    const last = index === board.scenes.length - 1;
    placed.push({
      ...scene,
      startFrame: start,
      enterFrames: index === 0 ? 0 : board.overlapFrames,
      exitFrames: last ? 0 : board.overlapFrames,
    });
    start += scene.frames - board.overlapFrames;
  }
  return placed;
};

/** `sum(scenes) − sum(overlaps)`: the length `TransitionSeries` gives the same board. */
export const storyboardFrames = (board: Storyboard): number =>
  board.scenes.reduce((total, scene) => total + scene.frames, 0) -
  Math.max(0, board.scenes.length - 1) * board.overlapFrames;

/** 35.6 s at 30 fps: seven scenes, six 0.4 s handoffs. */
export const promoStoryboard: Storyboard = {
  overlapFrames: 12,
  scenes: [
    { kind: 'intro', frames: 120 },
    { kind: 'code', frames: 180 },
    { kind: 'time', frames: 180 },
    { kind: 'three', frames: 180 },
    { kind: 'pipeline', frames: 150 },
    { kind: 'agent', frames: 180 },
    { kind: 'outro', frames: 150 },
  ],
};

/** The full promo's length, which the pipeline and agent scenes show as the frames they render. */
export const promoFrames = storyboardFrames(promoStoryboard);

/** 2 s for the smoke test: the opening scene, one handoff and the start of the code scene, drawn
 * by the same scene components as the full promo. */
export const promoCiStoryboard: Storyboard = {
  overlapFrames: 12,
  scenes: [
    { kind: 'intro', frames: 36 },
    { kind: 'code', frames: 36 },
  ],
};
