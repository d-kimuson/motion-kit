import { describe, expect, it } from 'vitest';

import { createCommentBook } from './comment-book.ts';
import { type CommentDraft } from './comments.ts';

const draft = (overrides: Partial<CommentDraft> = {}): CommentDraft => ({
  compositionId: 'intro',
  props: {},
  time: { kind: 'frame', frame: 45 },
  place: { kind: 'frame' },
  sequences: [],
  body: 'Too fast.',
  ...overrides,
});

const memoryStorage = () => {
  const items = new Map<string, string>();
  return {
    items,
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => {
      items.set(key, value);
    },
  };
};

describe('createCommentBook', () => {
  it('numbers comments, keeps them across pages and forgets a removed one', () => {
    const storage = memoryStorage();
    const book = createCommentBook(storage, '/work/app', 'src/entry.tsx');
    const seen: number[] = [];
    book.subscribe(() => seen.push(book.comments().length));
    book.add(draft());
    book.add(draft({ body: 'Second' }));
    expect(book.comments().map(({ id, body }) => [id, body])).toEqual([
      [1, 'Too fast.'],
      [2, 'Second'],
    ]);
    book.remove(1);
    book.add(draft({ body: 'Third' }));
    expect(book.comments().map(({ id }) => id)).toEqual([2, 3]);
    expect(seen).toEqual([1, 2, 1, 2]);
    const reopened = createCommentBook(storage, '/work/app', 'src/entry.tsx');
    expect(reopened.comments().map(({ body }) => body)).toEqual(['Second', 'Third']);
    expect(createCommentBook(storage, '/work/app', 'src/other.tsx').comments()).toEqual([]);
  });

  it('clears only the comments of one Composition', () => {
    const book = createCommentBook(memoryStorage(), '/work/app', 'src/entry.tsx');
    book.add(draft());
    book.add(draft({ compositionId: 'outro' }));
    book.clear('intro');
    expect(book.comments().map(({ compositionId }) => compositionId)).toEqual(['outro']);
  });

  it('skips stored entries it cannot read and keeps the others', () => {
    const storage = memoryStorage();
    const key = 'motion-kit-preview:comments:/work/app:src/entry.tsx';
    storage.items.set(
      key,
      JSON.stringify([
        { id: 4, body: 'no time' },
        { ...draft(), id: 7 },
      ]),
    );
    const book = createCommentBook(storage, '/work/app', 'src/entry.tsx');
    expect(book.comments().map(({ id }) => id)).toEqual([7]);
    book.add(draft());
    expect(book.comments().map(({ id }) => id)).toEqual([7, 8]);
    storage.items.set(key, '{not json');
    expect(createCommentBook(storage, '/work/app', 'src/entry.tsx').comments()).toEqual([]);
  });

  it('keeps comments for the page when storage refuses them', () => {
    const book = createCommentBook(
      {
        getItem: () => null,
        setItem: () => {
          throw new Error('QuotaExceededError');
        },
      },
      '/work/app',
      'src/entry.tsx',
    );
    book.add(draft());
    expect(book.comments()).toHaveLength(1);
  });
});
