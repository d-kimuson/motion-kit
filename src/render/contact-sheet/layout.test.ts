import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  contactSheetLayout,
  defaultColumns,
  defaultTileWidth,
  maxSheetDimension,
  maxTiles,
  type ContactSheetLayout,
} from './layout.ts';

type LayoutOptions = {
  readonly tileCount: number;
  readonly sourceWidth?: number;
  readonly sourceHeight?: number;
  readonly columns?: number;
  readonly tileWidth?: number;
};

const layout = (options: LayoutOptions) =>
  contactSheetLayout({ sourceWidth: 1920, sourceHeight: 1080, ...options });

const valueOf = (result: ReturnType<typeof contactSheetLayout>): ContactSheetLayout => {
  if (!result.ok) throw new Error(`expected a layout, got ${result.error.message}`);
  return result.value;
};

describe('contactSheetLayout', () => {
  it('lays four tiles of a wide composition into the default grid', () => {
    expect(valueOf(layout({ tileCount: 4 }))).toEqual({
      columns: defaultColumns,
      rows: 1,
      tileWidth: defaultTileWidth,
      tileHeight: 180,
      labelHeight: 24,
      gap: 8,
      padding: 8,
      width: 1320,
      height: 220,
    });
  });

  it('wraps the tiles into rows and never leaves an empty column', () => {
    const two = valueOf(layout({ tileCount: 2 }));
    expect(two).toMatchObject({ columns: 2, rows: 1, width: 664, height: 220 });
    const five = valueOf(layout({ tileCount: 5 }));
    expect(five).toMatchObject({ columns: 4, rows: 2, width: 1320, height: 432 });
    // An explicit column count is capped at the tile count, so a sheet never draws an empty cell.
    expect(valueOf(layout({ tileCount: 3, columns: 8 }))).toMatchObject({ columns: 3, rows: 1 });
  });

  it('keeps the composition aspect ratio and scales the frame labels with the tile', () => {
    const tall = valueOf(
      layout({ tileCount: 1, tileWidth: 100, sourceWidth: 1080, sourceHeight: 1920 }),
    );
    expect(tall).toMatchObject({ tileWidth: 100, tileHeight: 178, labelHeight: 12, gap: 3 });
    expect(valueOf(layout({ tileCount: 1, tileWidth: 640 }))).toMatchObject({
      tileHeight: 360,
      labelHeight: 48,
      gap: 16,
    });
  });

  it('rejects a tile count, column count or tile width a sheet cannot hold', () => {
    for (const options of [
      { tileCount: 0 },
      { tileCount: maxTiles + 1 },
      { tileCount: 1, columns: 0 },
      { tileCount: 1, columns: 2.5 },
      { tileCount: 1, tileWidth: 0 },
      { tileCount: 1, tileWidth: 10.5 },
      { tileCount: 1, sourceWidth: 0 },
    ]) {
      const result = layout(options);
      if (result.ok) throw new Error(`expected a refusal for ${JSON.stringify(options)}`);
      expect(result.error).toMatchObject({ code: 'cli.invalid-arguments', severity: 'error' });
    }
  });

  it('refuses a sheet the browser cannot rasterise', () => {
    const result = layout({ tileCount: maxTiles, tileWidth: 9_000, columns: 2 });
    if (result.ok) throw new Error('expected the dimension cap to refuse this sheet');
    expect(result.error.message).toContain(String(maxSheetDimension));
    expect(result.error.hint).toContain('--tile-width');
  });

  it('covers every tile with rows of columns and keeps whole-pixel dimensions', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: maxTiles }),
        fc.integer({ min: 1, max: 24 }),
        fc.integer({ min: 16, max: 640 }),
        fc.integer({ min: 1, max: 4_000 }),
        fc.integer({ min: 1, max: 4_000 }),
        (tileCount, columns, tileWidth, sourceWidth, sourceHeight) => {
          const result = contactSheetLayout({
            tileCount,
            columns,
            tileWidth,
            sourceWidth,
            sourceHeight,
          });
          if (!result.ok) return true; // a sheet too large to rasterise: covered above.
          const grid = result.value;
          for (const dimension of [
            grid.columns,
            grid.rows,
            grid.tileWidth,
            grid.tileHeight,
            grid.width,
            grid.height,
          ]) {
            expect(Number.isSafeInteger(dimension)).toBe(true);
            expect(dimension).toBeGreaterThan(0);
          }
          expect(grid.columns).toBeLessThanOrEqual(tileCount);
          expect(grid.rows * grid.columns).toBeGreaterThanOrEqual(tileCount);
          expect((grid.rows - 1) * grid.columns).toBeLessThan(tileCount);
          expect(grid.tileWidth).toBe(tileWidth);
          expect(grid.width).toBeGreaterThanOrEqual(grid.columns * grid.tileWidth);
          expect(grid.height).toBeGreaterThanOrEqual(grid.rows * grid.tileHeight);
          expect(grid.width).toBeLessThanOrEqual(maxSheetDimension);
          expect(grid.height).toBeLessThanOrEqual(maxSheetDimension);
        },
      ),
      { numRuns: 200 },
    );
  });
});
