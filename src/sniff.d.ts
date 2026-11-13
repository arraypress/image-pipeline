/**
 * What a picture file is, read from its headers before Chrome is asked to decode a pixel: its
 * type (from its bytes, never its name), its size, whether it moves, whether it can be
 * see-through, a PNG's palette, and where its EXIF and colour profile are. Enough to refuse a
 * picture that's too big with a plain message, and to carry across what matters. Pure but for
 * the reader it's handed.
 *
 * @module sniff
 */
import type { ByteReader } from './bytes.js';
export type SniffedType = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif' | 'image/avif' | 'image/bmp';
export type ImageInfo = {
    /**
     * What the bytes are.
     */
    type: SniffedType;
    /**
     * Width as stored (before any EXIF turn), px.
     */
    width: number;
    /**
     * Height as stored, px.
     */
    height: number;
    /**
     * More than one frame (GIF, WebP, APNG, AVIF sequence).
     */
    animated: boolean;
    /**
     * Whether the format says it can be see-through.
     */
    alpha: boolean;
    /**
     * A PNG's palette size (a PNG-8), else null.
     */
    palette: number | null;
    /**
     * Its EXIF (a TIFF block), when it has one that could be read.
     */
    exif: Uint8Array | null;
    /**
     * Its ICC colour profile, when it has one.
     */
    icc: Uint8Array | null;
    /**
     * Whether its colours are in a space other than sRGB (a profile
     * whose primaries aren't sRGB's, or a `cICP`/`nclx` tag naming other primaries).
     */
    wideGamut: boolean;
};
/**
 * Whether an ICC profile describes sRGB's colours: an RGB profile whose three primaries are
 * sRGB's. A grey or CMYK profile counts too (Chrome converts those into sRGB without loss of
 * range that matters); an RGB profile built from tables has no primaries to read and counts as
 * wider, the safe way round.
 *
 * @param {Uint8Array} icc - The profile.
 * @returns {boolean} It's sRGB, as far as output needs to know.
 */
export declare function isSrgbProfile(icc: Uint8Array): boolean;
/**
 * What a picture file is, from its bytes.
 *
 * @param {ByteReader} reader - The file (`blobReader(file)`, `bytesReader(bytes)`).
 * @returns {Promise<ImageInfo | null>} Its facts, or null when it isn't a PNG, JPEG, WebP, GIF,
 *   AVIF or BMP, or its headers are broken.
 * @example
 * const info = await sniffImage(blobReader(file));
 * if (info && info.width * info.height > 250e6) refuse();
 */
export declare function sniffImage(reader: ByteReader): Promise<ImageInfo | null>;
