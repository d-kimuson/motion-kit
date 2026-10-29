import { describe, expect, it } from 'vitest';

import { encodePng, headerOnlyPng } from './png-fixture.ts';
import { decodePng } from './png.ts';

const expand = (pixels: Uint8Array, colorType: 0 | 2 | 4 | 6): Uint8Array => {
  if (colorType === 2) return pixels;
  if (colorType === 6) return pixels;
  if (colorType === 0) {
    const result = new Uint8Array((pixels.length / 1) * 3);
    for (let index = 0; index < pixels.length; index += 1) {
      const grey = pixels[index] ?? 0;
      result[index * 3] = grey;
      result[index * 3 + 1] = grey;
      result[index * 3 + 2] = grey;
    }
    return result;
  }
  const result = new Uint8Array((pixels.length / 2) * 4);
  for (let index = 0; index < pixels.length / 2; index += 1) {
    const grey = pixels[index * 2] ?? 0;
    result[index * 4] = grey;
    result[index * 4 + 1] = grey;
    result[index * 4 + 2] = grey;
    result[index * 4 + 3] = pixels[index * 2 + 1] ?? 0;
  }
  return result;
};

const samples: Readonly<Record<0 | 2 | 4 | 6, Uint8Array>> = {
  0: new Uint8Array([10, 20, 30, 40, 50, 60]),
  2: new Uint8Array(Array.from({ length: 18 }, (_, index) => index * 13)),
  4: new Uint8Array(Array.from({ length: 12 }, (_, index) => index * 21)),
  6: new Uint8Array(Array.from({ length: 24 }, (_, index) => index * 11)),
};

describe('decodePng', () => {
  it('decodes every supported colour type under every filter type', () => {
    for (const colorType of [0, 2, 4, 6] as const) {
      for (const filter of [0, 1, 2, 3, 4]) {
        const pixels = samples[colorType];
        const png = encodePng({ width: 3, height: 2, colorType, pixels, filter });
        const decoded = decodePng(png);
        expect(decoded).toMatchObject({
          width: 3,
          height: 2,
          channels: colorType === 4 || colorType === 6 ? 4 : 3,
        });
        expect(decoded.pixels).toEqual(expand(pixels, colorType));
      }
    }
  });

  it('decodes a 1x1 image', () => {
    for (const colorType of [0, 2, 4, 6] as const) {
      const pixels = samples[colorType].slice(
        0,
        colorType === 0 ? 1 : colorType === 4 ? 2 : colorType === 2 ? 3 : 4,
      );
      const decoded = decodePng(encodePng({ width: 1, height: 1, colorType, pixels }));
      expect(decoded.width).toBe(1);
      expect(decoded.height).toBe(1);
      expect(decoded.pixels).toEqual(expand(pixels, colorType));
    }
  });

  it('rejects 16-bit samples', () => {
    expect(() => decodePng(headerOnlyPng({ bitDepth: 16 }))).toThrow(/8-bit/);
  });

  it('rejects interlaced samples', () => {
    expect(() => decodePng(headerOnlyPng({ interlace: 1 }))).toThrow(/interlaced/);
  });

  it('rejects palette samples', () => {
    expect(() => decodePng(headerOnlyPng({ colorType: 3 }))).toThrow(/colour type 3/);
  });

  it('rejects truncated data', () => {
    const valid = encodePng({
      width: 2,
      height: 2,
      colorType: 2,
      pixels: new Uint8Array(12),
    });
    expect(() => decodePng(valid.slice(0, valid.length - 5))).toThrow(/truncated|IEND/);
  });

  it('rejects a PNG without image data', () => {
    expect(() => decodePng(headerOnlyPng({}))).toThrow(/IDAT/);
  });
});
