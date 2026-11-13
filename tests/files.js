/**
 * Picture files' headers made by hand for the sniffing tests: enough of each format for its
 * facts to be read (no pixels a decoder would accept).
 *
 * @module tests/files
 */

import { joinBytes, latin1, viewOf } from '../src/bytes.js';

/**
 * A JPEG segment.
 *
 * @param {number} marker - Its marker's second byte.
 * @param {Uint8Array} body - Its contents.
 * @returns {Uint8Array} The segment.
 */
export function segment(marker, body) {
  return joinBytes([Uint8Array.of(0xff, marker, (body.length + 2) >> 8, (body.length + 2) & 0xff), body]);
}

/**
 * A JPEG's headers.
 *
 * @param {{width: number, height: number, exif?: Uint8Array, icc?: Uint8Array, iccParts?: number, progressive?: boolean}} facts - What it says.
 * @returns {Uint8Array} The file, up to its first scan.
 */
export function jpegHeaders({ width, height, exif, icc, iccParts = 1, progressive = false }) {
  const parts = [Uint8Array.of(0xff, 0xd8), segment(0xe0, latin1('JFIF\0\x01\x01\0\0\x01\0\x01\0\0'))];
  if (exif) parts.push(segment(0xe1, joinBytes([latin1('Exif\0\0'), exif])));
  if (icc) {
    const each = Math.ceil(icc.length / iccParts);
    for (let part = 0; part < iccParts; part++) parts.push(segment(0xe2, joinBytes([latin1('ICC_PROFILE\0'), Uint8Array.of(part + 1, iccParts), icc.subarray(part * each, (part + 1) * each)])));
  }
  parts.push(segment(0xdb, new Uint8Array(65)));
  parts.push(segment(progressive ? 0xc2 : 0xc0, Uint8Array.of(8, height >> 8, height & 0xff, width >> 8, width & 0xff, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1)));
  parts.push(segment(0xda, new Uint8Array(10)), new Uint8Array(32), Uint8Array.of(0xff, 0xd9));
  return joinBytes(parts);
}

/**
 * A RIFF chunk.
 *
 * @param {string} name - Its name.
 * @param {Uint8Array} body - Its contents.
 * @returns {Uint8Array} The chunk, padded.
 */
export function riff(name, body) {
  const chunk = new Uint8Array(8 + body.length + (body.length & 1));
  chunk.set(latin1(name));
  viewOf(chunk).setUint32(4, body.length, true);
  chunk.set(body, 8);
  return chunk;
}

/**
 * A WebP file around some chunks.
 *
 * @param {Uint8Array[]} chunks - Its chunks.
 * @returns {Uint8Array} The file.
 */
export function webpFile(chunks) {
  const body = joinBytes([latin1('WEBP'), ...chunks]);
  return joinBytes([riff('RIFF', body).subarray(0, 8), body]);
}

/**
 * A lossy WebP's picture chunk's contents.
 *
 * @param {number} width - Its width.
 * @param {number} height - Its height.
 * @returns {Uint8Array} The contents (a frame header and no more).
 */
export function vp8(width, height) {
  return Uint8Array.of(0x10, 0, 0, 0x9d, 0x01, 0x2a, width & 0xff, width >> 8, height & 0xff, height >> 8, 0, 0);
}

/**
 * A lossless WebP's picture chunk's contents.
 *
 * @param {number} width - Its width.
 * @param {number} height - Its height.
 * @param {boolean} alpha - Whether it says it's see-through.
 * @returns {Uint8Array} The contents (a header and no more).
 */
export function vp8l(width, height, alpha) {
  const bytes = new Uint8Array(6);
  bytes[0] = 0x2f;
  viewOf(bytes).setUint32(1, ((width - 1) | ((height - 1) << 14) | ((alpha ? 1 : 0) << 28)) >>> 0, true);
  return bytes;
}

/**
 * An extended WebP's header chunk's contents.
 *
 * @param {number} flags - Its flags.
 * @param {number} width - The canvas's width.
 * @param {number} height - The canvas's height.
 * @returns {Uint8Array} The contents.
 */
export function vp8x(flags, width, height) {
  const [w, h] = [width - 1, height - 1];
  return Uint8Array.of(flags, 0, 0, 0, w & 0xff, (w >> 8) & 0xff, w >> 16, h & 0xff, (h >> 8) & 0xff, h >> 16);
}

/**
 * An ISO media box.
 *
 * @param {string} name - Its name.
 * @param {Uint8Array[]} parts - Its contents.
 * @returns {Uint8Array} The box.
 */
export function box(name, parts) {
  const body = joinBytes(parts);
  const head = new Uint8Array(8);
  viewOf(head).setUint32(0, body.length + 8);
  head.set(latin1(name), 4);
  return joinBytes([head, body]);
}

/**
 * An ICC profile's skeleton: an RGB profile with three primaries.
 *
 * @param {[number, number, number][]} primaries - Red, green and blue as XYZ.
 * @returns {Uint8Array} The profile.
 */
export function iccProfile(primaries) {
  const profile = new Uint8Array(132 + 3 * 12 + 3 * 20);
  const view = viewOf(profile);
  profile.set(latin1('RGB '), 16);
  view.setUint32(128, 3);
  ['rXYZ', 'gXYZ', 'bXYZ'].forEach((name, index) => {
    const at = 132 + 36 + index * 20;
    profile.set(latin1(name), 132 + index * 12);
    view.setUint32(136 + index * 12, at);
    view.setUint32(140 + index * 12, 20);
    profile.set(latin1('XYZ '), at);
    primaries[index].forEach((value, axis) => view.setInt32(at + 8 + axis * 4, Math.round(value * 65_536)));
  });
  return profile;
}

/** sRGB's primaries as an ICC profile stores them, and Display P3's. */
export const PRIMARIES = /** @type {const} */ ({
  srgb: [[0.4360, 0.2225, 0.0139], [0.3851, 0.7169, 0.0971], [0.1431, 0.0606, 0.7139]],
  p3: [[0.5151, 0.2412, -0.0011], [0.2920, 0.6922, 0.0419], [0.1571, 0.0666, 0.7841]],
});
