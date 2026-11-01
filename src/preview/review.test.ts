import { describe, expect, it } from 'vitest';

import { createFrameRate } from '../core/timeline/time.ts';
import { type InspectedElement } from '../lib/preview-protocol.ts';
import { type Result } from '../lib/result.ts';
import { type CommentBook } from './comment-book.ts';
import { type CommentDraft, type ReviewComment } from './comments.ts';
import { type PreviewState } from './controller.ts';
import { createReviewController, type ReviewDependencies } from './review.ts';

const fps = createFrameRate({ numerator: 30, denominator: 1 });
if (!fps.ok) throw new Error(fps.error.message);

const element = (x: number): InspectedElement => ({
  selector: 'h1',
  text: 'Hello',
  source: null,
  box: { x, y: 0, width: 10, height: 10 },
});

const setup = () => {
  let preview: PreviewState = {
    session: {
      kind: 'ready',
      descriptor: {
        id: 'intro',
        width: 320,
        height: 180,
        fps: { numerator: 30, denominator: 1 },
        durationInFrames: 90,
      },
      fps: fps.value,
    },
    playback: { kind: 'playing', anchorFrame: 0, anchorTime: 0 },
    starting: false,
    playhead: 40,
    shown: undefined,
    spans: [
      { path: ['intro'], startFrame: 0, endFrame: 60 },
      { path: ['intro', 'title'], startFrame: 20, endFrame: 50 },
      { path: ['outro'], startFrame: 60, endFrame: 90 },
    ],
    muted: new Set(),
    unplayable: [],
  };
  const events: string[] = [];
  const inspections: { x: number; answer: (result: Result<InspectedElement | null>) => void }[] =
    [];
  const added: CommentDraft[] = [];
  const book: Pick<CommentBook, 'add'> = {
    add: (draft) => {
      added.push(draft);
      return { ...draft, id: added.length } satisfies ReviewComment;
    },
  };
  const deps: ReviewDependencies = {
    preview: {
      state: () => preview,
      pause: () => {
        events.push('pause');
        preview = { ...preview, playback: { kind: 'paused', frame: preview.playhead } };
      },
      inspect: (x) =>
        new Promise((answer) => {
          inspections.push({ x, answer });
        }),
    },
    book,
  };
  return {
    review: createReviewController(deps),
    events,
    inspections,
    added,
    moveTo: (playhead: number) => {
      preview = { ...preview, playhead };
    },
  };
};
const flush = () => new Promise((done) => setTimeout(done, 0));

describe('createReviewController', () => {
  it('pauses for picking and highlights only the latest element under the pointer', async () => {
    const host = setup();
    host.review.togglePicking();
    expect(host.events).toEqual(['pause']);
    expect(host.review.state().picking).toBe(true);
    host.review.hover(1, 0);
    host.review.hover(2, 0);
    host.inspections[1]?.answer({ ok: true, value: element(2) });
    host.inspections[0]?.answer({ ok: true, value: element(1) });
    await flush();
    expect(host.review.state().hovered).toEqual(element(2));
    host.review.leave();
    expect(host.review.state().hovered).toBeNull();
    host.review.togglePicking();
    expect(host.review.state()).toMatchObject({ picking: false, hovered: null });
  });

  it('drafts a comment on the clicked element, or on the point when there is none', async () => {
    const host = setup();
    host.review.togglePicking();
    const picking = host.review.pick(5.4, 6.6);
    // The pointer may leave the stage before the realm answers.
    host.review.leave();
    host.inspections[0]?.answer({ ok: true, value: element(5) });
    await picking;
    expect(host.review.state()).toMatchObject({
      picking: false,
      draft: {
        anchor: 40,
        end: 40,
        place: { kind: 'element', x: 5.4, y: 6.6, element: element(5) },
      },
    });
    host.review.togglePicking();
    const missed = host.review.pick(300, 100);
    host.inspections[1]?.answer({
      ok: false,
      error: { code: 'render.page-error', severity: 'error', message: 'x', hint: 'y' },
    });
    await missed;
    expect(host.review.state().draft?.place).toEqual({ kind: 'point', x: 300, y: 100 });
  });

  it('saves a range with the named Sequences at its first frame, earliest end first', () => {
    const host = setup();
    host.review.commentFrame();
    expect(host.events).toEqual(['pause']);
    host.moveTo(10);
    host.review.endAtPlayhead();
    expect(host.review.state().draft).toMatchObject({ anchor: 40, end: 10 });
    expect(host.review.save('  Slow this down  ')).toBe(true);
    expect(host.added).toEqual([
      {
        compositionId: 'intro',
        time: { kind: 'range', start: 10, end: 40 },
        place: { kind: 'frame' },
        sequences: [['intro']],
        body: 'Slow this down',
      },
    ]);
    expect(host.review.state().draft).toBeUndefined();
  });

  it('saves one frame with every Sequence showing there, and drops a cancelled draft', () => {
    const host = setup();
    host.review.commentFrame();
    host.review.save('Title');
    expect(host.added[0]).toMatchObject({
      time: { kind: 'frame', frame: 40 },
      sequences: [['intro'], ['intro', 'title']],
    });
    host.review.commentFrame();
    host.review.cancel();
    expect(host.review.state().draft).toBeUndefined();
    expect(host.review.save('ignored')).toBe(false);
    expect(host.added).toHaveLength(1);
  });

  it('stops picking when a frame comment starts, and forgets a pick that finished after it', async () => {
    const host = setup();
    host.review.togglePicking();
    const picking = host.review.pick(1, 1);
    host.review.commentFrame();
    host.inspections[0]?.answer({ ok: true, value: element(1) });
    await picking;
    expect(host.review.state()).toMatchObject({
      picking: false,
      draft: { place: { kind: 'frame' } },
    });
  });
});
