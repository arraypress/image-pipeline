/**
 * EXIF put into a picture Chrome has just encoded. Chrome's encoders write pixels and (for a
 * wide-gamut canvas, and for every JPEG) a colour profile, and nothing else: no EXIF, no
 * location, no camera. To keep any of it, it's added here: a JPEG's APP1 segment, a PNG's `eXIf`
 * chunk, a WebP's `EXIF` chunk (the file made the extended kind when it isn't). Pure.
 *
 * @module metadata
 */
/** The longest EXIF a JPEG segment holds (bytes): 65,535 less the length and “Exif\0\0”. */
export declare const JPEG_MAX_EXIF = 65527;
/**
 * An encoded picture with EXIF added.
 *
 * @param {Uint8Array} file - The picture as Chrome encoded it (no EXIF of its own).
 * @param {'image/png' | 'image/jpeg' | 'image/webp'} type - Its type.
 * @param {Uint8Array} exif - The EXIF to add, a TIFF block (`rewriteExif`'s).
 * @param {{width: number, height: number, alpha: boolean}} picture - The picture's size, and whether it's see-through.
 * @returns {Uint8Array | null} The picture with it, or null when it can't hold it (EXIF over
 *   65,527 bytes in a JPEG; a PNG without pixels).
 * @example
 * const kept = withExif(new Uint8Array(await blob.arrayBuffer()), 'image/jpeg', rewriteExif(info.exif), { width, height, alpha: false });
 */
export declare function withExif(file: Uint8Array, type: 'image/png' | 'image/jpeg' | 'image/webp', exif: Uint8Array, picture: {
    width: number;
    height: number;
    alpha: boolean;
}): Uint8Array | null;
