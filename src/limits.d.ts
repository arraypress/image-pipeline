/**
 * What Chrome's canvas can hold and its encoders can write, measured in Chromium 156
 * (`tests/chromium.test.js` measures them again). Pure data.
 *
 * @module limits
 */
/** The longest side a canvas can have (px), in a page or a worker. One more and it draws nothing. */
export declare const CANVAS_MAX_SIDE = 65535;
/** The most pixels a canvas can have: 268,435,456 (16,384 × 16,384). One more and it draws nothing. */
export declare const CANVAS_MAX_AREA = 268435456;
/**
 * The types Chrome's canvas encodes. Asked for anything else (AVIF, GIF, JPEG XL, BMP, TIFF),
 * `convertToBlob` writes a PNG without a word, and there is no `ImageEncoder`.
 */
export declare const ENCODABLE_TYPES: readonly ["image/png", "image/jpeg", "image/webp"];
export type EncodableType = typeof ENCODABLE_TYPES[number];
/** @typedef {typeof ENCODABLE_TYPES[number]} EncodableType A type Chrome's canvas encodes. */
/**
 * The longest side each type's encoder writes (px). WebP's format stops at 16,383; JPEG's and
 * PNG's go past the canvas's own limit.
 *
 * @type {Readonly<Record<EncodableType, number>>}
 */
export declare const TYPE_MAX_SIDE: Readonly<Record<EncodableType, number>>;
/**
 * Why a picture of a size can't be drawn or written, or null when it can.
 *
 * @param {number} width - Its width (px).
 * @param {number} height - Its height (px).
 * @param {EncodableType} [type] - The type it's to be written as.
 * @returns {'empty' | 'side' | 'area' | null} `empty` (no pixels, or not whole numbers), `side`
 *   (a side too long for the canvas or the type), `area` (too many pixels), or null.
 * @example
 * sizeProblem(20_000, 100, 'image/webp'); // 'side'
 */
export declare function sizeProblem(width: number, height: number, type?: EncodableType): 'empty' | 'side' | 'area' | null;
