import { test } from 'node:test';
import assert from 'node:assert/strict';
import { axisWeights, createResampler, resamplePixels } from '../src/index.js';
import { checkerboard, zonePlate } from '../src/testing.js';

/** @param {Uint8ClampedArray} data Each channel's lowest and highest value. */
function spread(data) {
  const low = [255, 255, 255, 255];
  const high = [0, 0, 0, 0];
  for (let i = 0; i < data.length; i++) {
    low[i % 4] = Math.min(low[i % 4], data[i]);
    high[i % 4] = Math.max(high[i % 4], data[i]);
  }
  return { low, high };
}

test('a single-pixel checkerboard shrinks to one even grey: 188 as light, 128 as sRGB numbers', () => {
  for (const [from, to] of [[512, 64], [512, 75], [500, 33]]) {
    const light = spread(resamplePixels({ data: checkerboard(from, from), width: from, height: from }, to, to).data);
    assert.ok(light.low[0] >= 187 && light.high[0] <= 188, `${from}→${to} as light: ${light.low[0]}–${light.high[0]}`);
    const numbers = spread(resamplePixels({ data: checkerboard(from, from), width: from, height: from }, to, to, { linear: false }).data);
    assert.ok(numbers.low[0] >= 127 && numbers.high[0] <= 128, `${from}→${to} as numbers: ${numbers.low[0]}–${numbers.high[0]}`);
    assert.deepEqual([light.low[3], light.high[3]], [255, 255]);
  }
});

test('the same size gives the same pixels, every level of every channel', () => {
  const data = new Uint8ClampedArray(256 * 4 * 4);
  for (let i = 0; i < 256 * 4; i++) data.set([i % 256, (i * 7) % 256, 255 - (i % 256), 255], i * 4);
  assert.deepEqual(resamplePixels({ data, width: 256, height: 4 }, 256, 4).data, data);
  assert.deepEqual(resamplePixels({ data, width: 256, height: 4 }, 256, 4, { linear: false }).data, data);
});

test('a flat colour stays that colour at any size, smaller or larger', () => {
  const data = new Uint8ClampedArray(40 * 30 * 4);
  for (let i = 0; i < data.length; i += 4) data.set([37, 150, 201, 255], i);
  for (const [width, height] of [[7, 5], [40, 11], [93, 64], [1, 1]]) {
    const { low, high } = spread(resamplePixels({ data, width: 40, height: 30 }, width, height).data);
    assert.deepEqual([low, high], [[37, 150, 201, 255], [37, 150, 201, 255]], `${width}×${height}`);
  }
});

test('colour is weighted by opacity: nothing leaks from transparent pixels into an edge', () => {
  // Opaque red on the left, fully transparent green on the right.
  const data = new Uint8ClampedArray(64 * 8 * 4);
  for (let y = 0; y < 8; y++) for (let x = 0; x < 64; x++) data.set(x < 32 ? [255, 0, 0, 255] : [0, 255, 0, 0], (y * 64 + x) * 4);
  const small = resamplePixels({ data, width: 64, height: 8 }, 16, 2).data;
  for (let i = 0; i < small.length; i += 4) {
    if (small[i + 3] === 0) assert.deepEqual([...small.slice(i, i + 3)], [0, 0, 0]);
    else assert.deepEqual([small[i], small[i + 1], small[i + 2]], [255, 0, 0], `pixel ${i / 4} alpha ${small[i + 3]}`);
  }
  assert.equal(small[3], 255);
  assert.equal(small[15 * 4 + 3], 0);
});

test('rows written in bands give exactly the pixels of the whole written at once', () => {
  const size = 300;
  const source = { data: zonePlate(size), width: size, height: size };
  for (const [width, height] of [[77, 41], [300, 120], [450, 450]]) {
    const whole = resamplePixels(source, width, height).data;
    const banded = new Uint8ClampedArray(width * height * 4);
    let emitted = 0;
    const resize = createResampler({ srcWidth: size, srcHeight: size, width, height }, (rows, y, count) => {
      assert.equal(y, emitted, 'rows come in order');
      assert.equal(rows.length, count * width * 4);
      banded.set(rows, y * width * 4);
      emitted += count;
    });
    for (let y = 0; y < size; y += 37) {
      const rows = Math.min(37, size - y);
      resize.write(source.data.subarray(y * size * 4, (y + rows) * size * 4), rows);
      assert.equal(resize.done(), y + rows >= size);
    }
    assert.equal(emitted, height);
    assert.deepEqual(banded, whole, `${width}×${height}`);
  }
});

test('fine rings finer than the result can show become grey, not false coarse rings', () => {
  const size = 1200;
  const to = 150; // 8 times smaller
  const out = resamplePixels({ data: zonePlate(size), width: size, height: size }, to, to, { linear: false }).data;
  // Past 30 px from the middle the source's rings are at least twice as fine as the result can show.
  let sum = 0;
  let squares = 0;
  let count = 0;
  for (let y = 0; y < to; y++) {
    for (let x = 0; x < to; x++) {
      const distance = Math.hypot(x - (to - 1) / 2, y - (to - 1) / 2);
      if (distance < 30 || distance > to / 2 - 4) continue;
      sum += out[(y * to + x) * 4];
      squares += out[(y * to + x) * 4] ** 2;
      count += 1;
    }
  }
  const deviation = Math.sqrt(squares / count - (sum / count) ** 2);
  assert.ok(deviation < 1.5, `deviation ${deviation.toFixed(2)} levels`);
});

test('axisWeights: every result pixel\'s weights sum to 1 and stay inside the source', () => {
  for (const [from, to] of [[1000, 37], [37, 1000], [10, 10], [3, 1], [1, 5]]) {
    const { starts, counts, weights, taps } = axisWeights(from, to);
    for (let i = 0; i < to; i++) {
      assert.ok(starts[i] >= 0 && starts[i] + counts[i] <= from && counts[i] >= 1 && counts[i] <= taps);
      const sum = weights.subarray(i * taps, i * taps + counts[i]).reduce((a, b) => a + b, 0);
      assert.ok(Math.abs(sum - 1) < 1e-5, `${from}→${to} pixel ${i}: ${sum}`);
    }
  }
});
