/**
 * What the Chromium tests run inside the page: pictures made and read back with Chrome itself.
 * Loaded by the page as a module (`tests/browser.js` serves it).
 *
 * @module tests/page
 */

import * as lib from '../src/index.js';
import * as fixtures from '../src/testing.js';

export { lib, fixtures };

/**
 * A file's pixels as Chrome decodes them.
 *
 * @param {Blob} blob - The file.
 * @param {PredefinedColorSpace} [colorSpace] - The space to read them in.
 * @returns {Promise<{width: number, height: number, data: number[]}>} Its size and RGBA.
 */
export async function pixelsOf(blob, colorSpace = 'srgb') {
  const bitmap = await createImageBitmap(blob);
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const context = /** @type {OffscreenCanvasRenderingContext2D} */ (canvas.getContext('2d', { colorSpace }));
  context.drawImage(bitmap, 0, 0);
  return { width: bitmap.width, height: bitmap.height, data: [...context.getImageData(0, 0, bitmap.width, bitmap.height).data] };
}

/**
 * Pixels as a file, encoded by Chrome's canvas.
 *
 * @param {Uint8ClampedArray<ArrayBuffer>} rgba - The pixels.
 * @param {number} width - Their width.
 * @param {number} height - Their height.
 * @param {string} type - The type.
 * @param {number} [quality] - The quality.
 * @returns {Promise<Uint8Array<ArrayBuffer>>} The file's bytes.
 */
export async function encoded(rgba, width, height, type, quality = 1) {
  const canvas = new OffscreenCanvas(width, height);
  /** @type {OffscreenCanvasRenderingContext2D} */ (canvas.getContext('2d')).putImageData(new ImageData(rgba, width, height), 0, 0);
  return new Uint8Array(await (await canvas.convertToBlob({ type, quality })).arrayBuffer());
}

/**
 * Four blocks of colour: red and green above blue and white.
 *
 * @param {number} block - Each block's side (px).
 * @returns {Uint8ClampedArray<ArrayBuffer>} A picture two blocks wide and two high.
 */
export function quadrants(block) {
  const size = block * 2;
  const data = new Uint8ClampedArray(size * size * 4);
  const colours = [[255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 255]];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) data.set([...colours[(y < block ? 0 : 2) + (x < block ? 0 : 1)], 255], (y * size + x) * 4);
  return data;
}

/**
 * Which block colour is at a picture's four corners' middles: “r”, “g”, “b” or “w”, top left, top right, bottom left, bottom right.
 *
 * @param {{width: number, height: number, data: number[]}} pixels - A picture of four blocks.
 * @returns {string} Four letters.
 */
export function corners({ width, height, data }) {
  return [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]].map(([fx, fy]) => {
    const at = (Math.floor(height * fy) * width + Math.floor(width * fx)) * 4;
    const [r, g, b] = [data[at] > 128, data[at + 1] > 128, data[at + 2] > 128];
    return r && g && b ? 'w' : r ? 'r' : g ? 'g' : 'b';
  }).join('');
}

/**
 * Something like a photograph: smooth light with grain, the same every time.
 *
 * @param {number} width - Its width.
 * @param {number} height - Its height.
 * @returns {Uint8ClampedArray<ArrayBuffer>} Its pixels.
 */
export function photo(width, height) {
  const data = new Uint8ClampedArray(width * height * 4);
  let seed = 42;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      seed = (seed * 1_103_515_245 + 12_345) & 0x7fffffff;
      const grain = (seed >> 16) % 48;
      data.set([(x * 255) / width + grain, (y * 255) / height + grain, 128 + 100 * Math.sin((x + y) / 23) + grain, 255], (y * width + x) * 4);
    }
  }
  return data;
}

/**
 * How unevenly a zone plate's outer rings came out: the standard deviation of the pixels
 * between two distances from the middle (0 is the flat grey they should be).
 *
 * @param {ArrayLike<number>} data - The resized plate's pixels.
 * @param {number} size - Its side.
 * @param {number} from - The nearest pixels counted (px from the middle).
 * @returns {number} The deviation, in levels.
 */
export function unevenness(data, size, from) {
  let sum = 0;
  let squares = 0;
  let count = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const distance = Math.hypot(x - (size - 1) / 2, y - (size - 1) / 2);
      if (distance < from || distance > size / 2 - 4) continue;
      sum += data[(y * size + x) * 4];
      squares += data[(y * size + x) * 4] ** 2;
      count += 1;
    }
  }
  return Math.sqrt(squares / count - (sum / count) ** 2);
}
