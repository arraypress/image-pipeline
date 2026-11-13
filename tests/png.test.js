import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';
import { encodeIndexedPng, MAX_PALETTE, paletteOf, pngChunk, pngChunks } from '../src/index.js';
import { ascii, crc32, viewOf } from '../src/bytes.js';

/**
 * A palette PNG's pixels, read back the slow way.
 *
 * @param {Uint8Array} png
 * @returns {{width: number, height: number, depth: number, data: number[]}}
 */
function decodeIndexed(png) {
  const view = viewOf(png);
  /** @type {Record<string, Uint8Array>} */
  const chunks = {};
  for (let offset = 8; offset < png.length;) {
    const length = view.getUint32(offset);
    assert.equal(view.getUint32(offset + 8 + length), crc32([png.subarray(offset + 4, offset + 8 + length)]), 'checksum');
    chunks[ascii(png, offset + 4, 4)] = png.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length;
  }
  const header = viewOf(chunks.IHDR);
  const [width, height, depth] = [header.getUint32(0), header.getUint32(4), chunks.IHDR[8]];
  assert.equal(chunks.IHDR[9], 3, 'colour type: palette');
  const rows = inflateSync(chunks.IDAT);
  const rowBytes = 1 + Math.ceil((width * depth) / 8);
  const data = [];
  for (let y = 0; y < height; y++) {
    assert.equal(rows[y * rowBytes], 0, 'no filter');
    for (let x = 0; x < width; x++) {
      const index = (rows[y * rowBytes + 1 + ((x * depth) >> 3)] >> (8 - depth - ((x * depth) & 7))) & (2 ** depth - 1);
      data.push(chunks.PLTE[index * 3], chunks.PLTE[index * 3 + 1], chunks.PLTE[index * 3 + 2], chunks.tRNS?.[index] ?? 255);
    }
  }
  return { width, height, depth, data };
}

/** @param {number} colours @param {number} width @param {number} height A picture of that many colours, some see-through. */
function picture(colours, width, height) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const colour = (i * 7) % colours;
    data.set([colour, (colour * 3) % 256, 255 - colour, colour % 5 === 0 ? colour % 256 : 255], i * 4);
  }
  return { data, width, height };
}

test('paletteOf: up to 256 colours, in bands; one more is null', () => {
  assert.equal(paletteOf(picture(256, 40, 40).data)?.size, MAX_PALETTE);
  assert.equal(paletteOf(picture(257, 40, 40).data), null);
  const { data } = picture(200, 40, 40);
  const first = paletteOf(data.subarray(0, 3200));
  assert.equal(paletteOf(data.subarray(3200), /** @type {Map<number, number>} */ (first))?.size, 200);
});

test('encodeIndexedPng: every pixel exactly, at one, two, four and eight bits, odd widths, transparency', async () => {
  for (const [colours, depth] of [[2, 1], [3, 2], [4, 2], [5, 4], [16, 4], [17, 8], [256, 8]]) {
    for (const [width, height] of [[1, 1], [7, 3], [33, 5]]) {
      const source = picture(colours, width, height);
      const palette = /** @type {Map<number, number>} */ (paletteOf(source.data));
      const decoded = decodeIndexed(await encodeIndexedPng(source, palette));
      if (palette.size === colours) assert.equal(decoded.depth, depth, `${colours} colours`);
      assert.deepEqual(decoded.data, [...source.data], `${colours} colours ${width}×${height}`);
    }
  }
});

test('encodeIndexedPng: an opaque picture has no tRNS; extra chunks go before the palette; pngChunks finds them', async () => {
  const data = new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255]);
  const profile = pngChunk('iCCP', Uint8Array.of(1, 2, 3));
  const png = await encodeIndexedPng({ data, width: 2, height: 1 }, /** @type {Map<number, number>} */ (paletteOf(data)), [profile]);
  const text = ascii(png);
  assert.equal(text.includes('tRNS'), false);
  assert.ok(text.indexOf('IHDR') < text.indexOf('iCCP') && text.indexOf('iCCP') < text.indexOf('PLTE'));
  assert.deepEqual(pngChunks(png, ['iCCP']), [profile]);
  assert.deepEqual(pngChunks(png, ['zTXt']), []);
});
