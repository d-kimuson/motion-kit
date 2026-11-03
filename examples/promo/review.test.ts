import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { launchCommand, reviewComment, reviewTranscript } from './copy.ts';
import {
  beats,
  clicks,
  commentMode,
  commentTyped,
  launchTyped,
  layout,
  lineShownAt,
  PAUSE_FRAME,
  PREVIEW_BODY,
  pointerAt,
  pointerShown,
  previewFrame,
  REVIEW_EXIT_SECONDS,
  REVIEW_SECONDS,
  type Rect,
  START_FRAME,
  titleGrowth,
} from './review.ts';

const rate = { numerator: 30n, denominator: 1n };
const seconds = fc.double({ min: -5, max: REVIEW_SECONDS + 5, noNaN: true });
const frameAt = (time: number) => Math.ceil(time * 30 - 1e-9);
const inside = ([x, y]: readonly [number, number], rect: Rect) =>
  x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height;

describe('promo review scene', () => {
  it('tells the beats in story order, all before the scene starts to leave', () => {
    const order = [
      beats.launch,
      beats.url,
      beats.preview,
      beats.play,
      beats.pause,
      beats.commentMode,
      beats.hover,
      beats.select,
      beats.type,
      beats.save,
      beats.copy,
      beats.paste,
      beats.read,
      beats.edit,
      beats.reload,
      beats.run,
      beats.rendered,
      beats.reply,
    ];
    for (const [index, at] of order.slice(1).entries())
      expect(at).toBeGreaterThan(order[index] ?? 0);
    expect(beats.reply).toBeLessThan(REVIEW_SECONDS - REVIEW_EXIT_SECONDS);
  });

  it('finishes typing the launch command before the URL and the comment before the save', () => {
    expect(launchTyped(frameAt(beats.launch) - 1, rate, launchCommand.length)).toBe(0);
    expect(launchTyped(frameAt(beats.url), rate, launchCommand.length)).toBe(launchCommand.length);
    expect(commentTyped(frameAt(beats.type) - 1, rate, reviewComment.length)).toBe(0);
    expect(commentTyped(frameAt(beats.save), rate, reviewComment.length)).toBe(
      reviewComment.length,
    );
  });

  it('plays the preview forward from the start frame and holds it on the frame under review', () => {
    expect(previewFrame(0, rate)).toBe(START_FRAME);
    expect(previewFrame(frameAt(beats.pause), rate)).toBe(PAUSE_FRAME);
    expect(previewFrame(frameAt(REVIEW_SECONDS), rate)).toBe(PAUSE_FRAME);
    fc.assert(
      fc.property(fc.nat(400), fc.nat(400), (a, b) => {
        const [early, late] = a <= b ? [a, b] : [b, a];
        expect(previewFrame(early, rate)).toBeLessThanOrEqual(previewFrame(late, rate));
      }),
    );
  });

  it('has the pointer on each control when it clicks it, and never outside the preview', () => {
    for (const click of clicks)
      expect(inside(pointerAt(click.at), layout[click.target])).toBe(true);
    fc.assert(
      fc.property(seconds, (time) => {
        expect(inside(pointerAt(time), PREVIEW_BODY)).toBe(true);
        expect(pointerShown(time)).toBeGreaterThanOrEqual(0);
        expect(pointerShown(time)).toBeLessThanOrEqual(1);
      }),
    );
    expect(pointerShown(beats.copy)).toBe(1);
  });

  it('is in comment mode from the click on Comment until the comment is saved', () => {
    fc.assert(
      fc.property(seconds, (time) => {
        expect(commentMode(time)).toBe(time >= beats.commentMode && time < beats.save);
      }),
    );
  });

  it('shows the transcript in order, from the paste, and reloads only after the last edit line', () => {
    const times = reviewTranscript.map((_, index) => lineShownAt(reviewTranscript, index));
    expect(times[0]).toBe(beats.paste);
    for (const [index, at] of times.slice(1).entries())
      expect(at).toBeGreaterThanOrEqual(times[index] ?? 0);
    for (const at of times) expect(at).toBeLessThan(REVIEW_SECONDS - REVIEW_EXIT_SECONDS);
    const edits = times.filter((_, index) => reviewTranscript[index]?.beat === 'edit');
    expect(edits.length).toBeGreaterThan(0);
    for (const at of edits) expect(at).toBeLessThan(beats.reload);
  });

  it('grows the title only after the reload, monotonically, to its full size', () => {
    expect(titleGrowth(beats.reload)).toBe(0);
    expect(titleGrowth(beats.reply)).toBe(1);
    fc.assert(
      fc.property(seconds, seconds, (a, b) => {
        const [early, late] = a <= b ? [a, b] : [b, a];
        expect(titleGrowth(early)).toBeLessThanOrEqual(titleGrowth(late));
      }),
    );
  });
});
