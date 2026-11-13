/**
 * A PNG written with a palette. Chrome's canvas always writes 32-bit PNGs, so a 16-colour logo
 * or a screenshot of flat colour that came in as a PNG-8 goes out several times bigger. When a
 * picture has 256 colours or fewer it's written here instead, exactly: one to eight bits a
 * pixel, the palette's opacities in `tRNS`. Nothing is rounded to fit; a picture with more
 * colours isn't one of these. Pure but for the platform's `CompressionStream`.
 *
 * @module png
 */
/** The most colours a palette holds. */
export declare const MAX_PALETTE = 256;
/**
 * A picture's colours, when there are few enough for a palette.
 *
 * @param {Uint8ClampedArray | Uint8Array} rgba - Its pixels (a multiple of four bytes, aligned).
 * @param {Map<number, number>} [colours] - Colours found so far, to go on from (a picture read in bands).
 * @returns {Map<number, number> | null} Each colour (its four bytes as one number) and its place,
 *   or null once there are more than 256.
 */
export declare function paletteOf(rgba: Uint8ClampedArray | Uint8Array, colours?: Map<number, number>): Map<number, number> | null;
/**
 * One PNG chunk.
 *
 * @param {string} name - Its four-letter name.
 * @param {Uint8Array} data - Its contents.
 * @returns {Uint8Array<ArrayBuffer>} The chunk: length, name, contents, checksum.
 */
export declare function pngChunk(name: string, data: Uint8Array): Uint8Array<ArrayBuffer>;
/**
 * A PNG's chunks of some names, whole (to carry a colour profile from one PNG into another).
 *
 * @param {Uint8Array} png - The PNG.
 * @param {readonly string[]} names - The chunks wanted (“iCCP”).
 * @returns {Uint8Array[]} Those chunks, in the file's order.
 */
export declare function pngChunks(png: Uint8Array, names: readonly string[]): Uint8Array[];
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
export declare function encodeIndexedPng(picture: {
    data: Uint8ClampedArray | Uint8Array;
    width: number;
    height: number;
}, colours: Map<number, number>, extra?: readonly Uint8Array[]): Promise<Uint8Array<ArrayBuffer>>;
