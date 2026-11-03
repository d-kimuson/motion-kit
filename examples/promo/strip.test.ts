import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  ballOnCard,
  CARD_COUNT,
  cameraPose,
  cardArrival,
  cardLift,
  cardRest,
  playheadX,
} from './strip.ts';

const seconds = fc.double({ min: -10, max: 60, noNaN: true });
const card = fc.integer({ min: 0, max: CARD_COUNT - 1 });
const cards = Array.from({ length: CARD_COUNT }, (_, index) => index);
const first = cardRest(0)[0];
const last = cardRest(CARD_COUNT - 1)[0];

describe('promo strip', () => {
  it('lays the cards out left to right, mirrored about x = 0 and bent back at the ends', () => {
    fc.assert(
      fc.property(card, (index) => {
        const [x, y, z] = cardRest(index);
        const [mirrorX, , mirrorZ] = cardRest(CARD_COUNT - 1 - index);
        expect(x).toBeCloseTo(-mirrorX, 9);
        expect(z).toBeCloseTo(mirrorZ, 9);
        expect(y).toBe(0);
        expect(z).toBeLessThanOrEqual(0);
      }),
    );
    for (const index of cards.slice(1))
      expect(cardRest(index)[0]).toBeGreaterThan(cardRest(index - 1)[0]);
  });

  it('holds the playhead on the first card, sweeps to the last, and holds there', () => {
    expect(playheadX(0)).toBe(first);
    expect(playheadX(1.1)).toBe(first);
    expect(playheadX(5.1)).toBe(last);
    expect(playheadX(30)).toBe(last);
    fc.assert(
      fc.property(seconds, seconds, (a, b) => {
        const [early, late] = a <= b ? [a, b] : [b, a];
        expect(playheadX(early)).toBeLessThanOrEqual(playheadX(late));
      }),
    );
  });

  it('lifts each card fully when the playhead is on it, and never more than two cards at once', () => {
    for (const index of cards) expect(cardLift(index, 1.1 + index * 0.5)).toBeCloseTo(1, 9);
    fc.assert(
      fc.property(seconds, (time) => {
        const lifts = cards.map((index) => cardLift(index, time));
        for (const lift of lifts) {
          expect(lift).toBeGreaterThanOrEqual(0);
          expect(lift).toBeLessThanOrEqual(1);
        }
        expect(lifts.filter((lift) => lift > 0).length).toBeLessThanOrEqual(2);
      }),
    );
  });

  it('lands every card before the playhead starts to move', () => {
    for (const index of cards) expect(cardArrival(index)).toBeLessThan(1.1 - 0.3);
  });

  it('keeps the camera above the strip and in front of it, looking at the playhead side', () => {
    fc.assert(
      fc.property(seconds, (time) => {
        const { position, lookAt } = cameraPose(time);
        expect(position[1]).toBeGreaterThan(1);
        expect(position[2]).toBeGreaterThan(0);
        expect(lookAt[0]).toBeCloseTo(playheadX(time) * 0.8, 9);
        expect(cameraPose(time)).toEqual(cameraPose(time));
      }),
    );
  });

  it('puts the ball inside its card on every frame card', () => {
    for (const index of cards) {
      const [x, y] = ballOnCard(index);
      for (const value of [x, y]) {
        expect(value).toBeGreaterThan(0);
        expect(value).toBeLessThan(1);
      }
    }
  });
});
