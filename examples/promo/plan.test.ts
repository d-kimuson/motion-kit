import {
  createFrameRate,
  createTransitionSeries,
  frameToTime,
  timeToFrameFloor,
} from '@kimuson/motion-kit';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  placeScenes,
  promoCiStoryboard,
  promoStoryboard,
  type SceneKind,
  storyboardFrames,
} from './plan.ts';

const kinds: readonly SceneKind[] = [
  'intro',
  'code',
  'time',
  'three',
  'pipeline',
  'agent',
  'outro',
];

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
  it('fills the full promo with 1068 frames and the CI twin with 60', () => {
    expect(storyboardFrames(promoStoryboard)).toBe(1068);
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
  it('declares the same length the core lays a TransitionSeries out to, at any rate', () => {
    fc.assert(
      fc.property(
        storyboard,
        fc.constantFrom(
          { numerator: 30, denominator: 1 },
          { numerator: 30000, denominator: 1001 },
          { numerator: 24, denominator: 1 },
          { numerator: 60, denominator: 1 },
        ),
        (board, input) => {
          const rate = createFrameRate(input);
          if (!rate.ok) throw new Error(rate.error.message);
          // `PromoScene` places every scene and every overlap at a whole number of frames.
          const at = (frames: number) => frameToTime(BigInt(frames), rate.value);
          const series = createTransitionSeries(
            board.scenes.map((scene) => at(scene.frames)),
            board.scenes.slice(1).map(() => at(board.overlapFrames)),
          );
          if (!series.ok) throw new Error(series.error.message);
          expect(timeToFrameFloor(series.value.duration, rate.value)).toBe(
            BigInt(storyboardFrames(board)),
          );
          expect(
            series.value.scenes.map((scene) => timeToFrameFloor(scene.start, rate.value)),
          ).toEqual(placeScenes(board).map((scene) => BigInt(scene.startFrame)));
        },
      ),
    );
  });
});
