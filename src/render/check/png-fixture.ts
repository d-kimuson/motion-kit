import { deflateSync } from 'node:zlib';

const concat = (parts: readonly Uint8Array[]): Uint8Array => {
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
};

const chunk = (type: string, data: Uint8Array): Uint8Array => {
  const result = new Uint8Array(12 + data.length);
  new DataView(result.buffer).setUint32(0, data.length);
  for (let index = 0; index < 4; index += 1) result[4 + index] = type.charCodeAt(index);
  result.set(data, 8);
  return result;
};

const signature = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const buildPng = (header: Uint8Array, idat: Uint8Array): Uint8Array =>
  concat([signature, chunk('IHDR', header), chunk('IDAT', idat), chunk('IEND', new Uint8Array())]);

const bytesPerPixel: Readonly<Record<number, number>> = { 0: 1, 2: 3, 4: 2, 6: 4 };

const paeth = (left: number, up: number, upLeft: number): number => {
  const prediction = left + up - upLeft;
  const leftDistance = Math.abs(prediction - left);
  const upDistance = Math.abs(prediction - up);
  const upLeftDistance = Math.abs(prediction - upLeft);
  if (leftDistance <= upDistance && leftDistance <= upLeftDistance) return left;
  if (upDistance <= upLeftDistance) return up;
  return upLeft;
};

const source = (pixels: Uint8Array, index: number): number => pixels[index] ?? 0;

/** A small encoder for tests: writes the requested filter byte on every scanline. */
export const encodePng = (options: {
  readonly width: number;
  readonly height: number;
  readonly colorType?: 0 | 2 | 4 | 6;
  readonly pixels: Uint8Array;
  readonly filter?: number | ((row: number) => number);
  readonly bitDepth?: number;
  readonly interlace?: number;
}): Uint8Array => {
  const { width, height, colorType = 2, pixels, filter = 0, bitDepth = 8, interlace = 0 } = options;
  const bpp = bytesPerPixel[colorType] ?? 0;
  const stride = width * bpp;
  const raw = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const filterType = typeof filter === 'function' ? filter(y) : filter;
    const filterOffset = y * (stride + 1);
    raw[filterOffset] = filterType;
    for (let x = 0; x < stride; x += 1) {
      const value = source(pixels, y * stride + x);
      const left = x >= bpp ? source(pixels, y * stride + x - bpp) : 0;
      const up = y === 0 ? 0 : source(pixels, (y - 1) * stride + x);
      const upLeft = y === 0 || x < bpp ? 0 : source(pixels, (y - 1) * stride + x - bpp);
      const predictor =
        filterType === 1
          ? left
          : filterType === 2
            ? up
            : filterType === 3
              ? Math.floor((left + up) / 2)
              : filterType === 4
                ? paeth(left, up, upLeft)
                : 0;
      raw[filterOffset + 1 + x] = (value - predictor) & 0xff;
    }
  }
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header[8] = bitDepth;
  header[9] = colorType;
  header[10] = 0;
  header[11] = 0;
  header[12] = interlace;
  return buildPng(header, deflateSync(raw));
};

/** A PNG whose IHDR declares an unsupported shape and has no pixel data. */
export const headerOnlyPng = (options: {
  readonly width?: number;
  readonly height?: number;
  readonly bitDepth?: number;
  readonly colorType?: number;
  readonly interlace?: number;
}): Uint8Array => {
  const { width = 1, height = 1, bitDepth = 8, colorType = 2, interlace = 0 } = options;
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header[8] = bitDepth;
  header[9] = colorType;
  header[10] = 0;
  header[11] = 0;
  header[12] = interlace;
  return buildPng(header, new Uint8Array());
};
