// The 3D scene's layout as plain arithmetic: where each frame card sits, how far the playhead has
// travelled, and where the camera is. Everything is a function of the scene's local seconds, so the
// Three.js scene derives every transform and never integrates one.

import { easing } from '@kimuson/motion-kit/motion';

import { ease } from './motion.ts';

export type Vector3 = readonly [number, number, number];

/** How many frame cards the strip holds, and the clip frame each one stands for. */
export const CARD_COUNT = 9;
export const CARD_FRAME_STEP = 12;
export const CARD_WIDTH = 1.6;
export const CARD_HEIGHT = 0.9;
const SPACING = 1.95;
// The strip bends away from the camera at its ends, so it reads as a reel rather than a row.
const BEND = 0.09;

/** Card `index`'s rest position: centred on x = 0, curved back on z. */
export const cardRest = (index: number): Vector3 => {
  const offset = index - (CARD_COUNT - 1) / 2;
  return [offset * SPACING, 0, -BEND * offset * offset];
};

/** The playhead's x: it waits, sweeps the strip from the first card to the last, then holds. */
export const playheadX = (time: number): number =>
  ease(time, [1.1, 5.1], [cardRest(0)[0], cardRest(CARD_COUNT - 1)[0]], easing.linear);

/** How lifted card `index` is, 0 to 1: a card rises as the playhead nears it and settles as it
 * passes, so one card at a time is pulled out of the strip. */
export const cardLift = (index: number, time: number): number => {
  const distance = Math.abs(playheadX(time) - cardRest(index)[0]) / SPACING;
  return Math.max(0, 1 - distance) ** 2;
};

/** Every card arrives before the playhead starts: card `index` drops in at `0.25 + index * 0.06` s. */
export const cardArrival = (index: number): number => 0.25 + index * 0.06;

export type Pose = { readonly position: Vector3; readonly lookAt: Vector3; readonly fov: number };

/** A slow crane that tracks the playhead: from low on the left, looking along the strip, to higher
 * on the right, looking across it. */
export const cameraPose = (time: number): Pose => {
  const travel = ease(time, [0, 6], [0, 1], easing.easeInOutCubic);
  const angle = -0.58 + travel * 0.9;
  const radius = 6.4 - travel * 0.9;
  const height = 1.2 + travel * 1.0;
  const target = playheadX(time) * 0.8;
  return {
    position: [target + Math.sin(angle) * radius, height, Math.cos(angle) * radius],
    lookAt: [target, -0.2, 0],
    fov: 40,
  };
};

/** Where the ball sits on card `index`, in the card's own 0..1 space: two bounces from left to
 * right, so the strip reads as the frames of one small clip. */
export const ballOnCard = (index: number): readonly [number, number] => {
  const along = index / (CARD_COUNT - 1);
  return [0.18 + 0.64 * along, 0.88 - 0.38 * Math.abs(Math.sin(along * Math.PI * 2))];
};
