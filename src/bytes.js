/**
 * Small readers and writers of bytes the formats share. Pure.
 *
 * @module bytes
 */

/**
 * Reads part of a file: `length` bytes from `offset` (fewer at its end).
 *
 * @typedef {object} ByteReader
 * @property {number} size The file's length in bytes.
 * @property {(offset: number, length: number) => Promise<Uint8Array>} read Read a part.
 */

/** How much is read at once (bytes): headers are walked in memory, not one small read each. */
const WINDOW = 65_536;

/**
 * A reader over bytes already in memory.
 *
 * @param {Uint8Array} bytes - The file.
 * @returns {ByteReader} Its reader.
 */
export function bytesReader(bytes) {
  return { size: bytes.length, read: async (offset, length) => bytes.subarray(offset, offset + length) };
}

/**
 * A reader over a `Blob` or `File`, a window at a time, so walking a file's headers costs a few
 * reads however many chunks it has, and its pixels are never read here.
 *
 * @param {Blob} blob - The file.
 * @returns {ByteReader} Its reader.
 * @example
 * const info = await sniffImage(blobReader(file));
 */
export function blobReader(blob) {
  let start = 0;
  let held = new Uint8Array(0);
  return {
    size: blob.size,
    async read(offset, length) {
      if (offset < start || offset + length > start + held.length) {
        start = offset;
        held = new Uint8Array(await blob.slice(offset, offset + Math.max(length, WINDOW)).arrayBuffer());
      }
      return held.subarray(offset - start, offset - start + length);
    },
  };
}

/**
 * Bytes as Latin-1 text (chunk names, signatures).
 *
 * @param {Uint8Array} bytes - The bytes.
 * @param {number} [offset] - Where to start.
 * @param {number} [length] - How many.
 * @returns {string} The text.
 */
export function ascii(bytes, offset = 0, length = bytes.length - offset) {
  let text = '';
  for (let i = offset; i < Math.min(bytes.length, offset + length); i++) text += String.fromCharCode(bytes[i]);
  return text;
}

/**
 * Text as bytes, one a character.
 *
 * @param {string} text - Latin-1 text.
 * @returns {Uint8Array<ArrayBuffer>} Its bytes.
 */
export function latin1(text) {
  return Uint8Array.from(text, (character) => character.charCodeAt(0));
}

/**
 * A `DataView` over bytes, wherever they sit in their buffer.
 *
 * @param {Uint8Array} bytes - The bytes.
 * @returns {DataView} The view.
 */
export function viewOf(bytes) {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

/**
 * Byte arrays joined into one.
 *
 * @param {readonly Uint8Array[]} parts - The parts.
 * @returns {Uint8Array<ArrayBuffer>} All of them, in order.
 */
export function joinBytes(parts) {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/**
 * Numbers as bytes, four each, big end first (PNG's and ISO media's way).
 *
 * @param {readonly number[]} values - The numbers.
 * @returns {Uint8Array<ArrayBuffer>} Their bytes.
 */
export function uint32s(values) {
  const bytes = new Uint8Array(values.length * 4);
  values.forEach((value, index) => viewOf(bytes).setUint32(index * 4, value));
  return bytes;
}

/** CRC-32's table (the polynomial PNG and ZIP use). */
const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

/**
 * CRC-32 of some bytes.
 *
 * @param {readonly Uint8Array[]} parts - The bytes, in parts.
 * @returns {number} The checksum, unsigned.
 */
export function crc32(parts) {
  let crc = 0xffffffff;
  for (const part of parts) for (let i = 0; i < part.length; i++) crc = CRC_TABLE[(crc ^ part[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Bytes through one of the platform's (de)compression streams.
 *
 * @param {Uint8Array} bytes - The bytes.
 * @param {CompressionStream | DecompressionStream} stream - The stream.
 * @returns {Promise<Uint8Array<ArrayBuffer>>} What comes out.
 */
export async function throughStream(bytes, stream) {
  const piped = new Blob([/** @type {BlobPart} */ (bytes)]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(piped).arrayBuffer());
}
