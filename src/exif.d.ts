/**
 * EXIF, read and rewritten. Read: which way up the camera was, when and with what the picture
 * was taken, and whether it says where. Rewritten for a picture whose pixels have since been
 * turned upright, resized or cropped: orientation set to “as stored”, the embedded thumbnail
 * (a small copy of the picture as it was before any crop) removed, the pixel size corrected,
 * and the location removed unless it's asked for. Everything else stays byte for byte where it
 * was, so a camera's maker note still reads. Pure, and every offset is checked before it's read.
 *
 * @module exif
 */
export type ExifSummary = {
    /**
     * EXIF orientation, 1–8 (1 when unset or out of range).
     */
    orientation: number;
    /**
     * The camera's maker.
     */
    make: string;
    /**
     * The camera.
     */
    model: string;
    /**
     * The lens.
     */
    lens: string;
    /**
     * What wrote the file.
     */
    software: string;
    /**
     * When it was taken, as written (“2026:11:13 10:22:05”), else when modified.
     */
    taken: string;
    /**
     * Where, in degrees, when it says and it can be read.
     */
    location: {
        latitude: number;
        longitude: number;
    } | null;
    /**
     * Whether it has a GPS directory at all.
     */
    hasLocation: boolean;
    /**
     * Whether it carries a small copy of the picture.
     */
    hasThumbnail: boolean;
};
export type Entry = {
    /**
     * Where the entry is.
     */
    at: number;
    tag: number;
    type: number;
    count: number;
    /**
     * Its value's length.
     */
    bytes: number;
    /**
     * Where its value is (inside the entry when it fits in four bytes).
     */
    value: number;
};
export type Tiff = {
    bytes: Uint8Array;
    view: DataView;
    /**
     * Little-endian.
     */
    little: boolean;
    /**
     * Where its first directory is.
     */
    first: number;
};
/**
 * What a picture's EXIF says that matters here.
 *
 * @param {Uint8Array} bytes - The EXIF as a TIFF block (`sniffImage`'s `exif`).
 * @returns {ExifSummary | null} The summary, or null when the block can't be read.
 * @example
 * readExif(info.exif)?.hasLocation; // true: this photo says where it was taken
 */
export declare function readExif(bytes: Uint8Array): ExifSummary | null;
/**
 * EXIF for a picture whose pixels are now upright and may have been resized or cropped.
 *
 * @param {Uint8Array} bytes - The source's EXIF (a TIFF block). Not changed.
 * @param {{location?: boolean, width?: number, height?: number}} [options] - `location: true`
 *   keeps where it was taken (default: removed, the GPS directory's every byte blanked); the
 *   result's size in pixels, written where the EXIF records it.
 * @returns {Uint8Array | null} The new block, or null when the source can't be read.
 * @example
 * const exif = rewriteExif(info.exif, { location: false, width: 1600, height: 1200 });
 */
export declare function rewriteExif(bytes: Uint8Array, { location, width, height }?: {
    location?: boolean;
    width?: number;
    height?: number;
}): Uint8Array | null;
