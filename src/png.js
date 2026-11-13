/**
 * A PNG written with a palette. Chrome's canvas always writes 32-bit PNGs, so a 16-colour logo
 * or a screenshot of flat colour that came in as a PNG-8 goes out several times bigger. When a
 * picture has 256 colours or fewer it's written here instead, exactly: one to eight bits a
 * pixel, the palette's opacities in `tRNS`. Nothing is rounded to fit; a picture with more
 * colours isn't one of these. Pure but for the platform's `CompressionStream`.
 *
 * @module png
 */

import { ascii, crc32, joinBytes, latin1, throughStream, uint32s, viewOf } from './bytes.js';

/** The most colours a palette holds. */
export const MAX_PALETTE = 256;

/**
 * A picture's colours, when there are few enough for a palette.
 *
 * @param {Uint8ClampedArray | Uint8Array} rgba - Its pixels (a multiple of four bytes, aligned).
 * @param {Map<number, number>} [colours] - Colours found so far, to go on from (a picture read in bands).
 * @returns {Map<number, number> | null} Each colour (its four bytes as one number) and its place,
 *   or null once there are more than 256.
 */
export function paletteOf(rgba, colours = new Map()) {
  const pixels = new Uint32Array(rgba.buffer, rgba.byteOffset, rgba.byteLength >> 2);
  let last = -1;
  for (let i = 0; i < pixels.length; i++) {
    const pixel = pixels[i];
    if (pixel === last) continue;
    last = pixel;
    if (colours.has(pixel)) continue;
    if (colours.size === MAX_PALETTE) return null;
    colours.set(pixel, colours.size);
  }
  return colours;
}

/**
 * One PNG chunk.
 *
 * @param {string} name - Its four-letter name.
 * @param {Uint8Array} data - Its contents.
 * @returns {Uint8Array<ArrayBuffer>} The chunk: length, name, contents, checksum.
 */
export function pngChunk(name, data) {
  const type = latin1(name);
  return joinBytes([uint32s([data.length]), type, data, uint32s([crc32([type, data])])]);
}

/**
 * A PNG's chunks of some names, whole (to carry a colour profile from one PNG into another).
 *
 * @param {Uint8Array} png - The PNG.
 * @param {readonly string[]} names - The chunks wanted (“iCCP”).
 * @returns {Uint8Array[]} Those chunks, in the file's order.
 */
export function pngChunks(png, names) {
  const view = viewOf(png);
  const found = [];
  for (let offset = 8; offset + 12 <= png.length;) {
    const size = 12 + view.getUint32(offset);
    if (names.includes(ascii(png, offset + 4, 4))) found.push(png.subarray(offset, offset + size));
    offset += size;
  }
  return found;
}

/**
 * A picture as a PNG with a palette.
 *
 * @param {{data: Uint8ClampedArray | Uint8Array, width: number, height: number}} picture - Its pixels (RGBA).
 * @param {Map<number, number>} colours - Its colours (`paletteOf`).
 * @param {readonly Uint8Array[]} [extra] - Whole chunks to put before the palette (a colour profile).
 * @returns {Promise<Uint8Array<ArrayBuffer>>} The PNG.
 * @example
 * const colours = paletteOf(pixels.data);
 * const png = colours && await encodeIndexedPng(pixels, colours);
 */
export async function encodeIndexedPng(picture, colours, extra = []) {
  const { width, height } = picture;
  // See-through colours first, so the opacity table can stop at the last of them.
  const ordered = [...colours.keys()].sort((a, b) => (a >>> 24) - (b >>> 24));
  const place = new Map(ordered.map((colour, index) => [colour, index]));
  const depth = ordered.length <= 2 ? 1 : ordered.length <= 4 ? 2 : ordered.length <= 16 ? 4 : 8;
  const rowBytes = 1 + Math.ceil((width * depth) / 8);
  const rows = new Uint8Array(rowBytes * height);
  const pixels = new Uint32Array(picture.data.buffer, picture.data.byteOffset, width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = /** @type {number} */ (place.get(pixels[y * width + x]));
      rows[y * rowBytes + 1 + ((x * depth) >> 3)] |= index << (8 - depth - ((x * depth) & 7));
    }
  }
  const header = joinBytes([uint32s([width, height]), Uint8Array.of(depth, 3, 0, 0, 0)]);
  // A pixel's bytes are R, G, B, A in memory order; as one little-endian number, A is the top byte.
  const palette = Uint8Array.from(ordered.flatMap((colour) => [colour & 0xff, (colour >>> 8) & 0xff, (colour >>> 16) & 0xff]));
  const opaqueFrom = ordered.findIndex((colour) => colour >>> 24 === 255);
  const opacities = Uint8Array.from(ordered.slice(0, opaqueFrom < 0 ? ordered.length : opaqueFrom), (colour) => colour >>> 24);
  return joinBytes([
    latin1('\x89PNG\r\n\x1a\n'), pngChunk('IHDR', header), ...extra, pngChunk('PLTE', palette),
    ...(opacities.length ? [pngChunk('tRNS', opacities)] : []),
    pngChunk('IDAT', await throughStream(rows, new CompressionStream('deflate'))), pngChunk('IEND', new Uint8Array(0)),
  ]);
}
