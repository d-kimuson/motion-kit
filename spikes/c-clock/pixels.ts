import { decodePng } from '../../src/render/check/png.ts';

/**
 * Where two Chromium captures of the same crop differ, in pixels of that crop. A failing comparison
 * keeps only its thrown message, so naming the differing pixels is what separates a stale composite
 * (the difference sits in one DOM box) from a raster or media difference (it sits somewhere else).
 * The decoder is the repository's own (`src/render/check/png.ts`); no dependency is added.
 */
export type PixelDifference = {
  readonly pixels: number;
  readonly channelValues: number;
  readonly total: number;
  /** `null` when nothing differs, or when the images are not comparable; `note` says which. */
  readonly box: {
    readonly x: readonly [number, number];
    readonly y: readonly [number, number];
  } | null;
  readonly samples: readonly string[];
  readonly note?: string;
};

const SAMPLES = 3;

export const pixelDifference = (left: Uint8Array, right: Uint8Array): PixelDifference => {
  const a = decodePng(new Uint8Array(left));
  const b = decodePng(new Uint8Array(right));
  const total = a.width * a.height;
  if (a.width !== b.width || a.height !== b.height || a.channels !== b.channels)
    return {
      pixels: -1,
      channelValues: -1,
      total,
      box: null,
      samples: [],
      note: `${a.width}x${a.height}x${a.channels} against ${b.width}x${b.height}x${b.channels}`,
    };
  const channels = a.channels;
  let pixels = 0;
  let channelValues = 0;
  let minX = a.width;
  let minY = a.height;
  let maxX = -1;
  let maxY = -1;
  const samples: string[] = [];
  for (let index = 0; index < total; index += 1) {
    let differs = false;
    for (let channel = 0; channel < channels; channel += 1)
      if (a.pixels[index * channels + channel] !== b.pixels[index * channels + channel]) {
        differs = true;
        channelValues += 1;
      }
    if (!differs) continue;
    pixels += 1;
    const x = index % a.width;
    const y = Math.floor(index / a.width);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
    if (samples.length < SAMPLES)
      samples.push(
        `${x},${y} ${a.pixels.slice(index * channels, (index + 1) * channels).join(',')} -> ${b.pixels.slice(index * channels, (index + 1) * channels).join(',')}`,
      );
  }
  return {
    pixels,
    channelValues,
    total,
    box: pixels === 0 ? null : { x: [minX, maxX], y: [minY, maxY] },
    samples,
  };
};
