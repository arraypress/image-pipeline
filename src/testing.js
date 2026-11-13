/**
 * Picture files made for tests, byte by byte, so every pixel and every tag is known: EXIF blocks
 * (orientation, camera, location, a thumbnail), PNGs (with any extra chunks, and animated),
 * animated GIFs, and patterns that show up a bad resize. For this library's tests and those of
 * whatever uses it. Runs in Node 20+ and browsers.
 *
 * @module testing
 */

import { joinBytes, latin1, throughStream, uint32s, viewOf } from './bytes.js';
import { pngChunk } from './png.js';

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
export function buildExif({ orientation, make, model, taken, location, thumbnail, makerNote, pixels, little = true } = {}) {
  /** @typedef {{tag: number, type: number, count: number, data: Uint8Array}} Field */
  /** @param {number[]} values @param {number} size */
  const numbers = (values, size) => {
    const bytes = new Uint8Array(values.length * size);
    values.forEach((value, index) => (size === 2 ? viewOf(bytes).setUint16(index * 2, value, little) : viewOf(bytes).setUint32(index * 4, value, little)));
    return bytes;
  };
  /** @param {number} tag @param {number} value @returns {Field} */
  const short = (tag, value) => ({ tag, type: 3, count: 1, data: numbers([value], 2) });
  /** @param {number} tag @param {number} value @returns {Field} */
  const long = (tag, value) => ({ tag, type: 4, count: 1, data: numbers([value], 4) });
  /** @param {number} tag @param {string} text @returns {Field} */
  const text = (tag, text) => ({ tag, type: 2, count: text.length + 1, data: latin1(`${text}\0`) });
  /** @param {number} tag @param {number} degrees @returns {Field} */
  const angle = (tag, degrees) => {
    const whole = Math.floor(degrees);
    const minutes = Math.floor((degrees - whole) * 60);
    const seconds = Math.round(((degrees - whole) * 60 - minutes) * 60 * 10_000);
    return { tag, type: 5, count: 3, data: numbers([whole, 1, minutes, 1, seconds, 10_000], 4) };
  };

  /** @type {Field[]} */
  const main = [];
  /** @type {Field[]} */
  const exif = [];
  if (make) main.push(text(0x010f, make));
  if (model) main.push(text(0x0110, model));
  if (orientation) main.push(short(0x0112, orientation));
  if (taken) exif.push(text(0x9003, taken));
  if (makerNote) exif.push({ tag: 0x927c, type: 7, count: makerNote.length, data: makerNote });
  if (pixels) exif.push(long(0xa002, pixels.width), long(0xa003, pixels.height));
  const gps = location ? [
    text(1, location.latitude < 0 ? 'S' : 'N'), angle(2, Math.abs(location.latitude)),
    text(3, location.longitude < 0 ? 'W' : 'E'), angle(4, Math.abs(location.longitude)),
  ] : [];
  const thumb = thumbnail ? [long(0x0201, 0), long(0x0202, thumbnail.length)] : [];

  // Lay the directories out one after another, each followed by the values too long for an entry.
  /** @param {Field[]} fields */
  const sizeOf = (fields) => 2 + fields.length * 12 + 4 + fields.reduce((sum, field) => sum + (field.data.length > 4 ? field.data.length + (field.data.length & 1) : 0), 0);
  if (exif.length) main.push(long(0x8769, 0));
  if (gps.length) main.push(long(0x8825, 0));
  main.sort((a, b) => a.tag - b.tag);
  const mainAt = 8;
  const exifAt = mainAt + sizeOf(main);
  const gpsAt = exifAt + (exif.length ? sizeOf(exif) : 0);
  const thumbAt = gpsAt + (gps.length ? sizeOf(gps) : 0);
  const pictureAt = thumbAt + (thumb.length ? sizeOf(thumb) : 0);
  for (const field of main) {
    if (field.tag === 0x8769) field.data = numbers([exifAt], 4);
    if (field.tag === 0x8825) field.data = numbers([gpsAt], 4);
  }
  if (thumb.length) thumb[0].data = numbers([pictureAt], 4);

  const out = new Uint8Array(pictureAt + (thumbnail?.length ?? 0));
  const view = viewOf(out);
  out.set(latin1(little ? 'II' : 'MM'));
  view.setUint16(2, 42, little);
  view.setUint32(4, mainAt, little);
  /** @param {Field[]} fields @param {number} at @param {number} next */
  const write = (fields, at, next) => {
    view.setUint16(at, fields.length, little);
    let values = at + 2 + fields.length * 12 + 4;
    fields.forEach((field, index) => {
      const entry = at + 2 + index * 12;
      view.setUint16(entry, field.tag, little);
      view.setUint16(entry + 2, field.type, little);
      view.setUint32(entry + 4, field.count, little);
      if (field.data.length <= 4) out.set(field.data, entry + 8);
      else {
        view.setUint32(entry + 8, values, little);
        out.set(field.data, values);
        values += field.data.length + (field.data.length & 1);
      }
    });
    view.setUint32(at + 2 + fields.length * 12, next, little);
  };
  write(main, mainAt, thumb.length ? thumbAt : 0);
  if (exif.length) write(exif, exifAt, 0);
  if (gps.length) write(gps, gpsAt, 0);
  if (thumbnail) {
    write(thumb, thumbAt, 0);
    out.set(thumbnail, pictureAt);
  }
  return out;
}

/**
 * A picture's rows as a PNG's compressed data: each row after a “no filter” byte.
 *
 * @param {Uint8Array | Uint8ClampedArray} rgba - Its pixels.
 * @param {number} width - Its width.
 * @param {number} height - Its height.
 * @returns {Promise<Uint8Array<ArrayBuffer>>} The data, deflated.
 */
function pngData(rgba, width, height) {
  const rows = new Uint8Array((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) rows.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * (width * 4 + 1) + 1);
  return throughStream(rows, new CompressionStream('deflate'));
}

/**
 * @param {number} width - A picture's width.
 * @param {number} height - Its height.
 * @returns {Uint8Array<ArrayBuffer>} A 32-bit PNG's header chunk.
 */
function pngHeader(width, height) {
  return pngChunk('IHDR', joinBytes([uint32s([width, height]), Uint8Array.of(8, 6, 0, 0, 0)]));
}

/** A PNG's first eight bytes. */
const PNG_SIGNATURE = latin1('\x89PNG\r\n\x1a\n');

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
export async function buildPng(rgba, width, height, chunks = []) {
  return joinBytes([PNG_SIGNATURE, pngHeader(width, height), ...chunks, pngChunk('IDAT', await pngData(rgba, width, height)), pngChunk('IEND', new Uint8Array(0))]);
}

/**
 * An animated PNG of known frames, each the whole picture.
 *
 * @param {readonly (Uint8Array | Uint8ClampedArray)[]} frames - Each frame's pixels (RGBA).
 * @param {number} width - The width.
 * @param {number} height - The height.
 * @param {number} [delay] - How long each frame shows (ms). Default 100.
 * @returns {Promise<Uint8Array<ArrayBuffer>>} The APNG.
 */
export async function buildApng(frames, width, height, delay = 100) {
  let sequence = 0;
  const parts = [PNG_SIGNATURE, pngHeader(width, height), pngChunk('acTL', uint32s([frames.length, 0]))];
  for (const [index, frame] of frames.entries()) {
    const control = new Uint8Array(26);
    control.set(uint32s([sequence++, width, height, 0, 0]));
    viewOf(control).setUint16(20, delay);
    viewOf(control).setUint16(22, 1000);
    parts.push(pngChunk('fcTL', control));
    const data = await pngData(frame, width, height);
    parts.push(index === 0 ? pngChunk('IDAT', data) : pngChunk('fdAT', joinBytes([uint32s([sequence++]), data])));
  }
  return joinBytes([...parts, pngChunk('IEND', new Uint8Array(0))]);
}

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
export function buildGif(frames, { width, height, palette, delay = 100, transparent }) {
  const bits = Math.max(1, Math.ceil(Math.log2(palette.length)));
  const table = new Uint8Array(3 * 2 ** bits);
  palette.forEach((colour, index) => table.set(colour, index * 3));
  /** @param {number} value */
  const uint16 = (value) => [value & 0xff, value >> 8];
  const parts = [
    latin1('GIF89a'), Uint8Array.from([...uint16(width), ...uint16(height), 0x80 | (bits - 1), 0, 0]), table,
    Uint8Array.from([0x21, 0xff, 11, ...latin1('NETSCAPE2.0'), 3, 1, 0, 0, 0]),
  ];
  const codeBits = Math.max(2, bits);
  const clear = 2 ** codeBits;
  for (const frame of frames) {
    parts.push(Uint8Array.from([0x21, 0xf9, 4, transparent === undefined ? 0 : 1, ...uint16(Math.round(delay / 10)), transparent ?? 0, 0]));
    parts.push(Uint8Array.from([0x2c, 0, 0, 0, 0, ...uint16(width), ...uint16(height), 0, codeBits]));
    // Codes are codeBits + 1 wide while the table stays small: clear it before it grows.
    /** @type {number[]} */
    const data = [];
    let held = 0;
    let heldBits = 0;
    /** @param {number} code */
    const put = (code) => {
      held |= code << heldBits;
      heldBits += codeBits + 1;
      while (heldBits >= 8) {
        data.push(held & 0xff);
        held >>= 8;
        heldBits -= 8;
      }
    };
    frame.forEach((index, at) => {
      if (at % (clear - 2) === 0) put(clear);
      put(index);
    });
    put(clear + 1);
    if (heldBits) data.push(held & 0xff);
    for (let at = 0; at < data.length; at += 255) parts.push(Uint8Array.from([Math.min(255, data.length - at), ...data.slice(at, at + 255)]));
    parts.push(Uint8Array.of(0));
  }
  return joinBytes([...parts, Uint8Array.of(0x3b)]);
}

/**
 * A checkerboard of single pixels, black and white: the hardest thing to shrink. Done properly
 * it becomes an even grey; done badly, stripes and blotches.
 *
 * @param {number} width - Its width.
 * @param {number} height - Its height.
 * @returns {Uint8ClampedArray<ArrayBuffer>} Its pixels (RGBA, opaque).
 */
export function checkerboard(width, height) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const at = (y * width + x) * 4;
      data[at] = data[at + 1] = data[at + 2] = (x + y) & 1 ? 255 : 0;
      data[at + 3] = 255;
    }
  }
  return data;
}

/**
 * A zone plate: rings that get finer towards the edge, every spatial frequency at once. A resize
 * that doesn't filter enough turns the fine rings into false coarse ones (moiré).
 *
 * @param {number} size - Its width and height.
 * @returns {Uint8ClampedArray<ArrayBuffer>} Its pixels (RGBA, opaque greys).
 */
export function zonePlate(size) {
  const data = new Uint8ClampedArray(size * size * 4);
  const middle = (size - 1) / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const at = (y * size + x) * 4;
      const distance = (x - middle) ** 2 + (y - middle) ** 2;
      data[at] = data[at + 1] = data[at + 2] = Math.round(127.5 + 127.5 * Math.cos((Math.PI * distance) / size));
      data[at + 3] = 255;
    }
  }
  return data;
}
