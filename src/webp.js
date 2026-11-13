/**
 * An animated WebP put together from still ones. Chrome encodes a still WebP and decodes
 * animations (`ImageDecoder`), but writes no animation of any kind; the container is simple
 * enough to write here: each frame Chrome encoded goes in whole, drawn over the last without
 * blending. Pure.
 *
 * @module webp
 */

import { ascii, joinBytes, latin1, viewOf } from './bytes.js';

/** The longest a frame can show (ms): the container keeps 24 bits. */
const MAX_DURATION = 0xffffff;

/**
 * @param {number} value - A number under 2^24.
 * @returns {number[]} Its three bytes, little end first.
 */
const uint24 = (value) => [value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff];

/**
 * A RIFF chunk.
 *
 * @param {string} name - Its four-letter name.
 * @param {Uint8Array} data - Its contents.
 * @returns {Uint8Array<ArrayBuffer>} The chunk, padded to an even length.
 */
function riffChunk(name, data) {
  const chunk = new Uint8Array(8 + data.length + (data.length & 1));
  chunk.set(latin1(name));
  viewOf(chunk).setUint32(4, data.length, true);
  chunk.set(data, 8);
  return chunk;
}

/**
 * The chunks of a still WebP that hold its picture: `ALPH` and `VP8 `, or `VP8L`.
 *
 * @param {Uint8Array} webp - A still WebP.
 * @returns {{chunks: Uint8Array[], alpha: boolean}} Those chunks, whole, and whether it can be see-through.
 */
function pictureChunks(webp) {
  const view = viewOf(webp);
  const chunks = [];
  let alpha = false;
  for (let offset = 12; offset + 8 <= webp.length;) {
    const name = ascii(webp, offset, 4);
    const length = view.getUint32(offset + 4, true);
    const size = 8 + length + (length & 1);
    if (name === 'ALPH' || name === 'VP8 ' || name === 'VP8L') chunks.push(webp.subarray(offset, offset + size));
    if (name === 'ALPH' || (name === 'VP8L' && webp[offset + 12] & 0x10)) alpha = true;
    offset += size;
  }
  return { chunks, alpha };
}

/**
 * An animated WebP.
 *
 * @param {readonly {webp: Uint8Array, duration: number}[]} frames - Each frame as a still WebP
 *   the size of the animation, and how long it shows (ms).
 * @param {{width: number, height: number, loops?: number}} animation - The animation's size
 *   (px), and how many times it plays (0, the default: for ever).
 * @returns {Uint8Array<ArrayBuffer>[]} The file, in parts (a `Blob`'s parts: a long animation is never one array).
 * @example
 * const blob = new Blob(animatedWebp(frames, { width: 320, height: 240 }), { type: 'image/webp' });
 */
export function animatedWebp(frames, { width, height, loops = 0 }) {
  const size = [...uint24(width - 1), ...uint24(height - 1)];
  let alpha = false;
  const parts = frames.map((frame) => {
    const picture = pictureChunks(frame.webp);
    alpha ||= picture.alpha;
    const duration = Math.min(MAX_DURATION, Math.max(0, Math.round(frame.duration)));
    // At 0,0, the whole canvas, not blended with the frame before (bit 1), left in place after.
    return riffChunk('ANMF', joinBytes([Uint8Array.from([0, 0, 0, 0, 0, 0, ...size, ...uint24(duration), 0x02]), ...picture.chunks]));
  });
  const header = riffChunk('VP8X', Uint8Array.from([0x02 | (alpha ? 0x10 : 0), 0, 0, 0, ...size]));
  const anim = riffChunk('ANIM', Uint8Array.from([0, 0, 0, 0, loops & 0xff, (loops >> 8) & 0xff]));
  const riff = new Uint8Array(12);
  riff.set(latin1('RIFF'));
  viewOf(riff).setUint32(4, 4 + header.length + anim.length + parts.reduce((sum, part) => sum + part.length, 0), true);
  riff.set(latin1('WEBP'), 8);
  return [riff, header, anim, ...parts];
}
