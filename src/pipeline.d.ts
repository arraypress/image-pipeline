/**
 * A picture file in, a picture file out, in Chrome: decoded upright (its EXIF orientation
 * applied), the part kept read in bands and resized properly (`resample.js`), turned, flattened
 * onto a colour for JPEG, encoded at a quality or at the best quality that fits a size, its EXIF
 * put back when asked. Wide-gamut pictures (Display P3, Adobe RGB) are worked on in a Display P3
 * canvas, which Chrome writes out with a Display P3 profile, so they don't come out dull;
 * everything else stays sRGB, number for number. Animations (GIF, WebP, APNG) come out as
 * animated WebP, or as their first frame. Needs `createImageBitmap` and `OffscreenCanvas`: a
 * page or, better, a worker.
 *
 * @module pipeline
 */
import type { Crop, Orientation, Resize } from './geometry.js';
import type { EncodableType } from './limits.js';
import type { ImageInfo } from './sniff.js';
export type ImageFailure = 'unsupported' | 'too-large' | 'decode' | 'output-size' | 'encode';
/** A picture that couldn't be processed, with why. */
export declare class ImageError extends Error {
    /** @type {ImageFailure} */
    reason: ImageFailure;
    /**
     * @param {ImageFailure} reason - Why.
     * @param {string} [message] - What to say; a short English default by reason.
     */
    constructor(reason: ImageFailure, message?: string);
}
/** The default quality for JPEG and WebP: Chrome's own default for JPEG is 0.92, WebP's 0.8. */
export declare const DEFAULT_QUALITY = 0.82;
/** The quality at and above which Chrome writes WebP without loss. */
export declare const LOSSLESS_QUALITY = 1;
export type ProcessOptions = {
    /**
     * The type to write.
     */
    type: EncodableType;
    /**
     * JPEG or WebP quality, 0 to 1 (WebP at 1 is lossless). Default 0.82.
     */
    quality?: number;
    /**
     * A size to fit: the best quality that fits is found (a PNG has none to find).
     */
    maxBytes?: number;
    /**
     * When no quality fits `maxBytes`, make the picture smaller until one does. Default true.
     */
    shrink?: boolean;
    /**
     * Turn and flip.
     */
    orientation?: Orientation;
    /**
     * The part kept, as seen after the turn.
     */
    crop?: Crop | null;
    /**
     * The resize.
     */
    resize?: Resize;
    /**
     * Whether a resize may enlarge. Default false.
     */
    upscale?: boolean;
    /**
     * The colour under a JPEG's transparency (any CSS colour). Default white.
     */
    background?: string;
    /**
     * EXIF: removed (default), kept
     * without where it was taken, or kept whole. Orientation is always made upright and the
     * embedded thumbnail always removed.
     */
    metadata?: 'remove' | 'keep' | 'keep-location';
    /**
     * An animation's frames: all of them (as animated WebP,
     * when `type` is WebP), or the first only. Default `all`.
     */
    frames?: 'first' | 'all';
    /**
     * Resize light itself (default) or sRGB's numbers, as a canvas does (false).
     */
    linear?: boolean;
    /**
     * The most pixels a source may have. Default a canvas's limit, 268 million.
     */
    maxPixels?: number;
    /**
     * The file's facts, when already read (`sniffImage`).
     */
    info?: ImageInfo;
    /**
     * Stops the work between bands, frames and encodes.
     */
    signal?: AbortSignal;
};
export type ProcessResult = {
    /**
     * The result.
     */
    blob: Blob;
    /**
     * Its type.
     */
    type: EncodableType;
    /**
     * Its width (px).
     */
    width: number;
    /**
     * Its height (px).
     */
    height: number;
    /**
     * The quality it was written at, in per cent (null for PNG and lossless WebP).
     */
    quality: number | null;
    /**
     * Whether it's within `maxBytes` (true when none was asked).
     */
    fits: boolean;
    /**
     * Whether it was made smaller than asked to fit `maxBytes`.
     */
    shrunk: boolean;
    /**
     * How many frames it has (1 unless animated).
     */
    frames: number;
    /**
     * Whether the source was an animation and only its first frame was kept.
     */
    firstFrameOnly: boolean;
    /**
     * Whether it's a PNG with a palette.
     */
    indexed: boolean;
    /**
     * The space its colours are in (and tagged as).
     */
    colorSpace: 'srgb' | 'display-p3';
    /**
     * What became of the
     * source's EXIF: it had none; removed; kept without location; kept with it; too long for a JPEG to hold, so removed.
     */
    exif: 'none' | 'removed' | 'kept' | 'kept-location' | 'too-long';
    /**
     * The source's facts.
     */
    source: ImageInfo;
    /**
     * The source's size upright (after its EXIF orientation).
     */
    sourceSize: {
        width: number;
        height: number;
    };
};
/**
 * A canvas as a file of a type.
 *
 * @param {OffscreenCanvas} canvas - The canvas.
 * @param {EncodableType} type - The type.
 * @param {number} [quality] - JPEG or WebP quality, 0 to 1.
 * @returns {Promise<Blob>} The file.
 * @throws {ImageError} `encode`, when Chrome writes nothing or another type (it falls back to PNG without a word).
 * @example
 * const webp = await encodeCanvas(canvas, 'image/webp', 0.8);
 */
export declare function encodeCanvas(canvas: OffscreenCanvas, type: EncodableType, quality?: number): Promise<Blob>;
/**
 * Process a picture file.
 *
 * @param {Blob} file - The picture (PNG, JPEG, WebP, GIF, AVIF or BMP).
 * @param {ProcessOptions} options - What to do with it.
 * @returns {Promise<ProcessResult>} The result and how it came out.
 * @throws {ImageError} With `reason`, when it can't be done; the signal's own error when stopped.
 * @example
 * const { blob, width, height, quality } = await processImage(file, {
 *   type: 'image/webp', resize: { mode: 'longest', size: 1600 }, maxBytes: 200_000,
 * });
 */
export declare function processImage(file: Blob, options: ProcessOptions): Promise<ProcessResult>;
/**
 * A picture as a PNG or a JPG, nothing else changed: for saving a WebP or AVIF as something
 * older software opens. A JPG has no transparency, so transparent pixels go white.
 *
 * @param {Blob} image - The picture (any format Chrome decodes).
 * @param {'png' | 'jpg'} to - The format wanted.
 * @param {number} [quality] - A JPG's quality, 0 to 1. Default 0.92, close to what cameras write.
 * @returns {Promise<Blob>} The picture in that format.
 * @example
 * const png = await convertImage(new Blob([bytes], { type: 'image/webp' }), 'png');
 */
export declare function convertImage(image: Blob, to: 'png' | 'jpg', quality?: number): Promise<Blob>;
