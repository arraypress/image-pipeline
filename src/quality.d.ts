/**
 * The best quality that fits a file size. A lossy encoder's size grows with its quality, so the
 * highest quality whose file is no bigger than the target is found by halving the range: about
 * seven encodes for a whole per cent. Pure: the encoder is handed in.
 *
 * @module quality
 */
export type QualityResult = {
    /**
     * The encoded picture.
     */
    blob: Blob;
    /**
     * The quality it was written at, in whole per cent.
     */
    quality: number;
    /**
     * Whether it's within the target (false: even the lowest quality is over).
     */
    fits: boolean;
    /**
     * How many encodes it took.
     */
    tries: number;
};
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
export declare function searchQuality(encode: (quality: number) => Promise<Blob>, maxBytes: number, { min, max }?: {
    min?: number;
    max?: number;
}): Promise<QualityResult>;
