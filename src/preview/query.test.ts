import { describe, expect, it } from 'vitest';

import {
  defaultPreviewFps,
  parsePreviewQuery,
  previewQueryString,
  withCompositionId,
} from './query.ts';

describe('parsePreviewQuery', () => {
  it('defaults to no selection, empty props and the default preview fps', () => {
    expect(parsePreviewQuery('')).toEqual({
      ok: true,
      value: { props: {}, fps: defaultPreviewFps },
    });
  });

  it('reads the composition, JSON props and fps', () => {
    expect(
      parsePreviewQuery('?composition=intro&props=%7B%22title%22%3A%22hi%22%7D&fps=24'),
    ).toEqual({ ok: true, value: { compositionId: 'intro', props: { title: 'hi' }, fps: 24 } });
  });

  it('round-trips what the CLI writes', () => {
    const query = { compositionId: 'a b&c', props: { text: 'x=y&z' }, fps: 8 };
    expect(parsePreviewQuery(previewQueryString(query))).toEqual({ ok: true, value: query });
    expect(previewQueryString({ props: {}, fps: defaultPreviewFps })).toBe('');
  });

  it('reads back a chosen Composition with the rest of the query kept', () => {
    const query = { compositionId: 'first', props: { text: 'x' }, fps: 8 };
    expect(parsePreviewQuery(withCompositionId(previewQueryString(query), 'second'))).toEqual({
      ok: true,
      value: { ...query, compositionId: 'second' },
    });
  });

  it('rejects malformed props and out-of-range fps as invalid arguments', () => {
    for (const search of ['?props=%7Bnope', '?props=3', '?fps=0', '?fps=61', '?fps=1.5', '?fps=x'])
      expect(parsePreviewQuery(search)).toMatchObject({
        ok: false,
        error: { code: 'cli.invalid-arguments', severity: 'error' },
      });
  });
});
