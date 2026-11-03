import { describe, expect, it } from 'vitest';

import { encodePng } from '../check/png-fixture.ts';
import { decodePng } from '../check/png.ts';
import { composeContactSheet } from './compose.ts';
import { contactSheetLayout } from './layout.ts';

/** An 8x8 tile filled with one colour, as the Composition capture would hand it over. */
const tile = (red: number, green: number, blue: number): Uint8Array => {
  const pixels = new Uint8Array(8 * 8 * 3);
  for (let index = 0; index < 64; index += 1) {
    pixels[index * 3] = red;
    pixels[index * 3 + 1] = green;
    pixels[index * 3 + 2] = blue;
  }
  return encodePng({ width: 8, height: 8, colorType: 2, pixels });
};

const layoutOf = (tileCount: number) => {
  const result = contactSheetLayout({
    tileCount,
    sourceWidth: 8,
    sourceHeight: 8,
    tileWidth: 64,
    columns: 2,
  });
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
};

const colors = [
  [255, 0, 0],
  [0, 255, 0],
  [0, 0, 255],
  [255, 255, 0],
] as const;

const tiles = colors.map(([red, green, blue], index) => ({
  frame: index * 10,
  timeSeconds: index / 4,
  image: tile(red, green, blue),
}));

/** One pixel of a composed sheet, as `[red, green, blue]`. */
const pixelAt = (image: ReturnType<typeof decodePng>, x: number, y: number): readonly number[] => {
  const offset = (y * image.width + x) * image.channels;
  return [
    image.pixels[offset] ?? -1,
    image.pixels[offset + 1] ?? -1,
    image.pixels[offset + 2] ?? -1,
  ];
};

const near = (actual: readonly number[], expected: readonly number[]): boolean =>
  expected.every((value, index) => Math.abs((actual[index] ?? -1) - value) <= 2);

/** A composed sheet, or the reason there is none; a test never cancels, so an abort is a failure. */
const valueOf = (result: Awaited<ReturnType<typeof composeContactSheet>>): Buffer => {
  if (result.ok) return result.value;
  throw new Error('aborted' in result ? 'the compose was aborted' : result.error.message);
};

describe('composeContactSheet', () => {
  it('screenshots the tiles into one PNG of the layout geometry, each in its own cell', async () => {
    const layout = layoutOf(tiles.length);
    const composed = await composeContactSheet({ tiles, layout });
    const image = decodePng(valueOf(composed));
    expect({ width: image.width, height: image.height }).toEqual({
      width: layout.width,
      height: layout.height,
    });
    // Chromium writes an opaque screenshot as RGB, so the sheet needs no backdrop of its own.
    expect(image.channels).toBe(3);
    for (const [index, expected] of colors.entries()) {
      const column = index % layout.columns;
      const row = Math.floor(index / layout.columns);
      const x = layout.padding + column * (layout.tileWidth + layout.gap) + layout.tileWidth / 2;
      const y =
        layout.padding +
        row * (layout.tileHeight + layout.labelHeight + layout.gap) +
        layout.tileHeight / 2;
      expect(near(pixelAt(image, x, y), expected)).toBe(true);
    }
  }, 60_000);

  it('produces the same bytes for the same tiles every time', async () => {
    const layout = layoutOf(tiles.length);
    const first = valueOf(await composeContactSheet({ tiles, layout }));
    const second = valueOf(await composeContactSheet({ tiles, layout }));
    expect(first.equals(second)).toBe(true);
  }, 120_000);

  it('draws a sheet well beyond the tiny fixture, so the screenshot is not proven only at 134x158', async () => {
    // Six tiles of 1000 px: 2 MP of sheet, which is the range a real Composition lands in.
    const large = contactSheetLayout({
      tileCount: tiles.length,
      sourceWidth: 8,
      sourceHeight: 8,
      tileWidth: 1_000,
      columns: 3,
    });
    if (!large.ok) throw new Error(large.error.message);
    const image = decodePng(valueOf(await composeContactSheet({ tiles, layout: large.value })));
    expect({ width: image.width, height: image.height }).toEqual({
      width: large.value.width,
      height: large.value.height,
    });
    expect(image.width * image.height).toBeGreaterThan(1_000_000);
    // Each tile is still where the layout says it is.
    for (const [index, expected] of colors.entries()) {
      const column = index % large.value.columns;
      const row = Math.floor(index / large.value.columns);
      const x = large.value.padding + column * (large.value.tileWidth + large.value.gap) + 500;
      const y =
        large.value.padding +
        row * (large.value.tileHeight + large.value.labelHeight + large.value.gap) +
        500;
      expect(near(pixelAt(image, x, y), expected)).toBe(true);
    }
  }, 120_000);

  it('reports a browser it could not launch instead of throwing', async () => {
    const composed = await composeContactSheet({
      tiles,
      layout: layoutOf(tiles.length),
      browser: { executablePath: '/nonexistent/motion-kit-chromium' },
    });
    if (composed.ok) throw new Error('expected the launch to fail');
    if ('aborted' in composed) throw new Error('expected a failure, not an abort');
    expect(composed.error).toMatchObject({
      code: 'render.browser-launch-failed',
      severity: 'error',
    });
  }, 60_000);
});
