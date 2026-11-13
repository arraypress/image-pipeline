/**
 * Resizing pixels properly: a Lanczos-3 filter as wide as the reduction (so every source pixel
 * counts, however much smaller the result), on light itself rather than on sRGB's numbers (a
 * black-and-white checkerboard shrinks to the grey the eye sees from a distance, 188, not 128),
 * with colour weighted by its opacity (no dark fringes round a cut-out). Rows are taken as they
 * come, in bands, so a 100-megapixel picture never has to be held as pixels all at once. Pure:
 * typed arrays in, typed arrays out.
 *
 * @module resample
 */
export type Weights = {
    starts: Int32Array;
    counts: Int32Array;
    weights: Float32Array;
    /**
     * The most source pixels any result pixel reads.
     */
    taps: number;
};
/**
 * One axis's filter.
 *
 * @param {number} from - The source's length (px).
 * @param {number} to - The result's length (px).
 * @returns {Weights} The weights.
 */
export declare function axisWeights(from: number, to: number): Weights;
export type ResampleOptions = {
    /**
     * The source's width (px).
     */
    srcWidth: number;
    /**
     * The source's height (px).
     */
    srcHeight: number;
    /**
     * The result's width (px).
     */
    width: number;
    /**
     * The result's height (px).
     */
    height: number;
    /**
     * Filter light itself (default), or sRGB's numbers as a canvas does (false).
     */
    linear?: boolean;
};
/**
 * @typedef {object} ResampleOptions
 * @property {number} srcWidth The source's width (px).
 * @property {number} srcHeight The source's height (px).
 * @property {number} width The result's width (px).
 * @property {number} height The result's height (px).
 * @property {boolean} [linear] Filter light itself (default), or sRGB's numbers as a canvas does (false).
 */
/**
 * A resize that takes the source a band of rows at a time.
 *
 * @param {ResampleOptions} options - The sizes.
 * @param {(rows: Uint8ClampedArray, y: number, count: number) => void} emit - Called with result
 *   rows (RGBA) as soon as the source rows they need have arrived: `count` rows from row `y`.
 * @returns {{write: (rgba: Uint8ClampedArray | Uint8Array, rows: number) => void, done: () => boolean}}
 *   `write` the next `rows` source rows (RGBA, not premultiplied), top to bottom; `done` once
 *   every result row has been emitted.
 * @example
 * const out = new Uint8ClampedArray(100 * 50 * 4);
 * const resize = createResampler({ srcWidth: 400, srcHeight: 200, width: 100, height: 50 }, (rows, y) => out.set(rows, y * 100 * 4));
 * resize.write(topHalf, 100);
 * resize.write(bottomHalf, 100);
 */
export declare function createResampler({ srcWidth, srcHeight, width, height, linear }: ResampleOptions, emit: (rows: Uint8ClampedArray, y: number, count: number) => void): {
    write: (rgba: Uint8ClampedArray | Uint8Array, rows: number) => void;
    done: () => boolean;
};
/**
 * Resize pixels held whole.
 *
 * @param {{data: Uint8ClampedArray | Uint8Array, width: number, height: number}} source - RGBA, not premultiplied.
 * @param {number} width - The result's width.
 * @param {number} height - The result's height.
 * @param {{linear?: boolean}} [options] - `linear: false` filters sRGB's numbers, as a canvas does.
 * @returns {{data: Uint8ClampedArray, width: number, height: number}} The result.
 * @example
 * const small = resamplePixels(context.getImageData(0, 0, 4000, 3000), 1600, 1200);
 */
export declare function resamplePixels(source: {
    data: Uint8ClampedArray | Uint8Array;
    width: number;
    height: number;
}, width: number, height: number, { linear }?: {
    linear?: boolean;
}): {
    data: Uint8ClampedArray;
    width: number;
    height: number;
};
