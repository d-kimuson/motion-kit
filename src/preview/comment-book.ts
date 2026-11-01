import { type CommentDraft, type ReviewComment, reviewCommentSchema } from './comments.ts';

export type CommentBook = Readonly<{
  /** Every comment on the entry's Compositions, in the order they were added. */
  comments: () => readonly ReviewComment[];
  subscribe: (listener: () => void) => () => void;
  add: (draft: CommentDraft) => ReviewComment;
  remove: (id: number) => void;
  /** Remove the comments on one Composition. */
  clear: (compositionId: string) => void;
}>;

const load = (storage: Pick<Storage, 'getItem'>, key: string): readonly ReviewComment[] => {
  try {
    const value: unknown = JSON.parse(storage.getItem(key) ?? '[]');
    return Array.isArray(value)
      ? value.flatMap((item) => {
          const parsed = reviewCommentSchema.safeParse(item);
          return parsed.success ? [parsed.data] : [];
        })
      : [];
  } catch {
    return [];
  }
};

/**
 * Review comments on one entry of one project, kept in `localStorage` across reloads, so the
 * server stays read-only. Storage is per origin, so a session on another port starts with none.
 */
export const createCommentBook = (
  storage: Pick<Storage, 'getItem' | 'setItem'>,
  projectRoot: string,
  entry: string,
): CommentBook => {
  const key = `motion-kit-preview:comments:${projectRoot}:${entry}`;
  const listeners = new Set<() => void>();
  let comments = load(storage, key);
  const update = (next: readonly ReviewComment[]) => {
    comments = next;
    // A blocked or full storage only loses the comments at the next reload, never on this page.
    try {
      storage.setItem(key, JSON.stringify(comments));
    } catch {
      // Nothing to keep them in.
    }
    for (const listener of listeners) listener();
  };
  return {
    comments: () => comments,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    add: (draft) => {
      const comment = { ...draft, id: Math.max(0, ...comments.map(({ id }) => id)) + 1 };
      update([...comments, comment]);
      return comment;
    },
    remove: (id) => update(comments.filter((comment) => comment.id !== id)),
    clear: (compositionId) =>
      update(comments.filter((comment) => comment.compositionId !== compositionId)),
  };
};
