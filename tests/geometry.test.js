import { test } from 'node:test';
import assert from 'node:assert/strict';
import { centredCrop, clampRect, orientedSize, planOutput, resizedSize, toSourceRect, turned, UPRIGHT } from '../src/index.js';

/** @import { Orientation } from '../src/index.js' */

const W = 5;
const H = 3;
/** A 5×3 picture whose every pixel is its own number, as rows. */
const SOURCE = Array.from({ length: H }, (_, y) => Array.from({ length: W }, (_, x) => y * W + x));

/** @param {number[][]} rows */
const mirror = (rows) => rows.map((row) => [...row].reverse());
/** @param {number[][]} rows A quarter turn clockwise. */
const quarter = (rows) => rows[0].map((_, x) => rows.map((row) => row[x]).reverse());
/** @param {number[][]} rows */
const upsideDown = (rows) => [...rows].reverse();

/**
 * The picture as an orientation says it looks, worked out the slow way.
 *
 * @param {Orientation} orientation
 */
function seen(orientation) {
  let rows = orientation.flip ? mirror(SOURCE) : SOURCE;
  for (let i = 0; i < orientation.turns; i++) rows = quarter(rows);
  return rows;
}

/** Every orientation. */
const ALL = /** @type {Orientation[]} */ ([0, 1, 2, 3].flatMap((turns) => [false, true].map((flip) => ({ turns, flip }))));

test('turned: each action on each orientation is that action on the picture as it looks', () => {
  const actions = /** @type {const} */ ({ right: quarter, left: (/** @type {number[][]} */ rows) => quarter(quarter(quarter(rows))), 'flip-horizontal': mirror, 'flip-vertical': upsideDown });
  for (const orientation of ALL) {
    for (const [action, apply] of Object.entries(actions)) {
      assert.deepEqual(seen(turned(orientation, /** @type {keyof typeof actions} */ (action))), apply(seen(orientation)), `${JSON.stringify(orientation)} ${action}`);
    }
  }
});

test('toSourceRect: a box on the turned picture holds the same pixels as its box on the source', () => {
  for (const orientation of ALL) {
    const view = seen(orientation);
    const size = orientedSize({ width: W, height: H }, orientation);
    assert.deepEqual(size, { width: view[0].length, height: view.length });
    for (let y = 0; y < size.height; y++) {
      for (let x = 0; x < size.width; x++) {
        for (const [w, h] of [[1, 1], [2, 1], [1, 2], [size.width - x, size.height - y]]) {
          if (x + w > size.width || y + h > size.height) continue;
          const inView = view.slice(y, y + h).flatMap((row) => row.slice(x, x + w)).sort((a, b) => a - b);
          const box = toSourceRect({ x, y, width: w, height: h }, { width: W, height: H }, orientation);
          const inSource = SOURCE.slice(box.y, box.y + box.height).flatMap((row) => row.slice(box.x, box.x + box.width)).sort((a, b) => a - b);
          assert.deepEqual(inSource, inView, `${JSON.stringify(orientation)} ${x},${y} ${w}×${h}`);
        }
      }
    }
  }
});

test('resizedSize: each mode; never larger unless asked; exact always stretches', () => {
  const photo = { width: 4000, height: 3000 };
  assert.deepEqual(resizedSize(photo, { mode: 'none' }), photo);
  assert.deepEqual(resizedSize(photo, { mode: 'percent', percent: 50 }), { width: 2000, height: 1500 });
  assert.deepEqual(resizedSize(photo, { mode: 'longest', size: 1600 }), { width: 1600, height: 1200 });
  assert.deepEqual(resizedSize({ width: 3000, height: 4000 }, { mode: 'longest', size: 1600 }), { width: 1200, height: 1600 });
  assert.deepEqual(resizedSize(photo, { mode: 'width', width: 1000 }), { width: 1000, height: 750 });
  assert.deepEqual(resizedSize(photo, { mode: 'height', height: 300 }), { width: 400, height: 300 });
  assert.deepEqual(resizedSize(photo, { mode: 'fit', width: 1920, height: 1080 }), { width: 1440, height: 1080 });
  assert.deepEqual(resizedSize(photo, { mode: 'exact', width: 100, height: 100 }), { width: 100, height: 100 });
  assert.deepEqual(resizedSize(photo, { mode: 'longest', size: 8000 }), photo);
  assert.deepEqual(resizedSize(photo, { mode: 'percent', percent: 200 }), photo);
  assert.deepEqual(resizedSize(photo, { mode: 'longest', size: 8000 }, true), { width: 8000, height: 6000 });
  assert.deepEqual(resizedSize({ width: 10, height: 10 }, { mode: 'exact', width: 40, height: 20 }), { width: 40, height: 20 });
  assert.deepEqual(resizedSize({ width: 4000, height: 2 }, { mode: 'width', width: 100 }), { width: 100, height: 1 });
  for (const bad of [0, -5, NaN, Infinity]) assert.deepEqual(resizedSize(photo, { mode: 'percent', percent: bad }), photo);
});

test('centredCrop and clampRect: whole pixels, inside the picture', () => {
  assert.deepEqual(centredCrop({ width: 400, height: 300 }, 1), { x: 50, y: 0, width: 300, height: 300 });
  assert.deepEqual(centredCrop({ width: 300, height: 400 }, 16 / 9), { x: 0, y: 115, width: 300, height: 169 });
  assert.deepEqual(centredCrop({ width: 400, height: 300 }, 0), { x: 0, y: 0, width: 400, height: 300 });
  assert.deepEqual(clampRect({ x: -4, y: 2.4, width: 900, height: 0 }, { width: 400, height: 300 }), { x: 0, y: 2, width: 400, height: 1 });
  assert.deepEqual(clampRect({ x: 500, y: 500, width: 10, height: 10 }, { width: 400, height: 300 }), { x: 399, y: 299, width: 1, height: 1 });
  assert.deepEqual(clampRect({ x: NaN, y: 0, width: NaN, height: 10 }, { width: 400, height: 300 }), { x: 0, y: 0, width: 1, height: 10 });
});

test('planOutput: the crop is taken as seen, the resize follows it, a turn swaps the sides', () => {
  const source = { width: 4000, height: 3000 };
  assert.deepEqual(planOutput(source), {
    oriented: source, crop: { x: 0, y: 0, ...source }, sourceRect: { x: 0, y: 0, ...source }, scaled: source, width: 4000, height: 3000, resampled: false,
  });
  const sideways = planOutput(source, { orientation: { turns: 1, flip: false }, resize: { mode: 'longest', size: 1000 } });
  assert.deepEqual([sideways.oriented, sideways.scaled, sideways.width, sideways.height, sideways.resampled], [{ width: 3000, height: 4000 }, { width: 1000, height: 750 }, 750, 1000, true]);
  const cropped = planOutput(source, { orientation: { turns: 1, flip: false }, crop: { rect: { x: 0, y: 0, width: 300, height: 400 } } });
  // The top-left of the picture turned clockwise is the source's bottom-left.
  assert.deepEqual(cropped.sourceRect, { x: 0, y: 2700, width: 400, height: 300 });
  assert.equal(cropped.resampled, false);
  const square = planOutput(source, { crop: { ratio: 1 }, resize: { mode: 'width', width: 500 } });
  assert.deepEqual([square.crop, square.width, square.height], [{ x: 500, y: 0, width: 3000, height: 3000 }, 500, 500]);
  assert.equal(planOutput(source, { orientation: UPRIGHT, resize: { mode: 'longest', size: 4000 } }).resampled, false);
});
