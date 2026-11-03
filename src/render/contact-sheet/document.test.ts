import { describe, expect, it } from 'vitest';

import { contactSheetDocument } from './document.ts';
import { contactSheetLayout } from './layout.ts';

const layoutOf = (tileCount: number) => {
  const result = contactSheetLayout({
    tileCount,
    sourceWidth: 1920,
    sourceHeight: 1080,
  });
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
};

const cell = (frame: number, timeSeconds: number, marker: string) => ({
  frame,
  timeSeconds,
  pngBase64: `png-${marker}`,
});

describe('contactSheetDocument', () => {
  it('draws one labelled cell per tile inside a grid of the requested geometry', () => {
    const layout = layoutOf(4);
    const html = contactSheetDocument({
      layout,
      cells: [cell(0, 0, 'a'), cell(30, 1, 'b'), cell(60, 2, 'c'), cell(99, 3.3, 'd')],
    });
    expect(html.match(/<img /gu)).toHaveLength(4);
    for (const marker of ['a', 'b', 'c', 'd'])
      expect(html).toContain(`data:image/png;base64,png-${marker}`);
    // The frame number and the presentation time, which is what makes a tile identifiable.
    expect(html).toContain('frame 99');
    expect(html).toContain('3.300s');
    expect(html).toContain(`repeat(${String(layout.columns)}, ${String(layout.tileWidth)}px)`);
    expect(html).toContain(`width:${String(layout.width)}px`);
    expect(html).toContain(`height:${String(layout.height)}px`);
    expect(html).toContain(
      `font-size:${String(Math.max(9, Math.round(layout.tileWidth * 0.042)))}px`,
    );
  });

  it('draws an empty grid when no tile is captured yet', () => {
    const html = contactSheetDocument({ layout: layoutOf(1), cells: [] });
    expect(html).not.toContain('<img ');
    expect(html).toContain('<!doctype html>');
  });
});
