/**
 * Resizing pixels properly: a Lanczos-3 filter as wide as the reduction (so every source pixel
 * counts, however much smaller the result), on light itself rather than on sRGB's numbers (a
 * black-and-white checkerboard shrinks to the grey the eye sees from a distance, 188, not 128),
 * with colour weighted by its opacity (no dark fringes round a cut-out). Rows are taken as they
 * come, in bands, so a 100-megapixel picture never has to be held as pixels all at once. Pure:
 * typed arrays in, typed arrays out.
 *
 * @module resample
 */

/** The filter's reach, in lobes: Lanczos-3. */
const LOBES = 3;

/** Steps of light the encode table tells apart: enough that all 256 levels survive there and back. */
const ENCODE_STEPS = 65_535;

/** sRGB's level (0–255) as light (0–1). */
const TO_LIGHT = Float32Array.from({ length: 256 }, (_, level) => {
  const value = level / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
});

/** Light (0–1 in 65,535 steps) as sRGB's level. */
const TO_LEVEL = Uint8Array.from({ length: ENCODE_STEPS + 1 }, (_, step) => {
  const light = step / ENCODE_STEPS;
  return Math.round(255 * (light <= 0.0031308 ? light * 12.92 : 1.055 * light ** (1 / 2.4) - 0.055));
});

/** A level as itself (0–1): the filter run on sRGB's numbers, as a canvas does. */
const TO_UNIT = Float32Array.from({ length: 256 }, (_, level) => level / 255);

/**
 * @typedef {object} Weights One axis's filter: for result pixel `i`, source pixels `starts[i]` to
 *   `starts[i] + counts[i] - 1`, weighted `weights[i * taps + k]` (summing to 1).
 * @property {Int32Array} starts
 * @property {Int32Array} counts
 * @property {Float32Array} weights
 * @property {number} taps The most source pixels any result pixel reads.
 */

/**
 * @param {number} x - A distance in source pixels over the filter's scale.
 * @returns {number} Lanczos-3 there.
 */
function lanczos(x) {
  if (x === 0) return 1;
  if (x <= -LOBES || x >= LOBES) return 0;
  const px = Math.PI * x;
  return (LOBES * Math.sin(px) * Math.sin(px / LOBES)) / (px * px);
}

/**
 * One axis's filter.
 *
 * @param {number} from - The source's length (px).
 * @param {number} to - The result's length (px).
 * @returns {Weights} The weights.
 */
export function axisWeights(from, to) {
  const ratio = from / to;
  const scale = Math.max(1, ratio);
  const reach = LOBES * scale;
  const taps = Math.min(from, Math.ceil(reach * 2) + 1);
  const starts = new Int32Array(to);
  const counts = new Int32Array(to);
  const weights = new Float32Array(to * taps);
  for (let i = 0; i < to; i++) {
    const centre = (i + 0.5) * ratio - 0.5;
    const first = Math.max(0, Math.ceil(centre - reach));
    const last = Math.min(from - 1, Math.floor(centre + reach));
    let sum = 0;
    for (let j = first; j <= last; j++) {
      const weight = lanczos((j - centre) / scale);
      weights[i * taps + (j - first)] = weight;
      sum += weight;
    }
    for (let k = 0; k <= last - first; k++) weights[i * taps + k] /= sum;
    starts[i] = first;
    counts[i] = last - first + 1;
  }
  return { starts, counts, weights, taps };
}

/**
 * @typedef {object} ResampleOptions
 * @property {number} srcWidth The source's width (px).
 * @property {number} srcHeight The source's height (px).
 * @property {number} width The result's width (px).
 * @property {number} height The result's height (px).
 * @property {boolean} [linear] Filter light itself (default), or sRGB's numbers as a canvas does (false).
 */

/**
 * A resize that takes the source a band of rows at a time.
 *
 * @param {ResampleOptions} options - The sizes.
 * @param {(rows: Uint8ClampedArray, y: number, count: number) => void} emit - Called with result
 *   rows (RGBA) as soon as the source rows they need have arrived: `count` rows from row `y`.
 * @returns {{write: (rgba: Uint8ClampedArray | Uint8Array, rows: number) => void, done: () => boolean}}
 *   `write` the next `rows` source rows (RGBA, not premultiplied), top to bottom; `done` once
 *   every result row has been emitted.
 * @example
 * const out = new Uint8ClampedArray(100 * 50 * 4);
 * const resize = createResampler({ srcWidth: 400, srcHeight: 200, width: 100, height: 50 }, (rows, y) => out.set(rows, y * 100 * 4));
 * resize.write(topHalf, 100);
 * resize.write(bottomHalf, 100);
 */
export function createResampler({ srcWidth, srcHeight, width, height, linear = true }, emit) {
  const across = axisWeights(srcWidth, width);
  const down = axisWeights(srcHeight, height);
  const decode = linear ? TO_LIGHT : TO_UNIT;
  const stride = width * 4;
  // The last `down.taps` source rows, each already resized across: light times opacity, and opacity.
  const ring = new Float32Array(down.taps * stride);
  const lit = new Float32Array(srcWidth * 4);
  const sums = new Float32Array(stride);
  let sourceRow = 0;
  let resultRow = 0;

  /** Resize source row `row` of `rgba` across, into the ring. */
  const acrossInto = (/** @type {Uint8ClampedArray | Uint8Array} */ rgba, /** @type {number} */ row) => {
    const offset = row * srcWidth * 4;
    for (let i = 0; i < srcWidth * 4; i += 4) {
      const alpha = rgba[offset + i + 3] / 255;
      lit[i] = decode[rgba[offset + i]] * alpha;
      lit[i + 1] = decode[rgba[offset + i + 1]] * alpha;
      lit[i + 2] = decode[rgba[offset + i + 2]] * alpha;
      lit[i + 3] = alpha;
    }
    const slot = (sourceRow % down.taps) * stride;
    const { starts, counts, weights, taps } = across;
    for (let x = 0; x < width; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let at = starts[x] * 4;
      const first = x * taps;
      for (let k = 0; k < counts[x]; k++, at += 4) {
        const weight = weights[first + k];
        r += lit[at] * weight;
        g += lit[at + 1] * weight;
        b += lit[at + 2] * weight;
        a += lit[at + 3] * weight;
      }
      ring[slot + x * 4] = r;
      ring[slot + x * 4 + 1] = g;
      ring[slot + x * 4 + 2] = b;
      ring[slot + x * 4 + 3] = a;
    }
  };

  /** Result row `resultRow` from the ring, into `out` at `offset`. */
  const downInto = (/** @type {Uint8ClampedArray} */ out, /** @type {number} */ offset) => {
    sums.fill(0);
    const first = down.starts[resultRow];
    for (let k = 0; k < down.counts[resultRow]; k++) {
      const weight = down.weights[resultRow * down.taps + k];
      const slot = ((first + k) % down.taps) * stride;
      for (let i = 0; i < stride; i++) sums[i] += ring[slot + i] * weight;
    }
    for (let i = 0; i < stride; i += 4) {
      const alpha = sums[i + 3];
      if (alpha <= 1 / 510) continue; // Nothing there: transparent black, as `out` starts.
      const opacity = Math.min(1, alpha);
      for (let channel = 0; channel < 3; channel++) {
        const value = Math.min(1, Math.max(0, sums[i + channel] / alpha));
        out[offset + i + channel] = linear ? TO_LEVEL[Math.round(value * ENCODE_STEPS)] : Math.round(value * 255);
      }
      out[offset + i + 3] = Math.round(opacity * 255);
    }
  };

  return {
    write(rgba, rows) {
      /** @type {number[]} */
      const ready = [];
      const batch = new Uint8ClampedArray(countReady(down, sourceRow + rows, resultRow, height) * stride);
      for (let row = 0; row < rows; row++, sourceRow++) {
        acrossInto(rgba, row);
        while (resultRow < height && down.starts[resultRow] + down.counts[resultRow] - 1 <= sourceRow) {
          downInto(batch, ready.length * stride);
          ready.push(resultRow++);
        }
      }
      if (ready.length) emit(batch, ready[0], ready.length);
    },
    done: () => resultRow >= height,
  };
}

/**
 * How many result rows can be finished once source rows up to (not including) `arrived` are in.
 *
 * @param {Weights} down - The vertical filter.
 * @param {number} arrived - Source rows in.
 * @param {number} from - The next result row.
 * @param {number} height - The result's height.
 * @returns {number} The count.
 */
function countReady(down, arrived, from, height) {
  let row = from;
  while (row < height && down.starts[row] + down.counts[row] <= arrived) row++;
  return row - from;
}

/**
 * Resize pixels held whole.
 *
 * @param {{data: Uint8ClampedArray | Uint8Array, width: number, height: number}} source - RGBA, not premultiplied.
 * @param {number} width - The result's width.
 * @param {number} height - The result's height.
 * @param {{linear?: boolean}} [options] - `linear: false` filters sRGB's numbers, as a canvas does.
 * @returns {{data: Uint8ClampedArray, width: number, height: number}} The result.
 * @example
 * const small = resamplePixels(context.getImageData(0, 0, 4000, 3000), 1600, 1200);
 */
export function resamplePixels(source, width, height, { linear = true } = {}) {
  const data = new Uint8ClampedArray(width * height * 4);
  const resize = createResampler({ srcWidth: source.width, srcHeight: source.height, width, height, linear }, (rows, y) => data.set(rows, y * width * 4));
  resize.write(source.data, source.height);
  return { data, width, height };
}
