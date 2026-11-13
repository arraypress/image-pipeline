import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bytesReader, JPEG_MAX_EXIF, pngChunk, readExif, rewriteExif, sniffImage, withExif } from '../src/index.js';
import { ascii, crc32, latin1, viewOf } from '../src/bytes.js';
import { buildExif, buildPng } from '../src/testing.js';
import { jpegHeaders, riff, vp8, vp8l, vp8x, webpFile } from './files.js';

const WESTMINSTER = { latitude: 51.5007, longitude: -0.1246 };
const THUMBNAIL = latin1('\xff\xd8 a small copy of the picture before it was cropped \xff\xd9');
const NOTE = latin1('MAKER-NOTE-KEPT-AS-IT-IS');
const CAMERA = { orientation: 6, make: 'Example', model: 'Pixel 9 Pro', taken: '2026:11:13 10:22:05', location: WESTMINSTER, thumbnail: THUMBNAIL, makerNote: NOTE, pixels: { width: 4032, height: 3024 } };

/** @param {Uint8Array} bytes @param {Uint8Array} part Whether the bytes hold the part anywhere. */
const holds = (bytes, part) => ascii(bytes).includes(ascii(part));

test('readExif: orientation, camera, when, where (south and west negative), in either byte order', () => {
  for (const little of [true, false]) {
    const read = readExif(buildExif({ ...CAMERA, little }));
    assert.deepEqual({ ...read, location: null }, { orientation: 6, make: 'Example', model: 'Pixel 9 Pro', lens: '', software: '', taken: '2026:11:13 10:22:05', location: null, hasLocation: true, hasThumbnail: true });
    assert.ok(Math.abs((read?.location?.latitude ?? 0) - 51.5007) < 1e-4 && Math.abs((read?.location?.longitude ?? 0) + 0.1246) < 1e-4);
  }
  assert.deepEqual(readExif(buildExif({ location: { latitude: -33.8568, longitude: 151.2153 } }))?.location?.latitude.toFixed(4), '-33.8568');
  assert.deepEqual(readExif(buildExif({ model: 'X' })), { orientation: 1, make: '', model: 'X', lens: '', software: '', taken: '', location: null, hasLocation: false, hasThumbnail: false });
  assert.equal(readExif(buildExif({ orientation: 9 }))?.orientation, 1);
});

test('rewriteExif: upright, no thumbnail, no location; the camera, the time and the maker note where they were', () => {
  for (const little of [true, false]) {
    const source = buildExif({ ...CAMERA, little });
    const kept = /** @type {Uint8Array} */ (rewriteExif(source, { width: 1600, height: 1200 }));
    assert.deepEqual(readExif(kept), { orientation: 1, make: 'Example', model: 'Pixel 9 Pro', lens: '', software: '', taken: '2026:11:13 10:22:05', location: null, hasLocation: false, hasThumbnail: false });
    assert.equal(holds(kept, THUMBNAIL), false, 'the thumbnail is gone');
    assert.equal(holds(kept, NOTE), true);
    assert.equal(ascii(kept).indexOf(ascii(NOTE)), ascii(source).indexOf(ascii(NOTE)), 'the maker note has not moved');
    assert.ok(kept.length < source.length - THUMBNAIL.length, 'what was blanked at the end is cut off');
    // The location's own bytes (51° 30′ as two fractions) are nowhere in what's left.
    const degrees = new Uint8Array(16);
    [51, 1, 30, 1].forEach((value, index) => viewOf(degrees).setUint32(index * 4, value, little));
    assert.equal(holds(source, degrees), true);
    assert.equal(holds(kept, degrees), false);
    assert.equal(holds(source, latin1('N\0')) && !ascii(kept.subarray(8, 8 + 2 + 12 * 6)).includes('\x25\x88'), true, 'no GPS pointer in the first directory');
    assert.deepEqual(source, buildExif({ ...CAMERA, little }), 'the source is not changed');
  }
});

test('rewriteExif: the location kept when asked; the pixel size written where EXIF records it', () => {
  const kept = /** @type {Uint8Array} */ (rewriteExif(buildExif(CAMERA), { location: true, width: 800, height: 600 }));
  const read = readExif(kept);
  assert.equal(read?.hasLocation, true);
  assert.equal(read?.location?.latitude.toFixed(3), '51.501');
  assert.equal(read?.hasThumbnail, false);
  const view = viewOf(kept);
  const text = ascii(kept);
  const widthAt = text.indexOf('\x02\xa0\x04\0\x01\0\0\0');
  assert.equal(view.getUint32(widthAt + 8, true), 800);
  assert.equal(view.getUint32(text.indexOf('\x03\xa0\x04\0\x01\0\0\0') + 8, true), 600);
});

test('rewriteExif and readExif: what isn\'t EXIF is null, and no bytes make either throw', () => {
  assert.equal(rewriteExif(latin1('not a TIFF block at all')), null);
  assert.equal(readExif(new Uint8Array(4)), null);
  const good = buildExif(CAMERA);
  let seed = 11;
  const random = () => (seed = (seed * 1_103_515_245 + 12_345) & 0x7fffffff);
  for (let round = 0; round < 3000; round++) {
    const broken = good.slice();
    for (let hits = 0; hits < 1 + (round % 5); hits++) broken[random() % broken.length] = random() & 0xff;
    readExif(broken);
    const rewritten = rewriteExif(broken);
    if (rewritten) assert.ok(rewritten.length <= broken.length);
  }
  for (let length = 0; length < good.length; length += 3) rewriteExif(good.subarray(0, length));
});

test('withExif: a JPEG, a PNG and both kinds of WebP come back with the EXIF where a reader finds it', async () => {
  const exif = /** @type {Uint8Array} */ (rewriteExif(buildExif(CAMERA)));
  const picture = { width: 640, height: 480, alpha: true };
  const jpeg = /** @type {Uint8Array} */ (withExif(jpegHeaders({ width: 640, height: 480 }), 'image/jpeg', exif, picture));
  assert.deepEqual([...jpeg.subarray(0, 4)], [0xff, 0xd8, 0xff, 0xe0], 'after the JFIF header');
  assert.deepEqual((await sniffImage(bytesReader(jpeg)))?.exif, exif);

  const png = /** @type {Uint8Array} */ (withExif(await buildPng(new Uint8ClampedArray(16).fill(9), 2, 2, [pngChunk('gAMA', new Uint8Array(4))]), 'image/png', exif, picture));
  const info = await sniffImage(bytesReader(png));
  assert.deepEqual(info?.exif, exif);
  const at = ascii(png).indexOf('eXIf');
  assert.equal(viewOf(png).getUint32(at + 4 + exif.length), crc32([png.subarray(at, at + 4 + exif.length)]), 'the chunk\'s checksum is right');
  assert.ok(at < ascii(png).indexOf('IDAT'));

  for (const [name, simple, alpha] of /** @type {const} */ ([['lossy', riff('VP8 ', vp8(640, 480)), false], ['lossless', riff('VP8L', vp8l(640, 480, true)), true]])) {
    const webp = /** @type {Uint8Array} */ (withExif(webpFile([simple]), 'image/webp', exif, { ...picture, alpha }));
    const read = await sniffImage(bytesReader(webp));
    assert.deepEqual([read?.exif, read?.width, read?.height, read?.alpha], [exif, 640, 480, alpha], name);
    assert.equal(viewOf(webp).getUint32(4, true), webp.length - 8, 'the RIFF length covers the file');
  }
  const extended = /** @type {Uint8Array} */ (withExif(webpFile([riff('VP8X', vp8x(0x10, 640, 480)), riff('ALPH', new Uint8Array(3)), riff('VP8 ', vp8(640, 480))]), 'image/webp', exif, picture));
  assert.deepEqual((await sniffImage(bytesReader(extended)))?.exif, exif);
  assert.equal(extended[20], 0x18, 'the EXIF flag is added to the flags there were');
});

test('withExif: EXIF too long for one JPEG segment isn\'t added', () => {
  const jpeg = jpegHeaders({ width: 4, height: 4 });
  assert.equal(withExif(jpeg, 'image/jpeg', new Uint8Array(JPEG_MAX_EXIF + 1), { width: 4, height: 4, alpha: false }), null);
  assert.ok(withExif(jpeg, 'image/jpeg', new Uint8Array(JPEG_MAX_EXIF), { width: 4, height: 4, alpha: false }));
});
