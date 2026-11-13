/**
 * What a picture file is, read from its headers before Chrome is asked to decode a pixel: its
 * type (from its bytes, never its name), its size, whether it moves, whether it can be
 * see-through, a PNG's palette, and where its EXIF and colour profile are. Enough to refuse a
 * picture that's too big with a plain message, and to carry across what matters. Pure but for
 * the reader it's handed.
 *
 * @module sniff
 */

import { ascii, joinBytes, throughStream, viewOf } from './bytes.js';

/** @import { ByteReader } from './bytes.js' */

/** @typedef {'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif' | 'image/avif' | 'image/bmp'} SniffedType A type read from a file's bytes. */

/**
 * @typedef {object} ImageInfo
 * @property {SniffedType} type What the bytes are.
 * @property {number} width Width as stored (before any EXIF turn), px.
 * @property {number} height Height as stored, px.
 * @property {boolean} animated More than one frame (GIF, WebP, APNG, AVIF sequence).
 * @property {boolean} alpha Whether the format says it can be see-through.
 * @property {number | null} palette A PNG's palette size (a PNG-8), else null.
 * @property {Uint8Array | null} exif Its EXIF (a TIFF block), when it has one that could be read.
 * @property {Uint8Array | null} icc Its ICC colour profile, when it has one.
 * @property {boolean} wideGamut Whether its colours are in a space other than sRGB (a profile
 *   whose primaries aren't sRGB's, or a `cICP`/`nclx` tag naming other primaries).
 */

/** The longest stretch of headers walked before giving up (bytes): metadata sits at the front. */
const MAX_WALK = 64 * 1024 * 1024;

/** sRGB's red, green and blue as ICC profiles store them (XYZ, adapted to D50). */
const SRGB_PRIMARIES = /** @type {const} */ ([['rXYZ', [0.4361, 0.2225, 0.0139]], ['gXYZ', [0.3851, 0.7169, 0.0971]], ['bXYZ', [0.1431, 0.0606, 0.7141]]]);

/** How far a profile's primaries may sit from sRGB's and still be sRGB (profiles round differently). */
const PRIMARY_TOLERANCE = 0.004;

/**
 * Whether an ICC profile describes sRGB's colours: an RGB profile whose three primaries are
 * sRGB's. A grey or CMYK profile counts too (Chrome converts those into sRGB without loss of
 * range that matters); an RGB profile built from tables has no primaries to read and counts as
 * wider, the safe way round.
 *
 * @param {Uint8Array} icc - The profile.
 * @returns {boolean} It's sRGB, as far as output needs to know.
 */
export function isSrgbProfile(icc) {
  if (icc.length < 132) return true;
  const view = viewOf(icc);
  if (ascii(icc, 16, 4) !== 'RGB ') return true;
  const count = Math.min(view.getUint32(128), 200);
  /** @type {Map<string, number>} */
  const tags = new Map();
  for (let i = 0; i < count && 144 + i * 12 <= icc.length; i++) tags.set(ascii(icc, 132 + i * 12, 4), view.getUint32(136 + i * 12));
  return SRGB_PRIMARIES.every(([name, xyz]) => {
    const offset = tags.get(name);
    if (offset === undefined || offset + 20 > icc.length) return false;
    return xyz.every((value, index) => Math.abs(view.getInt32(offset + 8 + index * 4) / 65_536 - value) <= PRIMARY_TOLERANCE);
  });
}

/**
 * @param {Uint8Array | null} icc - A profile, or none.
 * @returns {boolean} Whether it's wider than sRGB.
 */
const wide = (icc) => icc !== null && !isSrgbProfile(icc);

/**
 * A JPEG's facts: its segments walked up to the first scan.
 *
 * @param {ByteReader} reader - The file.
 * @returns {Promise<ImageInfo | null>} The facts, or null when no frame header is found.
 */
async function sniffJpeg(reader) {
  /** @type {Uint8Array | null} */
  let exif = null;
  /** @type {Map<number, Uint8Array>} */
  const profile = new Map();
  let offset = 2;
  while (offset + 4 <= Math.min(reader.size, MAX_WALK)) {
    const head = await reader.read(offset, 4);
    if (head.length < 4 || head[0] !== 0xff) return null;
    const marker = head[1];
    if (marker === 0xff) { offset += 1; continue; }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) { offset += 2; continue; }
    if (marker === 0xda || marker === 0xd9) return null;
    const length = (head[2] << 8) | head[3];
    if (length < 2) return null;
    const isFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isFrame) {
      const frame = await reader.read(offset + 4, 6);
      if (frame.length < 6) return null;
      const icc = profile.size ? joinBytes([...profile.keys()].sort((a, b) => a - b).map((index) => /** @type {Uint8Array} */ (profile.get(index)))) : null;
      return {
        type: 'image/jpeg', width: (frame[3] << 8) | frame[4], height: (frame[1] << 8) | frame[2],
        animated: false, alpha: false, palette: null, exif, icc, wideGamut: wide(icc),
      };
    }
    if (marker === 0xe1 || marker === 0xe2) {
      const body = (await reader.read(offset + 4, length - 2)).slice();
      if (marker === 0xe1 && !exif && ascii(body, 0, 6) === 'Exif\0\0') exif = body.subarray(6);
      if (marker === 0xe2 && ascii(body, 0, 12) === 'ICC_PROFILE\0') profile.set(body[12], body.subarray(14));
    }
    offset += 2 + length;
  }
  return null;
}

/**
 * A PNG's facts: its chunks walked up to the first pixels.
 *
 * @param {ByteReader} reader - The file.
 * @returns {Promise<ImageInfo | null>} The facts, or null when its header is wrong.
 */
async function sniffPng(reader) {
  const header = await reader.read(8, 25);
  if (header.length < 25 || ascii(header, 4, 4) !== 'IHDR') return null;
  const view = viewOf(header);
  const colourType = header[17];
  /** @type {ImageInfo} */
  const info = {
    type: 'image/png', width: view.getUint32(8), height: view.getUint32(12), animated: false,
    alpha: colourType === 4 || colourType === 6, palette: null, exif: null, icc: null, wideGamut: false,
  };
  let offset = 33;
  while (offset + 12 <= Math.min(reader.size, MAX_WALK)) {
    const head = await reader.read(offset, 8);
    if (head.length < 8) break;
    const length = viewOf(head).getUint32(0);
    const name = ascii(head, 4, 4);
    if (name === 'IDAT' || name === 'IEND') break;
    if (name === 'acTL') info.animated = true;
    else if (name === 'tRNS') info.alpha = true;
    else if (name === 'PLTE' && colourType === 3) info.palette = Math.floor(length / 3);
    else if (name === 'eXIf') info.exif = (await reader.read(offset + 8, length)).slice();
    else if (name === 'cICP') info.wideGamut = (await reader.read(offset + 8, 1))[0] !== 1;
    else if (name === 'iCCP') {
      const body = await reader.read(offset + 8, length);
      const end = body.indexOf(0);
      info.icc = await throughStream(body.subarray(end + 2), new DecompressionStream('deflate')).catch(() => null);
      info.wideGamut ||= wide(info.icc);
    }
    offset += 12 + length;
  }
  return info;
}

/**
 * A WebP's facts: its first chunk, and its metadata chunks when it's the extended kind.
 *
 * @param {ByteReader} reader - The file.
 * @returns {Promise<ImageInfo | null>} The facts, or null when its header is wrong.
 */
async function sniffWebp(reader) {
  const head = await reader.read(12, 18);
  if (head.length < 13) return null;
  const view = viewOf(head);
  const kind = ascii(head, 0, 4);
  /** @type {ImageInfo} */
  const info = { type: 'image/webp', width: 0, height: 0, animated: false, alpha: false, palette: null, exif: null, icc: null, wideGamut: false };
  if (kind !== 'VP8L' && head.length < 18) return null;
  if (kind === 'VP8 ') {
    if (head[11] !== 0x9d || head[12] !== 0x01 || head[13] !== 0x2a) return null;
    return { ...info, width: view.getUint16(14, true) & 0x3fff, height: view.getUint16(16, true) & 0x3fff };
  }
  if (kind === 'VP8L') {
    if (head[8] !== 0x2f) return null;
    const bits = view.getUint32(9, true);
    return { ...info, width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1, alpha: Boolean((bits >>> 28) & 1) };
  }
  if (kind !== 'VP8X') return null;
  const flags = head[8];
  info.width = 1 + (head[12] | (head[13] << 8) | (head[14] << 16));
  info.height = 1 + (head[15] | (head[16] << 8) | (head[17] << 16));
  info.animated = Boolean(flags & 0x02);
  info.alpha = Boolean(flags & 0x10);
  let offset = 30;
  while ((flags & 0x28) && offset + 8 <= Math.min(reader.size, MAX_WALK)) {
    const chunk = await reader.read(offset, 8);
    if (chunk.length < 8) break;
    const length = viewOf(chunk).getUint32(4, true);
    const name = ascii(chunk, 0, 4);
    if (name === 'ICCP') info.icc = (await reader.read(offset + 8, length)).slice();
    if (name === 'EXIF') {
      const body = (await reader.read(offset + 8, length)).slice();
      info.exif = ascii(body, 0, 6) === 'Exif\0\0' ? body.subarray(6) : body;
    }
    offset += 8 + length + (length & 1);
  }
  info.wideGamut = wide(info.icc);
  return info;
}

/**
 * A GIF's facts: its screen size, and whether a second picture follows the first.
 *
 * @param {ByteReader} reader - The file.
 * @returns {Promise<ImageInfo | null>} The facts.
 */
async function sniffGif(reader) {
  const head = await reader.read(0, 13);
  if (head.length < 13) return null;
  const view = viewOf(head);
  let offset = 13 + (head[10] & 0x80 ? 3 * 2 ** ((head[10] & 7) + 1) : 0);
  let pictures = 0;
  let alpha = false;
  /** Skip a run of sub-blocks starting at `offset`. */
  const skipBlocks = async () => {
    for (;;) {
      const size = (await reader.read(offset, 1))[0];
      offset += 1;
      if (!size) return;
      offset += size;
    }
  };
  while (pictures < 2 && offset < Math.min(reader.size, MAX_WALK)) {
    const block = await reader.read(offset, 10);
    if (block[0] === 0x2c) {
      pictures += 1;
      if (pictures === 2 || block.length < 10) break;
      offset += 10 + (block[9] & 0x80 ? 3 * 2 ** ((block[9] & 7) + 1) : 0) + 1;
      await skipBlocks();
    } else if (block[0] === 0x21) {
      if (block[1] === 0xf9 && block[3] & 1) alpha = true;
      offset += 2;
      await skipBlocks();
    } else break;
  }
  return { type: 'image/gif', width: view.getUint16(6, true), height: view.getUint16(8, true), animated: pictures > 1, alpha, palette: null, exif: null, icc: null, wideGamut: false };
}

/**
 * The boxes directly inside a stretch of an ISO media file.
 *
 * @param {ByteReader} reader - The file.
 * @param {number} from - Where the stretch starts.
 * @param {number} to - Where it ends.
 * @returns {Promise<{name: string, start: number, end: number}[]>} Each box's name and its contents' span.
 */
async function boxesIn(reader, from, to) {
  const boxes = [];
  let offset = from;
  while (offset + 8 <= to && boxes.length < 512) {
    const head = await reader.read(offset, 16);
    if (head.length < 8) break;
    const view = viewOf(head);
    let size = view.getUint32(0);
    let headSize = 8;
    if (size === 1 && head.length >= 16) { size = Number(view.getBigUint64(8)); headSize = 16; } else if (size === 0) size = to - offset;
    if (size < headSize) break;
    boxes.push({ name: ascii(head, 4, 4), start: offset + headSize, end: Math.min(to, offset + size) });
    offset += size;
  }
  return boxes;
}

/**
 * An AVIF's facts: its largest picture's size and its colour tag, from the `meta` box.
 *
 * @param {ByteReader} reader - The file.
 * @returns {Promise<ImageInfo | null>} The facts, or null when no size is found.
 */
async function sniffAvif(reader) {
  const top = await boxesIn(reader, 0, Math.min(reader.size, MAX_WALK));
  const ftyp = top.find((box) => box.name === 'ftyp');
  const meta = top.find((box) => box.name === 'meta');
  if (!ftyp || !meta) return null;
  const brands = ascii(await reader.read(ftyp.start, Math.min(256, ftyp.end - ftyp.start)));
  const iprp = (await boxesIn(reader, meta.start + 4, meta.end)).find((box) => box.name === 'iprp');
  const ipco = iprp && (await boxesIn(reader, iprp.start, iprp.end)).find((box) => box.name === 'ipco');
  if (!ipco) return null;
  /** @type {ImageInfo} */
  const info = { type: 'image/avif', width: 0, height: 0, animated: brands.includes('avis'), alpha: false, palette: null, exif: null, icc: null, wideGamut: false };
  for (const box of await boxesIn(reader, ipco.start, ipco.end)) {
    const body = await reader.read(box.start, Math.min(box.end - box.start, 4 * 1024 * 1024));
    if (box.name === 'ispe' && body.length >= 12) {
      const view = viewOf(body);
      if (view.getUint32(4) * view.getUint32(8) > info.width * info.height) Object.assign(info, { width: view.getUint32(4), height: view.getUint32(8) });
    } else if (box.name === 'auxC' && ascii(body, 4).includes('alpha')) info.alpha = true;
    else if (box.name === 'colr' && (ascii(body, 0, 4) === 'prof' || ascii(body, 0, 4) === 'rICC')) {
      info.icc = body.slice(4);
      info.wideGamut ||= wide(info.icc);
    } else if (box.name === 'colr' && ascii(body, 0, 4) === 'nclx' && body.length >= 6) {
      const primaries = viewOf(body).getUint16(4);
      info.wideGamut ||= primaries !== 1 && primaries !== 2;
    }
  }
  return info.width ? info : null;
}

/**
 * A BMP's facts.
 *
 * @param {ByteReader} reader - The file.
 * @returns {Promise<ImageInfo | null>} The facts.
 */
async function sniffBmp(reader) {
  const head = await reader.read(0, 30);
  if (head.length < 30) return null;
  const view = viewOf(head);
  return { type: 'image/bmp', width: Math.abs(view.getInt32(18, true)), height: Math.abs(view.getInt32(22, true)), animated: false, alpha: view.getUint16(28, true) === 32, palette: null, exif: null, icc: null, wideGamut: false };
}

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
export async function sniffImage(reader) {
  const start = await reader.read(0, 16);
  if (start.length < 12) return null;
  const sniffed = await (async () => {
    if (start[0] === 0xff && start[1] === 0xd8 && start[2] === 0xff) return sniffJpeg(reader);
    if (ascii(start, 0, 8) === '\x89PNG\r\n\x1a\n') return sniffPng(reader);
    if (ascii(start, 0, 4) === 'RIFF' && ascii(start, 8, 4) === 'WEBP') return sniffWebp(reader);
    if (/^GIF8[79]a/.test(ascii(start, 0, 6))) return sniffGif(reader);
    if (ascii(start, 4, 4) === 'ftyp') return sniffAvif(reader);
    if (ascii(start, 0, 2) === 'BM') return sniffBmp(reader);
    return null;
  })().catch(() => null);
  return sniffed && sniffed.width > 0 && sniffed.height > 0 ? sniffed : null;
}
