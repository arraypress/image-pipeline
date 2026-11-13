/**
 * An animated WebP put together from still ones. Chrome encodes a still WebP and decodes
 * animations (`ImageDecoder`), but writes no animation of any kind; the container is simple
 * enough to write here: each frame Chrome encoded goes in whole, drawn over the last without
 * blending. Pure.
 *
 * @module webp
 */
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
export declare function animatedWebp(frames: readonly {
    webp: Uint8Array;
    duration: number;
}[], { width, height, loops }: {
    width: number;
    height: number;
    loops?: number;
}): Uint8Array<ArrayBuffer>[];
