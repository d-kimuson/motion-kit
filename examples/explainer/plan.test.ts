import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { placeSentences } from './plan.ts';

/** A sentence of 1–40 kana ending in a stop, so `splitSentences` cuts the line back into it. */
const sentence = fc
  .tuple(
    fc.string({ unit: fc.constantFrom('あ', 'い', 'う', '投', '資'), minLength: 1, maxLength: 40 }),
    fc.constantFrom('。', '！', '？'),
  )
  .map(([body, stop]) => `${body}${stop}`);

describe('explainer sentence placement', () => {
  it('tiles a line with its sentences: no gap, no overlap, ending on the line’s last frame', () => {
    fc.assert(
      fc.property(
        fc.array(sentence, { minLength: 1, maxLength: 6 }),
        fc.integer({ min: 0, max: 10_000 }),
        fc.integer({ min: 1, max: 900 }),
        (sentences, startFrame, frames) => {
          const placed = placeSentences(
            { id: 'line', speaker: 'zundamon', text: sentences.join(''), emphasis: [] },
            startFrame,
            frames,
          );
          expect(placed.map((entry) => entry.text)).toEqual(sentences);
          let next = startFrame;
          for (const entry of placed) {
            expect(entry.startFrame).toBe(next);
            expect(entry.frames).toBeGreaterThanOrEqual(0);
            next = entry.startFrame + entry.frames;
          }
          expect(next).toBe(startFrame + frames);
        },
      ),
    );
  });
});
