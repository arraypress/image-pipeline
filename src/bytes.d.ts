/**
 * Small readers and writers of bytes the formats share. Pure.
 *
 * @module bytes
 */
export type ByteReader = {
    /**
     * The file's length in bytes.
     */
    size: number;
    /**
     * Read a part.
     */
    read: (offset: number, length: number) => Promise<Uint8Array>;
};
/**
 * A reader over bytes already in memory.
 *
 * @param {Uint8Array} bytes - The file.
 * @returns {ByteReader} Its reader.
 */
export declare function bytesReader(bytes: Uint8Array): ByteReader;
/**
 * A reader over a `Blob` or `File`, a window at a time, so walking a file's headers costs a few
 * reads however many chunks it has, and its pixels are never read here.
 *
 * @param {Blob} blob - The file.
 * @returns {ByteReader} Its reader.
 * @example
 * const info = await sniffImage(blobReader(file));
 */
export declare function blobReader(blob: Blob): ByteReader;
/**
 * Bytes as Latin-1 text (chunk names, signatures).
 *
 * @param {Uint8Array} bytes - The bytes.
 * @param {number} [offset] - Where to start.
 * @param {number} [length] - How many.
 * @returns {string} The text.
 */
export declare function ascii(bytes: Uint8Array, offset?: number, length?: number): string;
/**
 * Text as bytes, one a character.
 *
 * @param {string} text - Latin-1 text.
 * @returns {Uint8Array<ArrayBuffer>} Its bytes.
 */
export declare function latin1(text: string): Uint8Array<ArrayBuffer>;
/**
 * A `DataView` over bytes, wherever they sit in their buffer.
 *
 * @param {Uint8Array} bytes - The bytes.
 * @returns {DataView} The view.
 */
export declare function viewOf(bytes: Uint8Array): DataView;
/**
 * Byte arrays joined into one.
 *
 * @param {readonly Uint8Array[]} parts - The parts.
 * @returns {Uint8Array<ArrayBuffer>} All of them, in order.
 */
export declare function joinBytes(parts: readonly Uint8Array[]): Uint8Array<ArrayBuffer>;
/**
 * Numbers as bytes, four each, big end first (PNG's and ISO media's way).
 *
 * @param {readonly number[]} values - The numbers.
 * @returns {Uint8Array<ArrayBuffer>} Their bytes.
 */
export declare function uint32s(values: readonly number[]): Uint8Array<ArrayBuffer>;
/**
 * CRC-32 of some bytes.
 *
 * @param {readonly Uint8Array[]} parts - The bytes, in parts.
 * @returns {number} The checksum, unsigned.
 */
export declare function crc32(parts: readonly Uint8Array[]): number;
/**
 * Bytes through one of the platform's (de)compression streams.
 *
 * @param {Uint8Array} bytes - The bytes.
 * @param {CompressionStream | DecompressionStream} stream - The stream.
 * @returns {Promise<Uint8Array<ArrayBuffer>>} What comes out.
 */
export declare function throughStream(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array<ArrayBuffer>>;
