/**
 * The best quality that fits a file size. A lossy encoder's size grows with its quality, so the
 * highest quality whose file is no bigger than the target is found by halving the range: about
 * seven encodes for a whole per cent. Pure: the encoder is handed in.
 *
 * @module quality
 */

/**
 * @typedef {object} QualityResult
 * @property {Blob} blob The encoded picture.
 * @property {number} quality The quality it was written at, in whole per cent.
 * @property {boolean} fits Whether it's within the target (false: even the lowest quality is over).
 * @property {number} tries How many encodes it took.
 */

/**
 * Find the highest quality whose file fits.
 *
 * @param {(quality: number) => Promise<Blob>} encode - Encode at a quality from 0 to 1.
 * @param {number} maxBytes - The most the file may be.
 * @param {{min?: number, max?: number}} [range] - The qualities to stay within, in per cent. Default 20 to 95.
 * @returns {Promise<QualityResult>} The best that fits, or the lowest quality's file marked `fits: false`.
 * @example
 * const { blob, quality } = await searchQuality((q) => canvas.convertToBlob({ type: 'image/jpeg', quality: q }), 200_000);
 */
export async function searchQuality(encode, maxBytes, { min = 20, max = 95 } = {}) {
  let tries = 1;
  const top = await encode(max / 100);
  if (top.size <= maxBytes) return { blob: top, quality: max, fits: true, tries };
  let low = min;
  let high = max - 1;
  /** @type {{blob: Blob, quality: number} | null} */
  let best = null;
  /** @type {{blob: Blob, quality: number} | null} */
  let lowest = null;
  while (low <= high) {
    const quality = (low + high) >> 1;
    const blob = await encode(quality / 100);
    tries += 1;
    if (blob.size <= maxBytes) {
      best = { blob, quality };
      low = quality + 1;
    } else {
      lowest = { blob, quality };
      high = quality - 1;
    }
  }
  // With none that fits, the halving ended on the lowest quality: that file is the answer.
  return best ? { ...best, fits: true, tries } : { .../** @type {{blob: Blob, quality: number}} */ (lowest), fits: false, tries };
}
