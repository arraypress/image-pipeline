/**
 * Where a picture's pixels go: turned and flipped, cropped, then resized. The crop is given as
 * the person sees it (after the turn and flip) and mapped back onto the source, so only that
 * part is ever read; the size is worked out before any pixel is touched. Pure.
 *
 * @module geometry
 */

/** @typedef {{x: number, y: number, width: number, height: number}} Rect A box (px). */
/** @typedef {{width: number, height: number}} Size A size (px). */

/**
 * How a picture is turned: `flip` mirrors it left to right first, then `turns` quarter turns
 * clockwise. The eight ways a rectangle can lie.
 *
 * @typedef {object} Orientation
 * @property {0 | 1 | 2 | 3} turns Quarter turns clockwise.
 * @property {boolean} flip Mirrored left to right before turning.
 */

/**
 * How a picture is resized. `fit` keeps its shape inside a box; `exact` stretches it to the box;
 * `longest` sets its longer side; `width` and `height` set one side; `percent` scales both.
 *
 * @typedef {{mode: 'none'}
 *   | {mode: 'percent', percent: number}
 *   | {mode: 'longest', size: number}
 *   | {mode: 'width', width: number}
 *   | {mode: 'height', height: number}
 *   | {mode: 'fit', width: number, height: number}
 *   | {mode: 'exact', width: number, height: number}} Resize
 */

/**
 * The part kept: a box as the person sees the picture (after the turn and flip), or a shape
 * (width over height) cut from the middle.
 *
 * @typedef {{rect: Rect} | {ratio: number}} Crop
 */

/**
 * @typedef {object} OutputPlan
 * @property {Size} oriented The picture's size once turned.
 * @property {Rect} crop The part kept, as the person sees it (whole pixels, inside the picture).
 * @property {Rect} sourceRect That part on the source, before the turn and flip.
 * @property {Size} scaled The size that part is resampled to, before the turn.
 * @property {number} width The result's width.
 * @property {number} height The result's height.
 * @property {boolean} resampled Whether any pixel changes size (false: a copy).
 */

/** The picture as it is. */
export const UPRIGHT = Object.freeze(/** @type {Orientation} */ ({ turns: 0, flip: false }));

/**
 * An orientation after one more action on the picture as it now looks.
 *
 * @param {Orientation} orientation - How it's turned now.
 * @param {'left' | 'right' | 'flip-horizontal' | 'flip-vertical'} action - What's done to it.
 * @returns {Orientation} How it's turned after.
 * @example
 * turned({ turns: 1, flip: false }, 'flip-horizontal'); // { turns: 3, flip: true }
 */
export function turned(orientation, action) {
  const { turns, flip } = orientation;
  /** @param {number} value */
  const quarter = (value) => /** @type {0 | 1 | 2 | 3} */ (((value % 4) + 4) % 4);
  if (action === 'right') return { turns: quarter(turns + 1), flip };
  if (action === 'left') return { turns: quarter(turns - 1), flip };
  // A mirror after a turn is the opposite turn after a mirror.
  if (action === 'flip-horizontal') return { turns: quarter(-turns), flip: !flip };
  return { turns: quarter(2 - turns), flip: !flip };
}

/**
 * A picture's size once turned.
 *
 * @param {Size} size - Its size.
 * @param {Orientation} orientation - How it's turned.
 * @returns {Size} Its size as the person sees it.
 */
export function orientedSize(size, orientation) {
  return orientation.turns % 2 ? { width: size.height, height: size.width } : { width: size.width, height: size.height };
}

/**
 * The largest box of a shape that fits in a picture, in its middle.
 *
 * @param {Size} size - The picture.
 * @param {number} ratio - Width over height.
 * @returns {Rect} The box, in whole pixels.
 * @example
 * centredCrop({ width: 400, height: 300 }, 1); // { x: 50, y: 0, width: 300, height: 300 }
 */
export function centredCrop(size, ratio) {
  if (!(ratio > 0) || !Number.isFinite(ratio)) return { x: 0, y: 0, ...size };
  const width = Math.max(1, Math.min(size.width, Math.round(size.height * ratio)));
  const height = Math.max(1, Math.min(size.height, Math.round(width / ratio)));
  return { x: Math.floor((size.width - width) / 2), y: Math.floor((size.height - height) / 2), width, height };
}

/**
 * A box made whole pixels and kept inside a picture (at least one pixel).
 *
 * @param {Rect} rect - The box.
 * @param {Size} size - The picture.
 * @returns {Rect} The box, inside it.
 */
export function clampRect(rect, size) {
  const x = Math.min(size.width - 1, Math.max(0, Math.round(rect.x) || 0));
  const y = Math.min(size.height - 1, Math.max(0, Math.round(rect.y) || 0));
  return {
    x, y,
    width: Math.min(size.width - x, Math.max(1, Math.round(rect.width) || 1)),
    height: Math.min(size.height - y, Math.max(1, Math.round(rect.height) || 1)),
  };
}

/**
 * A box on the turned picture, as a box on the source.
 *
 * @param {Rect} rect - The box as the person sees it.
 * @param {Size} source - The source's size.
 * @param {Orientation} orientation - How the picture is turned.
 * @returns {Rect} The same pixels on the source.
 */
export function toSourceRect(rect, source, orientation) {
  const { x, y, width, height } = rect;
  /** @type {Rect} */
  let box;
  if (orientation.turns === 1) box = { x: y, y: source.height - x - width, width: height, height: width };
  else if (orientation.turns === 2) box = { x: source.width - x - width, y: source.height - y - height, width, height };
  else if (orientation.turns === 3) box = { x: source.width - y - height, y: x, width: height, height: width };
  else box = { x, y, width, height };
  return orientation.flip ? { ...box, x: source.width - box.x - box.width } : box;
}

/**
 * The size a resize gives a picture.
 *
 * @param {Size} size - Its size now.
 * @param {Resize} resize - The resize.
 * @param {boolean} [upscale] - Whether it may grow. Default false: a picture already small
 *   enough keeps its size (`exact` always stretches to its box).
 * @returns {Size} Its new size, each side at least 1.
 * @example
 * resizedSize({ width: 4000, height: 3000 }, { mode: 'longest', size: 1600 }); // { width: 1600, height: 1200 }
 */
export function resizedSize(size, resize, upscale = false) {
  /** @param {number} value */
  const side = (value) => Math.max(1, Math.round(value));
  if (resize.mode === 'exact') return { width: side(resize.width), height: side(resize.height) };
  let scale = 1;
  if (resize.mode === 'percent') scale = resize.percent / 100;
  else if (resize.mode === 'longest') scale = resize.size / Math.max(size.width, size.height);
  else if (resize.mode === 'width') scale = resize.width / size.width;
  else if (resize.mode === 'height') scale = resize.height / size.height;
  else if (resize.mode === 'fit') scale = Math.min(resize.width / size.width, resize.height / size.height);
  if (!(scale > 0) || !Number.isFinite(scale) || (scale > 1 && !upscale)) scale = 1;
  return { width: side(size.width * scale), height: side(size.height * scale) };
}

/**
 * Everything about a result's shape, before a pixel is read.
 *
 * @param {Size} source - The source's size (as decoded: its EXIF orientation already applied).
 * @param {{orientation?: Orientation, crop?: Crop | null, resize?: Resize, upscale?: boolean}} [options] - What's done to it.
 * @returns {OutputPlan} The plan.
 * @example
 * planOutput({ width: 4000, height: 3000 }, { orientation: { turns: 1, flip: false }, resize: { mode: 'longest', size: 1000 } });
 * // { …, scaled: { width: 1000, height: 750 }, width: 750, height: 1000 }
 */
export function planOutput(source, { orientation = UPRIGHT, crop = null, resize = { mode: 'none' }, upscale = false } = {}) {
  const oriented = orientedSize(source, orientation);
  const whole = { x: 0, y: 0, ...oriented };
  const kept = !crop ? whole : 'rect' in crop ? clampRect(crop.rect, oriented) : centredCrop(oriented, crop.ratio);
  const sourceRect = toSourceRect(kept, source, orientation);
  const { width, height } = resizedSize(kept, resize, upscale);
  const scaled = orientation.turns % 2 ? { width: height, height: width } : { width, height };
  return {
    oriented, crop: kept, sourceRect, scaled, width, height,
    resampled: scaled.width !== sourceRect.width || scaled.height !== sourceRect.height,
  };
}
