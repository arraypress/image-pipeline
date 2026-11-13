/**
 * Where a picture's pixels go: turned and flipped, cropped, then resized. The crop is given as
 * the person sees it (after the turn and flip) and mapped back onto the source, so only that
 * part is ever read; the size is worked out before any pixel is touched. Pure.
 *
 * @module geometry
 */
export type Rect = {
    x: number;
    y: number;
    width: number;
    height: number;
};
export type Size = {
    width: number;
    height: number;
};
export type Orientation = {
    /**
     * Quarter turns clockwise.
     */
    turns: 0 | 1 | 2 | 3;
    /**
     * Mirrored left to right before turning.
     */
    flip: boolean;
};
export type Resize = {
    mode: 'none';
} | {
    mode: 'percent';
    percent: number;
} | {
    mode: 'longest';
    size: number;
} | {
    mode: 'width';
    width: number;
} | {
    mode: 'height';
    height: number;
} | {
    mode: 'fit';
    width: number;
    height: number;
} | {
    mode: 'exact';
    width: number;
    height: number;
};
export type Crop = {
    rect: Rect;
} | {
    ratio: number;
};
export type OutputPlan = {
    /**
     * The picture's size once turned.
     */
    oriented: Size;
    /**
     * The part kept, as the person sees it (whole pixels, inside the picture).
     */
    crop: Rect;
    /**
     * That part on the source, before the turn and flip.
     */
    sourceRect: Rect;
    /**
     * The size that part is resampled to, before the turn.
     */
    scaled: Size;
    /**
     * The result's width.
     */
    width: number;
    /**
     * The result's height.
     */
    height: number;
    /**
     * Whether any pixel changes size (false: a copy).
     */
    resampled: boolean;
};
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
export declare const UPRIGHT: Readonly<Orientation>;
/**
 * An orientation after one more action on the picture as it now looks.
 *
 * @param {Orientation} orientation - How it's turned now.
 * @param {'left' | 'right' | 'flip-horizontal' | 'flip-vertical'} action - What's done to it.
 * @returns {Orientation} How it's turned after.
 * @example
 * turned({ turns: 1, flip: false }, 'flip-horizontal'); // { turns: 3, flip: true }
 */
export declare function turned(orientation: Orientation, action: 'left' | 'right' | 'flip-horizontal' | 'flip-vertical'): Orientation;
/**
 * A picture's size once turned.
 *
 * @param {Size} size - Its size.
 * @param {Orientation} orientation - How it's turned.
 * @returns {Size} Its size as the person sees it.
 */
export declare function orientedSize(size: Size, orientation: Orientation): Size;
/**
 * The largest box of a shape that fits in a picture, in its middle.
 *
 * @param {Size} size - The picture.
 * @param {number} ratio - Width over height.
 * @returns {Rect} The box, in whole pixels.
 * @example
 * centredCrop({ width: 400, height: 300 }, 1); // { x: 50, y: 0, width: 300, height: 300 }
 */
export declare function centredCrop(size: Size, ratio: number): Rect;
/**
 * A box made whole pixels and kept inside a picture (at least one pixel).
 *
 * @param {Rect} rect - The box.
 * @param {Size} size - The picture.
 * @returns {Rect} The box, inside it.
 */
export declare function clampRect(rect: Rect, size: Size): Rect;
/**
 * A box on the turned picture, as a box on the source.
 *
 * @param {Rect} rect - The box as the person sees it.
 * @param {Size} source - The source's size.
 * @param {Orientation} orientation - How the picture is turned.
 * @returns {Rect} The same pixels on the source.
 */
export declare function toSourceRect(rect: Rect, source: Size, orientation: Orientation): Rect;
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
export declare function resizedSize(size: Size, resize: Resize, upscale?: boolean): Size;
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
export declare function planOutput(source: Size, { orientation, crop, resize, upscale }?: {
    orientation?: Orientation;
    crop?: Crop | null;
    resize?: Resize;
    upscale?: boolean;
}): OutputPlan;
