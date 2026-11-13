/**
 * Picture files made for tests, byte by byte, so every pixel and every tag is known: EXIF blocks
 * (orientation, camera, location, a thumbnail), PNGs (with any extra chunks, and animated),
 * animated GIFs, and patterns that show up a bad resize. For this library's tests and those of
 * whatever uses it. Runs in Node 20+ and browsers.
 *
 * @module testing
 */
/**
 * An EXIF block as a camera writes one.
 *
 * @param {object} [facts] - What it says.
 * @param {number} [facts.orientation] - EXIF orientation, 1–8.
 * @param {string} [facts.make] - The maker.
 * @param {string} [facts.model] - The camera.
 * @param {string} [facts.taken] - When, “2026:11:13 10:22:05”.
 * @param {{latitude: number, longitude: number}} [facts.location] - Where.
 * @param {Uint8Array} [facts.thumbnail] - A small JPEG, in a second directory.
 * @param {Uint8Array} [facts.makerNote] - A maker note's bytes.
 * @param {{width: number, height: number}} [facts.pixels] - The picture's size, as the camera records it.
 * @param {boolean} [facts.little] - Little-endian (default) or big.
 * @returns {Uint8Array<ArrayBuffer>} The block (TIFF), without “Exif\0\0”.
 * @example
 * const exif = buildExif({ orientation: 6, model: 'Pixel 9', location: { latitude: 51.5007, longitude: -0.1246 } });
 */
export declare function buildExif({ orientation, make, model, taken, location, thumbnail, makerNote, pixels, little }?: {
    orientation?: number;
    make?: string;
    model?: string;
    taken?: string;
    location?: {
        latitude: number;
        longitude: number;
    };
    thumbnail?: Uint8Array;
    makerNote?: Uint8Array;
    pixels?: {
        width: number;
        height: number;
    };
    little?: boolean;
}): Uint8Array<ArrayBuffer>;
/**
 * A 32-bit PNG of known pixels.
 *
 * @param {Uint8Array | Uint8ClampedArray} rgba - Its pixels, row by row.
 * @param {number} width - Its width.
 * @param {number} height - Its height.
 * @param {readonly Uint8Array[]} [chunks] - Whole chunks to put before the pixels (`pngChunk('cICP', …)`, `pngChunk('eXIf', exif)`).
 * @returns {Promise<Uint8Array<ArrayBuffer>>} The PNG.
 * @example
 * const p3 = await buildPng(pixels, 4, 4, [pngChunk('cICP', Uint8Array.of(12, 13, 0, 1))]); // Display P3
 */
export declare function buildPng(rgba: Uint8Array | Uint8ClampedArray, width: number, height: number, chunks?: readonly Uint8Array[]): Promise<Uint8Array<ArrayBuffer>>;
/**
 * An animated PNG of known frames, each the whole picture.
 *
 * @param {readonly (Uint8Array | Uint8ClampedArray)[]} frames - Each frame's pixels (RGBA).
 * @param {number} width - The width.
 * @param {number} height - The height.
 * @param {number} [delay] - How long each frame shows (ms). Default 100.
 * @returns {Promise<Uint8Array<ArrayBuffer>>} The APNG.
 */
export declare function buildApng(frames: readonly (Uint8Array | Uint8ClampedArray)[], width: number, height: number, delay?: number): Promise<Uint8Array<ArrayBuffer>>;
/**
 * An animated GIF of known frames. Written without compression (a clear code before the table
 * can grow), so it's bigger than a real one and every pixel is exactly its palette entry.
 *
 * @param {readonly Uint8Array[]} frames - Each frame's pixels, as palette indexes, the whole picture.
 * @param {object} options - The picture.
 * @param {number} options.width - Its width.
 * @param {number} options.height - Its height.
 * @param {readonly (readonly [number, number, number])[]} options.palette - Its colours (2 to 128).
 * @param {number} [options.delay] - How long each frame shows (ms, to the nearest 10). Default 100.
 * @param {number} [options.transparent] - A palette index that's see-through.
 * @returns {Uint8Array<ArrayBuffer>} The GIF.
 * @example
 * const gif = buildGif([Uint8Array.of(0, 1, 1, 0), Uint8Array.of(1, 0, 0, 1)], { width: 2, height: 2, palette: [[255, 0, 0], [0, 0, 255]] });
 */
export declare function buildGif(frames: readonly Uint8Array[], { width, height, palette, delay, transparent }: {
    width: number;
    height: number;
    palette: readonly (readonly [number, number, number])[];
    delay?: number;
    transparent?: number;
}): Uint8Array<ArrayBuffer>;
/**
 * A checkerboard of single pixels, black and white: the hardest thing to shrink. Done properly
 * it becomes an even grey; done badly, stripes and blotches.
 *
 * @param {number} width - Its width.
 * @param {number} height - Its height.
 * @returns {Uint8ClampedArray<ArrayBuffer>} Its pixels (RGBA, opaque).
 */
export declare function checkerboard(width: number, height: number): Uint8ClampedArray<ArrayBuffer>;
/**
 * A zone plate: rings that get finer towards the edge, every spatial frequency at once. A resize
 * that doesn't filter enough turns the fine rings into false coarse ones (moiré).
 *
 * @param {number} size - Its width and height.
 * @returns {Uint8ClampedArray<ArrayBuffer>} Its pixels (RGBA, opaque greys).
 */
export declare function zonePlate(size: number): Uint8ClampedArray<ArrayBuffer>;
