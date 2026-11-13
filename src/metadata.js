/**
 * EXIF put into a picture Chrome has just encoded. Chrome's encoders write pixels and (for a
 * wide-gamut canvas, and for every JPEG) a colour profile, and nothing else: no EXIF, no
 * location, no camera. To keep any of it, it's added here: a JPEG's APP1 segment, a PNG's `eXIf`
 * chunk, a WebP's `EXIF` chunk (the file made the extended kind when it isn't). Pure.
 *
 * @module metadata
 */

import { ascii, joinBytes, latin1, viewOf } from './bytes.js';
import { pngChunk } from './png.js';

/** The longest EXIF a JPEG segment holds (bytes): 65,535 less the length and “Exif\0\0”. */
export const JPEG_MAX_EXIF = 65_527;

/**
 * A JPEG with EXIF: an APP1 segment after the start marker and any JFIF header.
 *
 * @param {Uint8Array} jpeg - The JPEG.
 * @param {Uint8Array} exif - The TIFF block.
 * @returns {Uint8Array | null} The JPEG, or null when the EXIF is too long for one segment.
 */
function jpegWithExif(jpeg, exif) {
  if (exif.length > JPEG_MAX_EXIF) return null;
  const after = jpeg[2] === 0xff && jpeg[3] === 0xe0 ? 4 + ((jpeg[4] << 8) | jpeg[5]) : 2;
  const length = exif.length + 8;
  return joinBytes([jpeg.subarray(0, after), Uint8Array.of(0xff, 0xe1, length >> 8, length & 0xff), latin1('Exif\0\0'), exif, jpeg.subarray(after)]);
}

/**
 * A PNG with EXIF: an `eXIf` chunk before the first `IDAT`.
 *
 * @param {Uint8Array} png - The PNG.
 * @param {Uint8Array} exif - The TIFF block.
 * @returns {Uint8Array | null} The PNG, or null when no pixels are found.
 */
function pngWithExif(png, exif) {
  const view = viewOf(png);
  let offset = 8;
  while (offset + 12 <= png.length && ascii(png, offset + 4, 4) !== 'IDAT') offset += 12 + view.getUint32(offset);
  if (offset + 12 > png.length) return null;
  return joinBytes([png.subarray(0, offset), pngChunk('eXIf', exif), png.subarray(offset)]);
}

/**
 * A WebP with EXIF: an `EXIF` chunk at its end, flagged in its `VP8X` header (made, when the
 * file is the simple kind, from the picture's own size and transparency).
 *
 * @param {Uint8Array} webp - The WebP.
 * @param {Uint8Array} exif - The TIFF block.
 * @param {{width: number, height: number, alpha: boolean}} picture - The picture's size, and whether it's see-through.
 * @returns {Uint8Array<ArrayBuffer>} The WebP.
 */
function webpWithExif(webp, exif, picture) {
  let body = webp.subarray(12);
  if (ascii(webp, 12, 4) !== 'VP8X') {
    const header = new Uint8Array(18);
    header.set(latin1('VP8X'));
    header[4] = 10;
    header[8] = picture.alpha ? 0x10 : 0;
    const [w, h] = [picture.width - 1, picture.height - 1];
    header.set([w & 0xff, (w >> 8) & 0xff, (w >> 16) & 0xff, h & 0xff, (h >> 8) & 0xff, (h >> 16) & 0xff], 12);
    body = joinBytes([header, body]);
  } else body = body.slice();
  body[8] |= 0x08;
  const chunk = new Uint8Array(8 + exif.length + (exif.length & 1));
  chunk.set(latin1('EXIF'));
  viewOf(chunk).setUint32(4, exif.length, true);
  chunk.set(exif, 8);
  const riff = new Uint8Array(12);
  riff.set(latin1('RIFF'));
  viewOf(riff).setUint32(4, 4 + body.length + chunk.length, true);
  riff.set(latin1('WEBP'), 8);
  return joinBytes([riff, body, chunk]);
}

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
export function withExif(file, type, exif, picture) {
  if (type === 'image/jpeg') return jpegWithExif(file, exif);
  return type === 'image/png' ? pngWithExif(file, exif) : webpWithExif(file, exif, picture);
}
