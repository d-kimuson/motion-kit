import { type Diagnostic } from '../../lib/diagnostic.ts';
import { type Result } from '../../lib/result.ts';

// The grid a Contact Sheet draws its tiles into: geometry only, a pure function of the tile count,
// the Composition's aspect ratio and the two options that shape it. Keeping it out of the
// compositing step means the sheet's dimensions are known — and refusable — before a browser opens,
// and that the page a browser renders is a function of plain numbers.

/** Tiles per row when the caller names no `--columns`; capped at the tile count. */
export const defaultColumns = 4;

/** One tile's width in sheet pixels when the caller names no `--tile-width`. */
export const defaultTileWidth = 320;

/**
 * Tiles one sheet holds. A sheet is an overview read at a glance, and every tile is a captured PNG
 * held in memory until the page draws it, so the count is bounded rather than growing with the
 * Composition.
 */
export const maxTiles = 64;

/**
 * The largest sheet Chromium rasterises reliably in one screenshot. Both dimensions are checked
 * against it, so a grid the browser would refuse is an invocation error instead.
 */
export const maxSheetDimension = 16_384;

/**
 * The pixel budget of one sheet: a resource bound on the screenshot and on the decoded tiles, so a
 * sheet that is legal per side cannot still ask the browser for gigabytes of raster.
 */
export const maxSheetPixels = 32_000_000;

export type ContactSheetLayout = {
  readonly columns: number;
  readonly rows: number;
  /** One tile's image area, before its label strip. */
  readonly tileWidth: number;
  readonly tileHeight: number;
  /** The strip under each tile that carries its frame number and time. */
  readonly labelHeight: number;
  readonly gap: number;
  readonly padding: number;
  /** The whole sheet, padding included. */
  readonly width: number;
  readonly height: number;
};

const invalid = (message: string, hint: string): Result<never> => ({
  ok: false,
  error: {
    code: 'cli.invalid-arguments',
    severity: 'error',
    message,
    hint,
  } satisfies Diagnostic,
});

const isPositiveInteger = (value: number): boolean => Number.isSafeInteger(value) && value > 0;

/**
 * Fits `tileCount` tiles of `sourceWidth`x`sourceHeight` into `columns` columns of `tileWidth`
 * pixels. Every decoration (gap, padding, label strip) scales with the tile, so one sheet looks the
 * same at any tile width.
 */
export const contactSheetLayout = (options: {
  readonly tileCount: number;
  /** The Composition's own dimensions: they set each tile's aspect ratio. */
  readonly sourceWidth: number;
  readonly sourceHeight: number;
  readonly columns?: number | undefined;
  readonly tileWidth?: number | undefined;
}): Result<ContactSheetLayout> => {
  const { tileCount, sourceWidth, sourceHeight } = options;
  const requestedColumns = options.columns ?? defaultColumns;
  const tileWidth = options.tileWidth ?? defaultTileWidth;
  if (!isPositiveInteger(tileCount) || tileCount > maxTiles)
    return invalid(
      `The sheet would hold ${String(tileCount)} tiles, but one contact sheet holds 1 to ${String(maxTiles)}.`,
      `Raise --every until the sheet holds at most ${String(maxTiles)} frames, or narrow the range with --from and --to.`,
    );
  if (!isPositiveInteger(requestedColumns))
    return invalid(
      'The column count must be a positive integer.',
      'Use --columns with a positive integer, for example 4.',
    );
  if (!isPositiveInteger(tileWidth))
    return invalid(
      'The tile width must be a positive integer.',
      'Use --tile-width with a positive integer, for example 320.',
    );
  if (!isPositiveInteger(sourceWidth) || !isPositiveInteger(sourceHeight))
    return invalid(
      'The Composition dimensions are invalid, so a tile has no aspect ratio.',
      'Fix the Composition width and height; both must be positive integers.',
    );
  const columns = Math.min(requestedColumns, tileCount);
  const rows = Math.ceil(tileCount / columns);
  const tileHeight = Math.max(1, Math.round((tileWidth * sourceHeight) / sourceWidth));
  // The label strip and the gutters scale with the tile, floored so a small sheet stays legible.
  const labelHeight = Math.max(12, Math.round(tileWidth * 0.075));
  const gap = Math.max(2, Math.round(tileWidth * 0.025));
  const padding = gap;
  const width = padding * 2 + columns * tileWidth + (columns - 1) * gap;
  const height = padding * 2 + rows * (tileHeight + labelHeight) + (rows - 1) * gap;
  if (width > maxSheetDimension || height > maxSheetDimension)
    return invalid(
      `The sheet would be ${String(width)}x${String(height)} pixels, and a sheet is at most ${String(maxSheetDimension)} pixels on a side.`,
      'Lower --tile-width or --columns, or raise --every until fewer tiles fit.',
    );
  if (width * height > maxSheetPixels)
    return invalid(
      `The sheet would be ${String(width)}x${String(height)} pixels, more than the ${String(maxSheetPixels)} pixels one sheet may hold.`,
      'Lower --tile-width or --columns, or raise --every until fewer tiles fit.',
    );
  return {
    ok: true,
    value: { columns, rows, tileWidth, tileHeight, labelHeight, gap, padding, width, height },
  };
};
