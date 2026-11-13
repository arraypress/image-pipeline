import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blobReader, bytesReader, encodeIndexedPng, isSrgbProfile, paletteOf, pngChunk, sniffImage } from '../src/index.js';
import { joinBytes, latin1, throughStream, uint32s } from '../src/bytes.js';
import { buildApng, buildExif, buildGif, buildPng } from '../src/testing.js';
import { box, iccProfile, jpegHeaders, PRIMARIES, riff, vp8, vp8l, vp8x, webpFile } from './files.js';

/** @param {Uint8Array} bytes */
const sniff = (bytes) => sniffImage(bytesReader(bytes));
const PIXELS = new Uint8ClampedArray(3 * 2 * 4).fill(255);
const EXIF = buildExif({ orientation: 6, model: 'Test' });
const srgb = iccProfile(/** @type {any} */ (PRIMARIES.srgb));
const p3 = iccProfile(/** @type {any} */ (PRIMARIES.p3));

test('isSrgbProfile: sRGB\'s primaries, give or take rounding; not Display P3\'s; grey and broken profiles pass as sRGB', () => {
  assert.equal(isSrgbProfile(srgb), true);
  assert.equal(isSrgbProfile(p3), false);
  const grey = srgb.slice();
  grey.set(latin1('GRAY'), 16);
  assert.equal(isSrgbProfile(grey), true);
  assert.equal(isSrgbProfile(new Uint8Array(20)), true);
  const tables = srgb.slice();
  tables.set(latin1('A2B0'), 132);
  assert.equal(isSrgbProfile(tables), false, 'an RGB profile without readable primaries is treated as wider');
});

test('JPEG: size from the frame header wherever it comes, EXIF, a profile in parts, progressive', async () => {
  assert.deepEqual(await sniff(jpegHeaders({ width: 4032, height: 3024 })), { type: 'image/jpeg', width: 4032, height: 3024, animated: false, alpha: false, palette: null, exif: null, icc: null, wideGamut: false });
  const full = await sniff(jpegHeaders({ width: 640, height: 480, exif: EXIF, icc: p3, iccParts: 3, progressive: true }));
  assert.deepEqual([full?.width, full?.height, full?.wideGamut], [640, 480, true]);
  assert.deepEqual(full?.exif, EXIF);
  assert.deepEqual(full?.icc, p3);
  assert.equal((await sniff(jpegHeaders({ width: 640, height: 480, icc: srgb })))?.wideGamut, false);
  // Sixty kilobytes of EXIF before the frame header: found all the same, through a Blob's reader too.
  const long = jpegHeaders({ width: 100, height: 50, exif: buildExif({ makerNote: new Uint8Array(60_000) }) });
  assert.equal((await sniffImage(blobReader(new Blob([/** @type {BlobPart} */ (long)]))))?.width, 100);
});

test('PNG: size, transparency, EXIF, a cICP tag, a profile, a palette, animation', async () => {
  assert.deepEqual(await sniff(await buildPng(PIXELS, 3, 2)), { type: 'image/png', width: 3, height: 2, animated: false, alpha: true, palette: null, exif: null, icc: null, wideGamut: false });
  const tagged = await sniff(await buildPng(PIXELS, 3, 2, [pngChunk('cICP', Uint8Array.of(12, 13, 0, 1)), pngChunk('eXIf', EXIF)]));
  assert.equal(tagged?.wideGamut, true);
  assert.deepEqual(tagged?.exif, EXIF);
  assert.equal((await sniff(await buildPng(PIXELS, 3, 2, [pngChunk('cICP', Uint8Array.of(1, 13, 0, 1))])))?.wideGamut, false);
  /** @param {Uint8Array} profile */
  const iccp = async (profile) => pngChunk('iCCP', joinBytes([latin1('name\0\0'), await throughStream(profile, new CompressionStream('deflate'))]));
  const profiled = await sniff(await buildPng(PIXELS, 3, 2, [await iccp(p3)]));
  assert.deepEqual(profiled?.icc, p3);
  assert.equal(profiled?.wideGamut, true);
  assert.equal((await sniff(await buildPng(PIXELS, 3, 2, [await iccp(srgb)])))?.wideGamut, false);
  const flat = new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 255, 255, 255, 0, 0, 255, 0, 0, 255, 255]);
  const indexed = await sniff(await encodeIndexedPng({ data: flat, width: 2, height: 2 }, /** @type {Map<number, number>} */ (paletteOf(flat))));
  assert.deepEqual([indexed?.palette, indexed?.alpha, indexed?.width], [2, false, 2]);
  assert.equal((await sniff(await buildApng([PIXELS, PIXELS], 3, 2)))?.animated, true);
});

test('WebP: lossy, lossless (with its transparency bit), and the extended kind with its flags and chunks', async () => {
  assert.deepEqual(await sniff(webpFile([riff('VP8 ', vp8(640, 480))])), { type: 'image/webp', width: 640, height: 480, animated: false, alpha: false, palette: null, exif: null, icc: null, wideGamut: false });
  const lossless = await sniff(webpFile([riff('VP8L', vp8l(16383, 2, true))]));
  assert.deepEqual([lossless?.width, lossless?.height, lossless?.alpha], [16383, 2, true]);
  const extended = await sniff(webpFile([riff('VP8X', vp8x(0x20 | 0x10 | 0x08, 70000, 300)), riff('ICCP', p3), riff('VP8 ', vp8(1, 1)), riff('EXIF', EXIF)]));
  assert.deepEqual([extended?.width, extended?.height, extended?.alpha, extended?.animated, extended?.wideGamut], [70000, 300, true, false, true]);
  assert.deepEqual(extended?.exif, EXIF);
  assert.equal((await sniff(webpFile([riff('VP8X', vp8x(0x02, 10, 10)), riff('ANIM', new Uint8Array(6))])))?.animated, true);
  // Some writers put “Exif\0\0” before the block: it's taken off.
  const prefixed = await sniff(webpFile([riff('VP8X', vp8x(0x08, 4, 4)), riff('VP8 ', vp8(4, 4)), riff('EXIF', joinBytes([latin1('Exif\0\0'), EXIF]))]));
  assert.deepEqual(prefixed?.exif, EXIF);
});

test('GIF: one picture is still, two move; transparency from its control block', async () => {
  const options = { width: 2, height: 2, palette: /** @type {[number, number, number][]} */ ([[255, 0, 0], [0, 0, 255]]) };
  const frame = Uint8Array.of(0, 1, 1, 0);
  assert.deepEqual(await sniff(buildGif([frame], options)), { type: 'image/gif', width: 2, height: 2, animated: false, alpha: false, palette: null, exif: null, icc: null, wideGamut: false });
  assert.equal((await sniff(buildGif([frame, frame], options)))?.animated, true);
  assert.equal((await sniff(buildGif([frame], { ...options, transparent: 1 })))?.alpha, true);
  // A first frame long enough to need many blocks is walked past to find the second.
  const big = { width: 300, height: 300, palette: options.palette };
  assert.equal((await sniff(buildGif([new Uint8Array(90_000), new Uint8Array(90_000)], big)))?.animated, true);
});

test('AVIF: the largest picture\'s size, a sequence, transparency, its colour tag', async () => {
  /** @param {Uint8Array[]} properties @param {string} [brands] */
  const avif = (properties, brands = 'avif\0\0\0\0avifmif1') => joinBytes([
    box('ftyp', [latin1(brands)]),
    box('meta', [new Uint8Array(4), box('hdlr', [new Uint8Array(20)]), box('iprp', [box('ipco', properties)])]),
  ]);
  const ispe = (/** @type {number} */ w, /** @type {number} */ h) => box('ispe', [uint32s([0, w, h])]);
  assert.deepEqual(await sniff(avif([ispe(160, 120), ispe(4000, 3000)])), { type: 'image/avif', width: 4000, height: 3000, animated: false, alpha: false, palette: null, exif: null, icc: null, wideGamut: false });
  assert.equal((await sniff(avif([ispe(10, 10)], 'avis\0\0\0\0avisavif')))?.animated, true);
  assert.equal((await sniff(avif([ispe(10, 10), box('auxC', [new Uint8Array(4), latin1('urn:mpeg:mpegB:cicp:systems:auxiliary:alpha\0')])])))?.alpha, true);
  assert.equal((await sniff(avif([ispe(10, 10), box('colr', [latin1('nclx'), Uint8Array.of(0, 12, 0, 13, 0, 1, 0x80)])])))?.wideGamut, true);
  assert.equal((await sniff(avif([ispe(10, 10), box('colr', [latin1('nclx'), Uint8Array.of(0, 1, 0, 13, 0, 1, 0x80)])])))?.wideGamut, false);
  assert.equal((await sniff(avif([ispe(10, 10), box('colr', [latin1('prof'), p3])])))?.wideGamut, true);
  assert.equal(await sniff(avif([])), null);
});

test('BMP; and what isn\'t a picture, is cut short or lies about its size is null, never an error', async () => {
  const bmp = new Uint8Array(54);
  bmp.set(latin1('BM'));
  new DataView(bmp.buffer).setInt32(18, 320, true);
  new DataView(bmp.buffer).setInt32(22, -200, true);
  new DataView(bmp.buffer).setUint16(28, 24, true);
  assert.deepEqual([(await sniff(bmp))?.type, (await sniff(bmp))?.width, (await sniff(bmp))?.height], ['image/bmp', 320, 200]);
  assert.equal(await sniff(latin1('<svg xmlns="http://www.w3.org/2000/svg"/>')), null);
  assert.equal(await sniff(latin1('%PDF-1.7 not a picture at all')), null);
  assert.equal(await sniff(new Uint8Array(0)), null);
  const jpeg = jpegHeaders({ width: 640, height: 480, exif: EXIF });
  for (let length = 0; length < jpeg.length - 60; length += 7) assert.equal(await sniff(jpeg.subarray(0, length)), null, `JPEG cut at ${length}`);
  const png = await buildPng(PIXELS, 3, 2);
  for (let length = 0; length < 33; length += 3) assert.equal(await sniff(png.subarray(0, length)), null, `PNG cut at ${length}`);
  assert.equal(await sniff(jpegHeaders({ width: 0, height: 480 })), null);
  // Random bytes after each signature never throw.
  let seed = 7;
  const random = () => (seed = (seed * 1_103_515_245 + 12_345) & 0x7fffffff) & 0xff;
  for (const signature of ['\xff\xd8\xff', '\x89PNG\r\n\x1a\n', 'RIFF\0\0\0\0WEBPVP8X', 'GIF89a', '\0\0\0\x18ftypavif', 'BM']) {
    for (let round = 0; round < 40; round++) await sniff(joinBytes([latin1(signature), Uint8Array.from({ length: 300 }, random)]));
  }
});
