import { activeSequences } from '../core/sequence/directory.ts';
import { type InspectedElement } from '../lib/preview-protocol.ts';
import { type CommentBook } from './comment-book.ts';
import { commentTime, firstFrame, type CommentPlace } from './comments.ts';
import { type PreviewController } from './controller.ts';

/**
 * A comment being written: from the frame it started on to `end`, which may come before it, and the
 * text so far, kept here so it outlives the field showing it.
 */
export type CommentDraftState = Readonly<{
  anchor: number;
  end: number;
  place: CommentPlace;
  body: string;
}>;

/** The elements under the pointer while picking, the likeliest meant first, and the highlighted one. */
export type HoveredElements = Readonly<{
  elements: readonly [InspectedElement, ...InspectedElement[]];
  index: number;
}>;

export type ReviewState = Readonly<{
  /** Comment mode: playback is paused and a click on the stage picks what to comment on. */
  picking: boolean;
  /** What is under the pointer while picking; null over nothing of the Composition. */
  hovered: HoveredElements | null;
  draft: CommentDraftState | undefined;
}>;

export type ReviewDependencies = Readonly<{
  preview: Pick<PreviewController, 'state' | 'pause' | 'inspect'>;
  book: Pick<CommentBook, 'add'>;
  /** The props the page mounts Compositions with; a comment keeps them. */
  props: Readonly<Record<string, unknown>>;
}>;

export type ReviewController = Readonly<{
  state: () => ReviewState;
  subscribe: (listener: () => void) => () => void;
  togglePicking: () => void;
  /** The pointer is over a design-pixel point of the stage. */
  hover: (x: number, y: number) => void;
  /**
   * Highlight the element after the highlighted one under the pointer (`1`) or the one before it
   * (`-1`); the highlight stops at either end.
   */
  cycle: (step: 1 | -1) => void;
  leave: () => void;
  /**
   * Draft a comment on the highlighted element at a design-pixel point, or the likeliest meant one
   * when the elements there changed, or on the point when there is none.
   */
  pick: (x: number, y: number) => Promise<void>;
  /** Draft a comment on an element of the shown frame picked without a click. */
  commentElement: (element: InspectedElement) => void;
  /** Draft a comment on the whole frame at the playhead. */
  commentFrame: () => void;
  /** Make the draft a range that ends at the playhead. */
  endAtPlayhead: () => void;
  write: (body: string) => void;
  /** Add the draft to the book; false when there was no draft or nothing is mounted. */
  save: () => boolean;
  cancel: () => void;
}>;

const nonEmpty = <T>([first, ...rest]: readonly T[]): readonly [T, ...T[]] | undefined =>
  first === undefined ? undefined : [first, ...rest];

/** Whether two answers of the realm list the same elements, so the highlight can stay on its one. */
const sameElements = (a: readonly InspectedElement[], b: readonly InspectedElement[]) =>
  JSON.stringify(a) === JSON.stringify(b);

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
  const elements = async (x: number, y: number) => {
    const result = await deps.preview.inspect(x, y);
    return result.ok ? nonEmpty(result.value) : undefined;
  };
  /** The highlight over `found`: where it was when the same elements are under the pointer. */
  const hoveredOver = (found: readonly [InspectedElement, ...InspectedElement[]]) => ({
    elements: found,
    index:
      state.hovered !== null && sameElements(state.hovered.elements, found)
        ? state.hovered.index
        : 0,
  });
  const draft = (place: CommentPlace) => {
    picking += 1;
    hovering += 1;
    deps.preview.pause();
    const { playhead } = deps.preview.state();
    // A new target moves the draft; what was written stays.
    const body = state.draft?.body ?? '';
    update({
      picking: false,
      hovered: null,
      draft: { anchor: playhead, end: playhead, place, body },
    });
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
      void elements(x, y).then((found) => {
        if (started === hovering && state.picking)
          update({ hovered: found === undefined ? null : hoveredOver(found) });
      });
    },
    cycle: (step) => {
      const { hovered } = state;
      if (hovered === null) return;
      const index = Math.min(Math.max(hovered.index + step, 0), hovered.elements.length - 1);
      if (index !== hovered.index) update({ hovered: { ...hovered, index } });
    },
    leave: () => {
      hovering += 1;
      if (state.hovered !== null) update({ hovered: null });
    },
    pick: async (x, y) => {
      if (!state.picking) return;
      picking += 1;
      const started = picking;
      const found = await elements(x, y);
      if (started !== picking || !state.picking) return;
      if (found === undefined) {
        draft({ kind: 'point', x, y });
        return;
      }
      const { elements: picked, index } = hoveredOver(found);
      draft({ kind: 'element', element: picked[index] ?? found[0], point: { x, y } });
    },
    commentElement: (element) => draft({ kind: 'element', element }),
    commentFrame: () => draft({ kind: 'frame' }),
    endAtPlayhead: () => {
      if (state.draft !== undefined)
        update({ draft: { ...state.draft, end: deps.preview.state().playhead } });
    },
    write: (body) => {
      if (state.draft !== undefined) update({ draft: { ...state.draft, body } });
    },
    save: () => {
      const { session, spans } = deps.preview.state();
      if (state.draft === undefined || session.kind !== 'ready') return false;
      const time = commentTime(state.draft.anchor, state.draft.end);
      deps.book.add({
        compositionId: session.descriptor.id,
        props: deps.props,
        time,
        place: state.draft.place,
        sequences: activeSequences(spans, firstFrame(time)).map(({ path }) => [...path]),
        body: state.draft.body.trim(),
      });
      update({ draft: undefined });
      return true;
    },
    cancel: () => update({ draft: undefined }),
  };
};
