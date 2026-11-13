import { test } from 'node:test';
import assert from 'node:assert/strict';
import { animatedWebp, searchQuality } from '../src/index.js';
import { ascii, joinBytes, viewOf } from '../src/bytes.js';
import { riff, vp8, vp8l, vp8x, webpFile } from './files.js';

/** An encoder whose file is 1,000 bytes a per cent of quality, and a log of what it was asked. */
function encoder() {
  /** @type {number[]} */
  const asked = [];
  return {
    asked,
    encode: async (/** @type {number} */ quality) => {
      asked.push(Math.round(quality * 100));
      return new Blob([new Uint8Array(Math.round(quality * 100) * 1000)]);
    },
  };
}

test('searchQuality: the highest quality that fits, to the per cent, in about seven encodes', async () => {
  for (const target of [20_000, 20_999, 47_500, 63_000, 94_000, 94_999]) {
    const { encode, asked } = encoder();
    const found = await searchQuality(encode, target);
    assert.deepEqual([found.quality, found.fits, found.blob.size], [Math.floor(target / 1000), true, Math.floor(target / 1000) * 1000], `target ${target}`);
    assert.equal(found.tries, asked.length);
    assert.ok(asked.length <= 8, `${asked.length} encodes`);
  }
});

test('searchQuality: the top quality when it fits (one encode); the lowest marked as not fitting when nothing does', async () => {
  const roomy = encoder();
  assert.deepEqual([(await searchQuality(roomy.encode, 500_000)).quality, roomy.asked], [95, [95]]);
  const tight = encoder();
  const found = await searchQuality(tight.encode, 5000);
  assert.deepEqual([found.quality, found.fits, found.blob.size], [20, false, 20_000]);
  const ranged = encoder();
  assert.equal((await searchQuality(ranged.encode, 500_000, { min: 40, max: 80 })).quality, 80);
  assert.equal((await searchQuality(ranged.encode, 1, { min: 40, max: 80 })).quality, 40);
});

test('animatedWebp: every frame\'s picture chunks in a frame of its own, the size, the loops, how long each shows', () => {
  const lossy = webpFile([riff('VP8X', vp8x(0x10, 320, 240)), riff('ALPH', Uint8Array.of(1, 2, 3)), riff('VP8 ', vp8(320, 240)), riff('EXIF', new Uint8Array(8))]);
  const lossless = webpFile([riff('VP8L', vp8l(320, 240, false))]);
  const file = joinBytes(animatedWebp([{ webp: lossy, duration: 70 }, { webp: lossless, duration: 100_000_000 }], { width: 320, height: 240, loops: 3 }));
  const view = viewOf(file);
  assert.equal(ascii(file, 0, 4) + ascii(file, 8, 8), 'RIFFWEBPVP8X');
  assert.equal(view.getUint32(4, true), file.length - 8);
  assert.equal(file[20], 0x12, 'animated, with transparency (the first frame has an alpha chunk)');
  assert.deepEqual([file[24] | (file[25] << 8), file[27]], [319, 239]);
  assert.equal(ascii(file, 30, 4), 'ANIM');
  assert.equal(view.getUint16(42, true), 3);
  const first = 44;
  assert.equal(ascii(file, first, 4), 'ANMF');
  assert.deepEqual([...file.subarray(first + 8, first + 14)], [0, 0, 0, 0, 0, 0], 'at the top left');
  assert.equal(file[first + 20] | (file[first + 21] << 8) | (file[first + 22] << 16), 70);
  assert.equal(file[first + 23], 0x02, 'not blended with the frame before');
  assert.equal(ascii(file, first + 24, 4), 'ALPH');
  assert.equal(ascii(file).includes('EXIF'), false, 'only the picture is taken from each still');
  const second = first + 8 + view.getUint32(first + 4, true);
  assert.equal(ascii(file, second, 4), 'ANMF');
  assert.equal(file[second + 20] | (file[second + 21] << 8) | (file[second + 22] << 16), 0xffffff, 'the longest the format can say');
  assert.equal(ascii(file, second + 24, 4), 'VP8L');
  assert.equal(second + 8 + view.getUint32(second + 4, true), file.length);
});
