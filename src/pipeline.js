/**
 * A picture file in, a picture file out, in Chrome: decoded upright (its EXIF orientation
 * applied), the part kept read in bands and resized properly (`resample.js`), turned, flattened
 * onto a colour for JPEG, encoded at a quality or at the best quality that fits a size, its EXIF
 * put back when asked. Wide-gamut pictures (Display P3, Adobe RGB) are worked on in a Display P3
 * canvas, which Chrome writes out with a Display P3 profile, so they don't come out dull;
 * everything else stays sRGB, number for number. Animations (GIF, WebP, APNG) come out as
 * animated WebP, or as their first frame. Needs `createImageBitmap` and `OffscreenCanvas`: a
 * page or, better, a worker.
 *
 * @module pipeline
 */

import { blobReader } from './bytes.js';
import { planOutput, UPRIGHT } from './geometry.js';
import { CANVAS_MAX_AREA, sizeProblem } from './limits.js';
import { withExif } from './metadata.js';
import { encodeIndexedPng, paletteOf, pngChunks } from './png.js';
import { searchQuality } from './quality.js';
import { createResampler } from './resample.js';
import { rewriteExif } from './exif.js';
import { sniffImage } from './sniff.js';
import { animatedWebp } from './webp.js';

/** @import { Crop, Orientation, OutputPlan, Resize } from './geometry.js' */
/** @import { EncodableType } from './limits.js' */
/** @import { ImageInfo } from './sniff.js' */

/**
 * Why a picture couldn't be processed: `unsupported` (not a picture Chrome reads), `too-large`
 * (more pixels than the limit), `decode` (Chrome couldn't read it), `output-size` (the result
 * would be bigger than a canvas, or than its type allows), `encode` (Chrome couldn't write it).
 *
 * @typedef {'unsupported' | 'too-large' | 'decode' | 'output-size' | 'encode'} ImageFailure
 */

/** Short English messages, by reason. Callers translate by `reason`. */
const MESSAGES = /** @type {const} */ ({
  unsupported: "This isn't an image Chrome can open.",
  'too-large': 'This image has too many pixels to open.',
  decode: "Chrome couldn't read this image.",
  'output-size': 'The result would be larger than Chrome can write.',
  encode: "Chrome couldn't write this image.",
});

/** A picture that couldn't be processed, with why. */
export class ImageError extends Error {
  /**
   * @param {ImageFailure} reason - Why.
   * @param {string} [message] - What to say; a short English default by reason.
   */
  constructor(reason, message = MESSAGES[reason]) {
    super(message);
    this.name = 'ImageError';
    /** @type {ImageFailure} */
    this.reason = reason;
  }
}

/** The most source pixels read at once (px): 4 million, 16 MB of bytes a band. */
const BAND_PIXELS = 4_000_000;

/** The default quality for JPEG and WebP: Chrome's own default for JPEG is 0.92, WebP's 0.8. */
export const DEFAULT_QUALITY = 0.82;

/** The quality at and above which Chrome writes WebP without loss. */
export const LOSSLESS_QUALITY = 1;

/** The most bytes a container adds around EXIF (a WebP made the extended kind: its header and the chunk's). */
const EXIF_OVERHEAD = 30;

/** How many rounds a picture is made smaller to fit a size before giving up. */
const SHRINK_ROUNDS = 8;

/**
 * @typedef {object} ProcessOptions
 * @property {EncodableType} type The type to write.
 * @property {number} [quality] JPEG or WebP quality, 0 to 1 (WebP at 1 is lossless). Default 0.82.
 * @property {number} [maxBytes] A size to fit: the best quality that fits is found (a PNG has none to find).
 * @property {boolean} [shrink] When no quality fits `maxBytes`, make the picture smaller until one does. Default true.
 * @property {Orientation} [orientation] Turn and flip.
 * @property {Crop | null} [crop] The part kept, as seen after the turn.
 * @property {Resize} [resize] The resize.
 * @property {boolean} [upscale] Whether a resize may enlarge. Default false.
 * @property {string} [background] The colour under a JPEG's transparency (any CSS colour). Default white.
 * @property {'remove' | 'keep' | 'keep-location'} [metadata] EXIF: removed (default), kept
 *   without where it was taken, or kept whole. Orientation is always made upright and the
 *   embedded thumbnail always removed.
 * @property {'first' | 'all'} [frames] An animation's frames: all of them (as animated WebP,
 *   when `type` is WebP), or the first only. Default `all`.
 * @property {boolean} [linear] Resize light itself (default) or sRGB's numbers, as a canvas does (false).
 * @property {number} [maxPixels] The most pixels a source may have. Default a canvas's limit, 268 million.
 * @property {ImageInfo} [info] The file's facts, when already read (`sniffImage`).
 * @property {AbortSignal} [signal] Stops the work between bands, frames and encodes.
 */

/**
 * @typedef {object} ProcessResult
 * @property {Blob} blob The result.
 * @property {EncodableType} type Its type.
 * @property {number} width Its width (px).
 * @property {number} height Its height (px).
 * @property {number | null} quality The quality it was written at, in per cent (null for PNG and lossless WebP).
 * @property {boolean} fits Whether it's within `maxBytes` (true when none was asked).
 * @property {boolean} shrunk Whether it was made smaller than asked to fit `maxBytes`.
 * @property {number} frames How many frames it has (1 unless animated).
 * @property {boolean} firstFrameOnly Whether the source was an animation and only its first frame was kept.
 * @property {boolean} indexed Whether it's a PNG with a palette.
 * @property {'srgb' | 'display-p3'} colorSpace The space its colours are in (and tagged as).
 * @property {'none' | 'removed' | 'kept' | 'kept-location' | 'too-long'} exif What became of the
 *   source's EXIF: it had none; removed; kept without location; kept with it; too long for a JPEG to hold, so removed.
 * @property {ImageInfo} source The source's facts.
 * @property {{width: number, height: number}} sourceSize The source's size upright (after its EXIF orientation).
 */

/**
 * @param {OffscreenCanvas} canvas - A canvas.
 * @param {PredefinedColorSpace} colorSpace - Its colour space.
 * @param {boolean} [read] - Whether its pixels will be read back.
 * @returns {OffscreenCanvasRenderingContext2D} Its context, drawing pixel for pixel.
 */
function contextOf(canvas, colorSpace, read = false) {
  const context = canvas.getContext('2d', { colorSpace, willReadFrequently: read });
  if (!context) throw new ImageError('encode');
  context.imageSmoothingEnabled = false;
  return context;
}

/**
 * Let a canvas's pixels go now, not when it's collected.
 *
 * @param {OffscreenCanvas} canvas - The canvas.
 */
function release(canvas) {
  canvas.width = 1;
  canvas.height = 1;
}

/**
 * The part of a source that's kept, resized into a canvas of its own, a band at a time.
 *
 * @param {CanvasImageSource} source - The decoded picture.
 * @param {OutputPlan} plan - Where its pixels go.
 * @param {PredefinedColorSpace} colorSpace - The space to work in.
 * @param {Pick<ProcessOptions, 'linear' | 'signal'>} options - How.
 * @returns {OffscreenCanvas} The part, at its new size, not yet turned.
 */
function resized(source, plan, colorSpace, { linear, signal }) {
  const { sourceRect: from, scaled } = plan;
  const staging = new OffscreenCanvas(scaled.width, scaled.height);
  const into = contextOf(staging, colorSpace);
  const bandRows = Math.max(1, Math.min(from.height, Math.floor(BAND_PIXELS / from.width)));
  const band = new OffscreenCanvas(from.width, bandRows);
  const reader = contextOf(band, colorSpace, true);
  const resize = createResampler({ srcWidth: from.width, srcHeight: from.height, width: scaled.width, height: scaled.height, linear }, (rows, y, count) => {
    into.putImageData(new ImageData(/** @type {Uint8ClampedArray<ArrayBuffer>} */ (rows), scaled.width, count, { colorSpace }), 0, y);
  });
  try {
    for (let y = 0; y < from.height; y += bandRows) {
      signal?.throwIfAborted();
      const rows = Math.min(bandRows, from.height - y);
      reader.clearRect(0, 0, from.width, bandRows);
      reader.drawImage(source, from.x, from.y + y, from.width, rows, 0, 0, from.width, rows);
      resize.write(reader.getImageData(0, 0, from.width, rows).data, rows);
    }
  } finally {
    release(band);
  }
  return staging;
}

/**
 * The result's pixels: the kept part at its new size, flipped and turned, over the background
 * colour when there is one.
 *
 * @param {CanvasImageSource} source - The decoded picture.
 * @param {OutputPlan} plan - Where its pixels go.
 * @param {PredefinedColorSpace} colorSpace - The space to work in.
 * @param {Pick<ProcessOptions, 'orientation' | 'linear' | 'signal'> & {fill: string | null}} options - How; `fill` the colour under transparency.
 * @returns {OffscreenCanvas} The result, drawn.
 */
function render(source, plan, colorSpace, { orientation = UPRIGHT, fill, linear, signal }) {
  const { sourceRect: from, scaled } = plan;
  const canvas = new OffscreenCanvas(plan.width, plan.height);
  const context = contextOf(canvas, colorSpace, true);
  if (fill) {
    context.fillStyle = fill;
    context.fillRect(0, 0, plan.width, plan.height);
  }
  // Canvas transforms apply last-named first: the mirror, then the turn.
  if (orientation.turns === 1) context.transform(0, 1, -1, 0, scaled.height, 0);
  else if (orientation.turns === 2) context.transform(-1, 0, 0, -1, scaled.width, scaled.height);
  else if (orientation.turns === 3) context.transform(0, -1, 1, 0, 0, scaled.width);
  if (orientation.flip) context.transform(-1, 0, 0, 1, scaled.width, 0);
  if (plan.resampled) {
    const staging = resized(source, plan, colorSpace, { linear, signal });
    context.drawImage(staging, 0, 0);
    release(staging);
  } else context.drawImage(source, from.x, from.y, from.width, from.height, 0, 0, from.width, from.height);
  context.resetTransform();
  return canvas;
}

/**
 * A canvas as a file of a type.
 *
 * @param {OffscreenCanvas} canvas - The canvas.
 * @param {EncodableType} type - The type.
 * @param {number} [quality] - JPEG or WebP quality, 0 to 1.
 * @returns {Promise<Blob>} The file.
 * @throws {ImageError} `encode`, when Chrome writes nothing or another type (it falls back to PNG without a word).
 * @example
 * const webp = await encodeCanvas(canvas, 'image/webp', 0.8);
 */
export async function encodeCanvas(canvas, type, quality) {
  const blob = await canvas.convertToBlob({ type, quality }).catch(() => null);
  if (!blob || blob.type !== type || !blob.size) throw new ImageError('encode');
  return blob;
}

/**
 * A canvas as a PNG: with a palette when it has few enough colours and that's smaller, else as
 * Chrome writes it.
 *
 * @param {OffscreenCanvas} canvas - The canvas.
 * @param {PredefinedColorSpace} colorSpace - Its colour space.
 * @returns {Promise<{blob: Blob, indexed: boolean}>} The PNG, and which kind.
 */
async function encodePng(canvas, colorSpace) {
  const blob = await encodeCanvas(canvas, 'image/png');
  const context = contextOf(canvas, colorSpace, true);
  const bandRows = Math.max(1, Math.floor(BAND_PIXELS / canvas.width));
  /** @type {Map<number, number> | null} */
  let colours = new Map();
  for (let y = 0; colours && y < canvas.height; y += bandRows) {
    colours = paletteOf(context.getImageData(0, y, canvas.width, Math.min(bandRows, canvas.height - y)).data, colours);
  }
  if (!colours) return { blob, indexed: false };
  // Chrome's own PNG carries the canvas's colour profile when it has one: the palette's numbers mean the same with it.
  const profile = colorSpace === 'srgb' ? [] : pngChunks(new Uint8Array(await blob.arrayBuffer()), ['iCCP']);
  const indexed = await encodeIndexedPng(context.getImageData(0, 0, canvas.width, canvas.height), colours, profile);
  return indexed.length < blob.size ? { blob: new Blob([indexed], { type: 'image/png' }), indexed: true } : { blob, indexed: false };
}

/**
 * A canvas encoded as the options ask: at a quality, or at the best that fits a size.
 *
 * @param {OffscreenCanvas} canvas - The canvas.
 * @param {PredefinedColorSpace} colorSpace - Its colour space.
 * @param {Pick<ProcessOptions, 'type' | 'quality' | 'maxBytes' | 'signal'>} options - How.
 * @returns {Promise<{blob: Blob, quality: number | null, fits: boolean, indexed: boolean}>} The file and how it came out.
 */
async function encode(canvas, colorSpace, { type, quality = DEFAULT_QUALITY, maxBytes, signal }) {
  if (type === 'image/png') {
    const png = await encodePng(canvas, colorSpace);
    return { ...png, quality: null, fits: !maxBytes || png.blob.size <= maxBytes };
  }
  if (!maxBytes) {
    const blob = await encodeCanvas(canvas, type, quality);
    return { blob, quality: type === 'image/webp' && quality >= LOSSLESS_QUALITY ? null : Math.round(quality * 100), fits: true, indexed: false };
  }
  const found = await searchQuality((level) => {
    signal?.throwIfAborted();
    return encodeCanvas(canvas, type, level);
  }, maxBytes);
  return { blob: found.blob, quality: found.quality, fits: found.fits, indexed: false };
}

/**
 * A plan made smaller by a factor.
 *
 * @param {OutputPlan} plan - The plan.
 * @param {number} factor - How much smaller (under 1).
 * @param {boolean} sideways - Whether the result is a quarter turn from the source.
 * @returns {OutputPlan} The plan at that size.
 */
function shrunkPlan(plan, factor, sideways) {
  const width = Math.max(1, Math.round(plan.width * factor));
  const height = Math.max(1, Math.round(plan.height * factor));
  return { ...plan, width, height, scaled: sideways ? { width: height, height: width } : { width, height }, resampled: true };
}

/**
 * An animation's frames, one at a time.
 *
 * @param {Blob} blob - The file.
 * @param {string} type - Its type.
 * @param {AbortSignal} [signal] - Stops between frames.
 * @returns {AsyncGenerator<{image: VideoFrame, duration: number, loops: number}>} Each frame whole
 *   (drawn over those before it, as it shows), how long it shows (ms), and how many times the
 *   animation plays (0: for ever).
 */
async function* framesOf(blob, type, signal) {
  const decoder = new ImageDecoder({ data: blob.stream(), type, preferAnimation: true });
  try {
    await decoder.completed;
    const track = decoder.tracks.selectedTrack;
    if (!track) throw new ImageError('decode');
    const loops = Number.isFinite(track.repetitionCount) ? track.repetitionCount : 0;
    for (let frameIndex = 0; frameIndex < track.frameCount; frameIndex++) {
      signal?.throwIfAborted();
      const { image } = await decoder.decode({ frameIndex });
      try {
        yield { image, duration: (image.duration ?? 0) / 1000, loops };
      } finally {
        image.close();
      }
    }
  } finally {
    decoder.close();
  }
}

/**
 * Process a picture file.
 *
 * @param {Blob} file - The picture (PNG, JPEG, WebP, GIF, AVIF or BMP).
 * @param {ProcessOptions} options - What to do with it.
 * @returns {Promise<ProcessResult>} The result and how it came out.
 * @throws {ImageError} With `reason`, when it can't be done; the signal's own error when stopped.
 * @example
 * const { blob, width, height, quality } = await processImage(file, {
 *   type: 'image/webp', resize: { mode: 'longest', size: 1600 }, maxBytes: 200_000,
 * });
 */
export async function processImage(file, options) {
  const { type, metadata = 'remove', frames = 'all', shrink = true, maxPixels = CANVAS_MAX_AREA, signal } = options;
  const info = options.info ?? await sniffImage(blobReader(file));
  if (!info) throw new ImageError('unsupported');
  if (info.width * info.height > maxPixels) throw new ImageError('too-large');
  const colorSpace = info.wideGamut ? 'display-p3' : 'srgb';
  const fill = type === 'image/jpeg' ? options.background ?? '#ffffff' : null;
  const animate = info.animated && frames === 'all' && type === 'image/webp' && typeof ImageDecoder === 'function';
  // EXIF that's kept is added after encoding: its bytes come out of the size to fit first.
  const keep = info.exif && metadata !== 'remove' && !animate ? rewriteExif(info.exif, { location: metadata === 'keep-location' }) : null;
  const budget = options.maxBytes ? Math.max(1, options.maxBytes - (keep ? keep.length + EXIF_OVERHEAD : 0)) : 0;

  /** @param {{width: number, height: number}} size */
  const planFor = (size) => {
    const plan = planOutput(size, options);
    if (sizeProblem(plan.width, plan.height, type)) throw new ImageError('output-size');
    return plan;
  };
  /** @type {Omit<ProcessResult, 'exif' | 'source' | 'colorSpace' | 'firstFrameOnly' | 'sourceSize'>} */
  let made;
  /** @type {{width: number, height: number}} */
  let sourceSize;

  if (animate) {
    /** @type {{webp: Uint8Array, duration: number}[]} */
    const stills = [];
    let plan = null;
    let loops = 0;
    sourceSize = { width: info.width, height: info.height };
    for await (const frame of framesOf(file, info.type, signal)) {
      sourceSize = { width: frame.image.displayWidth, height: frame.image.displayHeight };
      plan ??= planFor(sourceSize);
      loops = frame.loops;
      const canvas = render(frame.image, plan, colorSpace, { ...options, fill });
      const still = await encodeCanvas(canvas, type, options.quality ?? DEFAULT_QUALITY);
      release(canvas);
      stills.push({ webp: new Uint8Array(await still.arrayBuffer()), duration: frame.duration });
    }
    if (!plan) throw new ImageError('decode');
    const quality = options.quality ?? DEFAULT_QUALITY;
    made = {
      blob: new Blob(animatedWebp(stills, { width: plan.width, height: plan.height, loops }), { type }), type, width: plan.width, height: plan.height,
      quality: quality >= LOSSLESS_QUALITY ? null : Math.round(quality * 100), fits: !options.maxBytes, shrunk: false, frames: stills.length, indexed: false,
    };
    if (options.maxBytes) made.fits = made.blob.size <= options.maxBytes;
  } else {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() => null);
    if (!bitmap) throw new ImageError('decode');
    try {
      sourceSize = { width: bitmap.width, height: bitmap.height };
      let plan = planFor(sourceSize);
      let canvas = render(bitmap, plan, colorSpace, { ...options, fill });
      let encoded = await encode(canvas, colorSpace, { ...options, maxBytes: budget });
      let shrunk = false;
      for (let round = 0; !encoded.fits && shrink && budget && round < SHRINK_ROUNDS && Math.min(plan.width, plan.height) > 1; round++) {
        signal?.throwIfAborted();
        // A file's size goes roughly with its pixels: aim a little under, so one round usually does.
        plan = shrunkPlan(plan, Math.min(0.9, Math.max(0.3, Math.sqrt(budget / encoded.blob.size) * 0.95)), (options.orientation?.turns ?? 0) % 2 === 1);
        release(canvas);
        canvas = render(bitmap, plan, colorSpace, { ...options, fill });
        encoded = await encode(canvas, colorSpace, { ...options, maxBytes: budget });
        shrunk = true;
      }
      release(canvas);
      made = { ...encoded, type, width: plan.width, height: plan.height, shrunk, frames: 1 };
    } finally {
      bitmap.close();
    }
  }

  /** @type {ProcessResult['exif']} */
  let exif = info.exif ? 'removed' : 'none';
  if (info.exif && keep) {
    const block = /** @type {Uint8Array} */ (rewriteExif(info.exif, { location: metadata === 'keep-location', width: made.width, height: made.height }));
    const bytes = withExif(new Uint8Array(await made.blob.arrayBuffer()), type, block, { width: made.width, height: made.height, alpha: info.alpha && type !== 'image/jpeg' });
    if (bytes) {
      made.blob = new Blob([/** @type {BlobPart} */ (bytes)], { type });
      exif = metadata === 'keep-location' ? 'kept-location' : 'kept';
    } else exif = 'too-long';
  }
  return { ...made, exif, source: info, sourceSize, colorSpace, firstFrameOnly: info.animated && made.frames === 1 };
}

/**
 * A picture as a PNG or a JPG, nothing else changed: for saving a WebP or AVIF as something
 * older software opens. A JPG has no transparency, so transparent pixels go white.
 *
 * @param {Blob} image - The picture (any format Chrome decodes).
 * @param {'png' | 'jpg'} to - The format wanted.
 * @param {number} [quality] - A JPG's quality, 0 to 1. Default 0.92, close to what cameras write.
 * @returns {Promise<Blob>} The picture in that format.
 * @example
 * const png = await convertImage(new Blob([bytes], { type: 'image/webp' }), 'png');
 */
export async function convertImage(image, to, quality = 0.92) {
  return (await processImage(image, { type: to === 'jpg' ? 'image/jpeg' : 'image/png', quality, frames: 'first' })).blob;
}
