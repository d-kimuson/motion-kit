import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  placeScenes,
  promoCiStoryboard,
  promoStoryboard,
  type SceneKind,
  storyboardFrames,
} from './plan.ts';

const kinds: readonly SceneKind[] = ['intro', 'code', 'time', 'pipeline', 'agent', 'outro'];

const storyboard = fc.integer({ min: 1, max: 12 }).chain((overlapFrames) =>
  fc.record({
    overlapFrames: fc.constant(overlapFrames),
    scenes: fc.array(
      fc.record({
        kind: fc.constantFrom(...kinds),
        frames: fc.integer({ min: overlapFrames, max: 600 }),
      }),
      { minLength: 1, maxLength: 8 },
    ),
  }),
);

describe('promo storyboard', () => {
  it('fills the full promo with 900 frames and the CI twin with 60', () => {
    expect(storyboardFrames(promoStoryboard)).toBe(900);
    expect(storyboardFrames(promoCiStoryboard)).toBe(60);
  });

  it('tells every scene of the full promo once, in order', () => {
    expect(promoStoryboard.scenes.map((scene) => scene.kind)).toEqual(kinds);
  });

  it('starts each scene one overlap before the previous one ends', () => {
    fc.assert(
      fc.property(storyboard, (board) => {
        const placed = placeScenes(board);
        expect(placed[0]?.startFrame).toBe(0);
        expect(placed.slice(1).map((scene) => scene.startFrame)).toEqual(
          placed.slice(0, -1).map((scene) => scene.startFrame + scene.frames - board.overlapFrames),
        );
        const last = placed.at(-1);
        expect(last === undefined ? 0 : last.startFrame + last.frames).toBe(
          storyboardFrames(board),
        );
      }),
    );
  });

  it('fades a scene in and out only where it overlaps a neighbour', () => {
    fc.assert(
      fc.property(storyboard, (board) => {
        const placed = placeScenes(board);
        for (const [index, scene] of placed.entries()) {
          expect(scene.enterFrames).toBe(index === 0 ? 0 : board.overlapFrames);
          expect(scene.exitFrames).toBe(index === placed.length - 1 ? 0 : board.overlapFrames);
        }
      }),
    );
  });
});
