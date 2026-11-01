import { activeSequences } from '../core/sequence/directory.ts';
import { type InspectedElement } from '../lib/preview-protocol.ts';
import { type CommentBook } from './comment-book.ts';
import { commentTime, firstFrame, type CommentPlace } from './comments.ts';
import { type PreviewController } from './controller.ts';

/** A comment being written: from the frame it started on to `end`, which may come before it. */
export type CommentDraftState = Readonly<{ anchor: number; end: number; place: CommentPlace }>;

export type ReviewState = Readonly<{
  /** Comment mode: playback is paused and a click on the stage picks what to comment on. */
  picking: boolean;
  /** The element under the pointer while picking. */
  hovered: InspectedElement | null;
  draft: CommentDraftState | undefined;
}>;

export type ReviewDependencies = Readonly<{
  preview: Pick<PreviewController, 'state' | 'pause' | 'inspect'>;
  book: Pick<CommentBook, 'add'>;
}>;

export type ReviewController = Readonly<{
  state: () => ReviewState;
  subscribe: (listener: () => void) => () => void;
  togglePicking: () => void;
  /** The pointer is over a design-pixel point of the stage. */
  hover: (x: number, y: number) => void;
  leave: () => void;
  /** Draft a comment on the element at a design-pixel point, or on the point without one. */
  pick: (x: number, y: number) => Promise<void>;
  /** Draft a comment on the whole frame at the playhead. */
  commentFrame: () => void;
  /** Make the draft a range that ends at the playhead. */
  endAtPlayhead: () => void;
  /** Add the draft to the book; false when there was no draft or nothing is mounted. */
  save: (body: string) => boolean;
  cancel: () => void;
}>;

/** Comment mode and the draft it produces; the comments themselves live in the book. */
export const createReviewController = (deps: ReviewDependencies): ReviewController => {
  let state: ReviewState = { picking: false, hovered: null, draft: undefined };
  const listeners = new Set<() => void>();
  const update = (next: Partial<ReviewState>) => {
    state = { ...state, ...next };
    for (const listener of listeners) listener();
  };
  // Bumped by every hover, leave and mode change, so only the latest highlight lands.
  let hovering = 0;
  // Bumped by every pick and draft, so a pick answered late does not replace a newer draft.
  let picking = 0;
  const element = async (x: number, y: number) => {
    const result = await deps.preview.inspect(x, y);
    return result.ok ? result.value : null;
  };
  const draft = (place: CommentPlace) => {
    picking += 1;
    hovering += 1;
    deps.preview.pause();
    const { playhead } = deps.preview.state();
    update({ picking: false, hovered: null, draft: { anchor: playhead, end: playhead, place } });
  };
  return {
    state: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    togglePicking: () => {
      hovering += 1;
      picking += 1;
      if (!state.picking) deps.preview.pause();
      update({ picking: !state.picking, hovered: null });
    },
    hover: (x, y) => {
      if (!state.picking) return;
      hovering += 1;
      const started = hovering;
      void element(x, y).then((hovered) => {
        if (started === hovering && state.picking) update({ hovered });
      });
    },
    leave: () => {
      hovering += 1;
      if (state.hovered !== null) update({ hovered: null });
    },
    pick: async (x, y) => {
      if (!state.picking) return;
      picking += 1;
      const started = picking;
      const found = await element(x, y);
      if (started !== picking || !state.picking) return;
      draft(found === null ? { kind: 'point', x, y } : { kind: 'element', x, y, element: found });
    },
    commentFrame: () => draft({ kind: 'frame' }),
    endAtPlayhead: () => {
      if (state.draft !== undefined)
        update({ draft: { ...state.draft, end: deps.preview.state().playhead } });
    },
    save: (body) => {
      const { session, spans } = deps.preview.state();
      if (state.draft === undefined || session.kind !== 'ready') return false;
      const time = commentTime(state.draft.anchor, state.draft.end);
      deps.book.add({
        compositionId: session.descriptor.id,
        time,
        place: state.draft.place,
        sequences: activeSequences(spans, firstFrame(time)).map(({ path }) => [...path]),
        body: body.trim(),
      });
      update({ draft: undefined });
      return true;
    },
    cancel: () => update({ draft: undefined }),
  };
};
