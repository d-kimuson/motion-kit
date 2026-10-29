import { inflateSync } from 'node:zlib';

/** Decoded pixels are row-major, 8-bit and straight-alpha. Greyscale inputs expand to RGB(A). */
export type DecodedPng = {
  readonly width: number;
  readonly height: number;
  readonly channels: 3 | 4;
  readonly pixels: Uint8Array;
};

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;
const BYTES_PER_PIXEL: Readonly<Record<number, number>> = { 0: 1, 2: 3, 4: 2, 6: 4 };

/** An undecodable capture violates the capture contract; the check boundary converts this to
 * `internal.unexpected` rather than letting the Error escape as a user-facing failure.
 */
const decodingError = (reason: string): Error =>
  new Error(
    `The frame is not a decodable PNG: ${reason}. ` +
      'A capture that cannot be decoded is a contract violation; report it as internal.unexpected.',
  );

const at = (bytes: Uint8Array, index: number, reason: string): number => {
  const value = bytes[index];
  if (value === undefined) throw decodingError(reason);
  return value;
};

const readUint32 = (bytes: Uint8Array, offset: number, reason: string): number => {
  if (offset + 4 > bytes.length) throw decodingError(reason);
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0);
};

type PngHeader = {
  readonly width: number;
  readonly height: number;
  readonly colorType: 0 | 2 | 4 | 6;
};

const parseHeader = (data: Uint8Array): PngHeader => {
  if (data.length !== 13) throw decodingError('the IHDR chunk is malformed');
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const width = view.getUint32(0);
  const height = view.getUint32(4);
  const bitDepth = at(data, 8, 'the IHDR bit depth is missing');
  const colorType = at(data, 9, 'the IHDR colour type is missing');
  const compression = at(data, 10, 'the IHDR compression method is missing');
  const filterMethod = at(data, 11, 'the IHDR filter method is missing');
  const interlace = at(data, 12, 'the IHDR interlace method is missing');
  if (width === 0 || height === 0) throw decodingError('the image has an empty dimension');
  if (bitDepth !== 8) throw decodingError(`only 8-bit channels are supported, not ${bitDepth}-bit`);
  if (colorType !== 0 && colorType !== 2 && colorType !== 4 && colorType !== 6)
    throw decodingError(
      `colour type ${colorType} is not supported; use non-interlaced greyscale, RGB, greyscale+alpha or RGBA`,
    );
  if (compression !== 0) throw decodingError('the compression method is not 0');
  if (filterMethod !== 0) throw decodingError('the filter method is not 0');
  if (interlace !== 0) throw decodingError('interlaced PNGs are not supported');
  return { width, height, colorType };
};

const paeth = (left: number, up: number, upLeft: number): number => {
  const prediction = left + up - upLeft;
  const leftDistance = Math.abs(prediction - left);
  const upDistance = Math.abs(prediction - up);
  const upLeftDistance = Math.abs(prediction - upLeft);
  if (leftDistance <= upDistance && leftDistance <= upLeftDistance) return left;
  if (upDistance <= upLeftDistance) return up;
  return upLeft;
};

const unfilter = (compressed: Uint8Array, header: PngHeader): { rows: Uint8Array; bpp: number } => {
  const bpp = BYTES_PER_PIXEL[header.colorType] ?? 0;
  if (bpp === 0) throw decodingError('the colour type has no pixel layout');
  const stride = header.width * bpp;
  const expected = (stride + 1) * header.height;
  let decompressed: Uint8Array;
  try {
    decompressed = inflateSync(compressed);
  } catch {
    throw decodingError('the compressed image data is invalid');
  }
  if (decompressed.length < expected) throw decodingError('the image data is truncated');
  const filtered = decompressed.subarray(0, expected).slice();
  const rows = new Uint8Array(stride * header.height);
  let previous = new Uint8Array(stride);
  for (let y = 0; y < header.height; y += 1) {
    const filterOffset = y * (stride + 1);
    const filter = at(filtered, filterOffset, 'a scanline filter byte is missing');
    const sourceOffset = filterOffset + 1;
    const rowOffset = y * stride;
    for (let x = 0; x < stride; x += 1) {
      const raw = at(filtered, sourceOffset + x, 'a scanline is truncated');
      const left = x >= bpp ? at(rows, rowOffset + x - bpp, 'a scanline is truncated') : 0;
      const up = previous[x] ?? 0;
      const upLeft = x >= bpp ? (previous[x - bpp] ?? 0) : 0;
      let value: number;
      switch (filter) {
        case 0:
          value = raw;
          break;
        case 1:
          value = raw + left;
          break;
        case 2:
          value = raw + up;
          break;
        case 3:
          value = raw + Math.floor((left + up) / 2);
          break;
        case 4:
          value = raw + paeth(left, up, upLeft);
          break;
        default:
          throw decodingError(`filter type ${filter} is not defined`);
      }
      rows[rowOffset + x] = value & 0xff;
    }
    previous = rows.subarray(rowOffset, rowOffset + stride);
  }
  return { rows, bpp };
};

const expand = (rows: Uint8Array, header: PngHeader, bpp: number): DecodedPng => {
  const channels: 3 | 4 = header.colorType === 4 || header.colorType === 6 ? 4 : 3;
  const stride = header.width * bpp;
  const pixels = new Uint8Array(header.width * header.height * channels);
  for (let y = 0; y < header.height; y += 1) {
    for (let x = 0; x < header.width; x += 1) {
      const source = y * stride + x * bpp;
      const target = (y * header.width + x) * channels;
      if (header.colorType === 0) {
        const grey = at(rows, source, 'a scanline is truncated');
        pixels[target] = grey;
        pixels[target + 1] = grey;
        pixels[target + 2] = grey;
      } else if (header.colorType === 2) {
        pixels[target] = at(rows, source, 'a scanline is truncated');
        pixels[target + 1] = at(rows, source + 1, 'a scanline is truncated');
        pixels[target + 2] = at(rows, source + 2, 'a scanline is truncated');
      } else if (header.colorType === 4) {
        const grey = at(rows, source, 'a scanline is truncated');
        pixels[target] = grey;
        pixels[target + 1] = grey;
        pixels[target + 2] = grey;
        pixels[target + 3] = at(rows, source + 1, 'a scanline is truncated');
      } else {
        pixels[target] = at(rows, source, 'a scanline is truncated');
        pixels[target + 1] = at(rows, source + 1, 'a scanline is truncated');
        pixels[target + 2] = at(rows, source + 2, 'a scanline is truncated');
        pixels[target + 3] = at(rows, source + 3, 'a scanline is truncated');
      }
    }
  }
  return { width: header.width, height: header.height, channels, pixels };
};

/** Decode a non-interlaced 8-bit PNG (colour types 0, 2, 4 and 6, all five filters). */
export const decodePng = (bytes: Uint8Array): DecodedPng => {
  if (bytes.length < PNG_SIGNATURE.length) throw decodingError('the PNG signature is truncated');
  for (let index = 0; index < PNG_SIGNATURE.length; index += 1) {
    if (bytes[index] !== PNG_SIGNATURE[index])
      throw decodingError('the PNG signature does not match');
  }
  let offset = PNG_SIGNATURE.length;
  let header: PngHeader | undefined;
  let ended = false;
  const idat: Uint8Array[] = [];
  while (offset < bytes.length) {
    if (offset + 8 > bytes.length) throw decodingError('a chunk header is truncated');
    const length = readUint32(bytes, offset, 'a chunk length is truncated');
    const typeOffset = offset + 4;
    const type = String.fromCharCode(
      at(bytes, typeOffset, 'a chunk type is truncated'),
      at(bytes, typeOffset + 1, 'a chunk type is truncated'),
      at(bytes, typeOffset + 2, 'a chunk type is truncated'),
      at(bytes, typeOffset + 3, 'a chunk type is truncated'),
    );
    const dataOffset = offset + 8;
    if (dataOffset + length + 4 > bytes.length)
      throw decodingError(`the ${type} chunk is truncated`);
    const data = bytes.subarray(dataOffset, dataOffset + length);
    if (type === 'IHDR') {
      if (header !== undefined) throw decodingError('the PNG has more than one IHDR chunk');
      header = parseHeader(data);
    } else if (type === 'IDAT') {
      if (header === undefined) throw decodingError('the IDAT chunk precedes the IHDR chunk');
      idat.push(data);
    } else if (type === 'IEND') {
      ended = true;
      break;
    }
    offset = dataOffset + length + 4;
  }
  if (!ended) throw decodingError('the IEND chunk is missing');
  if (header === undefined) throw decodingError('the IHDR chunk is missing');
  if (idat.every((chunk) => chunk.length === 0)) throw decodingError('the IDAT chunk is missing');
  const { rows, bpp } = unfilter(Buffer.concat(idat), header);
  return expand(rows, header, bpp);
};
