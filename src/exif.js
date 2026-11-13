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

import { ascii, viewOf } from './bytes.js';

/** Bytes per value, by TIFF type (1 BYTE … 12 DOUBLE). */
const TYPE_BYTES = [0, 1, 1, 2, 4, 8, 1, 1, 2, 4, 8, 4, 8];

/** The most entries a directory is believed to have. */
const MAX_ENTRIES = 512;

const TAG = Object.freeze({
  make: 0x010f, model: 0x0110, orientation: 0x0112, software: 0x0131, modified: 0x0132,
  exif: 0x8769, gps: 0x8825, interop: 0xa005, taken: 0x9003, lens: 0xa434,
  pixelWidth: 0xa002, pixelHeight: 0xa003, thumbnailOffset: 0x0201, thumbnailLength: 0x0202,
  latitudeRef: 1, latitude: 2, longitudeRef: 3, longitude: 4,
});

/**
 * @typedef {object} ExifSummary
 * @property {number} orientation EXIF orientation, 1–8 (1 when unset or out of range).
 * @property {string} make The camera's maker.
 * @property {string} model The camera.
 * @property {string} lens The lens.
 * @property {string} software What wrote the file.
 * @property {string} taken When it was taken, as written (“2026:11:13 10:22:05”), else when modified.
 * @property {{latitude: number, longitude: number} | null} location Where, in degrees, when it says and it can be read.
 * @property {boolean} hasLocation Whether it has a GPS directory at all.
 * @property {boolean} hasThumbnail Whether it carries a small copy of the picture.
 */

/**
 * @typedef {object} Entry One directory entry.
 * @property {number} at Where the entry is.
 * @property {number} tag
 * @property {number} type
 * @property {number} count
 * @property {number} bytes Its value's length.
 * @property {number} value Where its value is (inside the entry when it fits in four bytes).
 */

/**
 * @typedef {object} Tiff A TIFF block opened.
 * @property {Uint8Array} bytes
 * @property {DataView} view
 * @property {boolean} little Little-endian.
 * @property {number} first Where its first directory is.
 */

/**
 * Open a TIFF block.
 *
 * @param {Uint8Array} bytes - The block (EXIF without its “Exif\0\0” prefix).
 * @returns {Tiff | null} It, or null when it isn't one.
 */
function openTiff(bytes) {
  if (bytes.length < 14) return null;
  const order = ascii(bytes, 0, 2);
  if (order !== 'II' && order !== 'MM') return null;
  const view = viewOf(bytes);
  const little = order === 'II';
  if (view.getUint16(2, little) !== 42) return null;
  const first = view.getUint32(4, little);
  return first >= 8 && first + 6 <= bytes.length ? { bytes, view, little, first } : null;
}

/**
 * A directory's entries (those whose values lie inside the block).
 *
 * @param {Tiff} tiff - The block.
 * @param {number} offset - Where the directory is.
 * @returns {{entries: Entry[], count: number, next: number, end: number} | null} Its entries, how
 *   many it says it has, the next directory's offset, and where it ends; null when it doesn't fit.
 */
function directory(tiff, offset) {
  const { bytes, view, little } = tiff;
  if (offset < 8 || offset + 2 > bytes.length) return null;
  const count = view.getUint16(offset, little);
  const end = offset + 2 + count * 12 + 4;
  if (count > MAX_ENTRIES || end - 4 > bytes.length) return null;
  /** @type {Entry[]} */
  const entries = [];
  for (let i = 0; i < count; i++) {
    const at = offset + 2 + i * 12;
    const type = view.getUint16(at + 2, little);
    const items = view.getUint32(at + 4, little);
    const size = (TYPE_BYTES[type] ?? 0) * items;
    const value = size <= 4 ? at + 8 : view.getUint32(at + 8, little);
    if (!size || value + size > bytes.length) continue;
    entries.push({ at, tag: view.getUint16(at, little), type, count: items, bytes: size, value });
  }
  return { entries, count, next: end <= bytes.length ? view.getUint32(end - 4, little) : 0, end: Math.min(end, bytes.length) };
}

/**
 * @param {Tiff} tiff - The block.
 * @param {Entry | undefined} entry - An entry.
 * @returns {number} Its first value as a whole number (0 without one).
 */
function numberOf(tiff, entry) {
  if (!entry) return 0;
  if (entry.type === 3) return tiff.view.getUint16(entry.value, tiff.little);
  if (entry.type === 4) return tiff.view.getUint32(entry.value, tiff.little);
  return entry.type === 1 ? tiff.bytes[entry.value] : 0;
}

/**
 * @param {Tiff} tiff - The block.
 * @param {Entry | undefined} entry - An entry.
 * @returns {string} Its text, without control characters, at most 200 characters.
 */
function textOf(tiff, entry) {
  if (!entry || entry.type !== 2) return '';
  // eslint-disable-next-line no-control-regex
  return ascii(tiff.bytes, entry.value, Math.min(entry.bytes, 200)).replace(/\0.*$/s, '').replace(/[\x00-\x1f\x7f]/g, '').trim();
}

/**
 * Degrees from a GPS coordinate's three fractions and its hemisphere letter.
 *
 * @param {Tiff} tiff - The block.
 * @param {Entry | undefined} entry - Degrees, minutes, seconds.
 * @param {string} hemisphere - N, S, E or W.
 * @returns {number | null} Degrees (south and west negative), or null when it can't be read.
 */
function degreesOf(tiff, entry, hemisphere) {
  if (!entry || entry.type !== 5 || entry.count !== 3) return null;
  let degrees = 0;
  for (let i = 0; i < 3; i++) {
    const bottom = tiff.view.getUint32(entry.value + i * 8 + 4, tiff.little);
    if (!bottom) return null;
    degrees += tiff.view.getUint32(entry.value + i * 8, tiff.little) / bottom / 60 ** i;
  }
  return /^[SW]/i.test(hemisphere) ? -degrees : degrees;
}

/**
 * @param {Entry[] | undefined} entries - A directory's entries.
 * @param {number} tag - A tag.
 * @returns {Entry | undefined} Its entry.
 */
const find = (entries, tag) => entries?.find((entry) => entry.tag === tag);

/**
 * What a picture's EXIF says that matters here.
 *
 * @param {Uint8Array} bytes - The EXIF as a TIFF block (`sniffImage`'s `exif`).
 * @returns {ExifSummary | null} The summary, or null when the block can't be read.
 * @example
 * readExif(info.exif)?.hasLocation; // true: this photo says where it was taken
 */
export function readExif(bytes) {
  const tiff = openTiff(bytes);
  const main = tiff && directory(tiff, tiff.first);
  if (!tiff || !main) return null;
  const exif = directory(tiff, numberOf(tiff, find(main.entries, TAG.exif)))?.entries;
  const gps = directory(tiff, numberOf(tiff, find(main.entries, TAG.gps)))?.entries;
  const orientation = numberOf(tiff, find(main.entries, TAG.orientation));
  const latitude = degreesOf(tiff, find(gps, TAG.latitude), textOf(tiff, find(gps, TAG.latitudeRef)));
  const longitude = degreesOf(tiff, find(gps, TAG.longitude), textOf(tiff, find(gps, TAG.longitudeRef)));
  return {
    orientation: orientation >= 1 && orientation <= 8 ? orientation : 1,
    make: textOf(tiff, find(main.entries, TAG.make)),
    model: textOf(tiff, find(main.entries, TAG.model)),
    lens: textOf(tiff, find(exif, TAG.lens)),
    software: textOf(tiff, find(main.entries, TAG.software)),
    taken: textOf(tiff, find(exif, TAG.taken)) || textOf(tiff, find(main.entries, TAG.modified)),
    location: latitude !== null && longitude !== null ? { latitude, longitude } : null,
    hasLocation: Boolean(gps?.length),
    hasThumbnail: main.next >= 8 && main.next < bytes.length,
  };
}

/**
 * Set an entry's whole-number value, when it has one.
 *
 * @param {Tiff} tiff - The block.
 * @param {Entry | undefined} entry - The entry.
 * @param {number} value - The number.
 */
function setNumber(tiff, entry, value) {
  if (entry?.type === 3) tiff.view.setUint16(entry.value, Math.min(value, 65_535), tiff.little);
  else if (entry?.type === 4) tiff.view.setUint32(entry.value, value, tiff.little);
}

/**
 * Blank a directory: its values, then its entries.
 *
 * @param {Tiff} tiff - The block.
 * @param {number} offset - Where the directory is.
 */
function blank(tiff, offset) {
  const found = directory(tiff, offset);
  if (!found) return;
  for (const entry of found.entries) tiff.bytes.fill(0, entry.value, entry.value + entry.bytes);
  tiff.bytes.fill(0, offset, found.end);
}

/**
 * Take an entry out of a directory: the entries after it and the next-directory pointer move up.
 *
 * @param {Tiff} tiff - The block.
 * @param {number} offset - Where the directory is.
 * @param {Entry} entry - The entry.
 */
function removeEntry(tiff, offset, entry) {
  const count = tiff.view.getUint16(offset, tiff.little);
  const end = offset + 2 + count * 12 + 4;
  tiff.bytes.copyWithin(entry.at, entry.at + 12, end);
  tiff.bytes.fill(0, end - 12, end);
  tiff.view.setUint16(offset, count - 1, tiff.little);
}

/**
 * Where the data a directory keeps ends: itself and every value it points to.
 *
 * @param {Tiff} tiff - The block.
 * @param {number} offset - Where the directory is.
 * @returns {number} The furthest byte it uses, plus one (0 when it can't be read).
 */
function extent(tiff, offset) {
  const found = directory(tiff, offset);
  return found ? Math.max(found.end, ...found.entries.map((entry) => entry.value + entry.bytes)) : 0;
}

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
export function rewriteExif(bytes, { location = false, width, height } = {}) {
  const tiff = openTiff(bytes.slice());
  let main = tiff && directory(tiff, tiff.first);
  if (!tiff || !main) return null;
  setNumber(tiff, find(main.entries, TAG.orientation), 1);

  // The thumbnail: a second directory after the first, and the small JPEG it points to.
  if (main.next >= 8) {
    const thumbnail = directory(tiff, main.next)?.entries;
    const start = numberOf(tiff, find(thumbnail, TAG.thumbnailOffset));
    const length = numberOf(tiff, find(thumbnail, TAG.thumbnailLength));
    if (start >= 8 && start + length <= tiff.bytes.length) tiff.bytes.fill(0, start, start + length);
    blank(tiff, main.next);
    tiff.view.setUint32(main.end - 4, 0, tiff.little);
  }

  const gps = find(main.entries, TAG.gps);
  if (gps && !location) {
    blank(tiff, numberOf(tiff, gps));
    removeEntry(tiff, tiff.first, gps);
    // A broken block can point its GPS directory at the first one: then nothing is left to keep.
    main = directory(tiff, tiff.first);
    if (!main) return null;
  }

  const exifAt = numberOf(tiff, find(main.entries, TAG.exif));
  const exif = directory(tiff, exifAt)?.entries;
  if (width) setNumber(tiff, find(exif, TAG.pixelWidth), width);
  if (height) setNumber(tiff, find(exif, TAG.pixelHeight), height);

  // What's left ends where the kept directories' data ends: the blanked tail is cut off.
  const kept = [tiff.first, exifAt, numberOf(tiff, find(exif, TAG.interop)), location && gps ? numberOf(tiff, gps) : 0];
  const end = Math.max(...kept.map((offset) => extent(tiff, offset)));
  return tiff.bytes.subarray(0, Math.min(tiff.bytes.length, end + (end & 1)));
}
