/**
 * @arraypress/image-pipeline
 *
 * Images in the browser, done properly. See the README.
 *
 * @module @arraypress/image-pipeline
 */
export { blobReader, bytesReader } from './bytes.js';
export { readExif, rewriteExif } from './exif.js';
export { UPRIGHT, centredCrop, clampRect, orientedSize, planOutput, resizedSize, toSourceRect, turned } from './geometry.js';
export { CANVAS_MAX_AREA, CANVAS_MAX_SIDE, ENCODABLE_TYPES, TYPE_MAX_SIDE, sizeProblem } from './limits.js';
export { JPEG_MAX_EXIF, withExif } from './metadata.js';
export { DEFAULT_QUALITY, ImageError, LOSSLESS_QUALITY, convertImage, encodeCanvas, processImage } from './pipeline.js';
export { MAX_PALETTE, encodeIndexedPng, paletteOf, pngChunk, pngChunks } from './png.js';
export { searchQuality } from './quality.js';
export { axisWeights, createResampler, resamplePixels } from './resample.js';
export { isSrgbProfile, sniffImage } from './sniff.js';
export { animatedWebp } from './webp.js';
export type ByteReader = import('./bytes.js').ByteReader;
export type ExifSummary = import('./exif.js').ExifSummary;
export type Crop = import('./geometry.js').Crop;
export type Orientation = import('./geometry.js').Orientation;
export type OutputPlan = import('./geometry.js').OutputPlan;
export type Rect = import('./geometry.js').Rect;
export type Resize = import('./geometry.js').Resize;
export type Size = import('./geometry.js').Size;
export type EncodableType = import('./limits.js').EncodableType;
export type ImageFailure = import('./pipeline.js').ImageFailure;
export type ProcessOptions = import('./pipeline.js').ProcessOptions;
export type ProcessResult = import('./pipeline.js').ProcessResult;
export type QualityResult = import('./quality.js').QualityResult;
export type ResampleOptions = import('./resample.js').ResampleOptions;
export type ImageInfo = import('./sniff.js').ImageInfo;
export type SniffedType = import('./sniff.js').SniffedType;
/**
 * @typedef {import('./bytes.js').ByteReader} ByteReader
 * @typedef {import('./exif.js').ExifSummary} ExifSummary
 * @typedef {import('./geometry.js').Crop} Crop
 * @typedef {import('./geometry.js').Orientation} Orientation
 * @typedef {import('./geometry.js').OutputPlan} OutputPlan
 * @typedef {import('./geometry.js').Rect} Rect
 * @typedef {import('./geometry.js').Resize} Resize
 * @typedef {import('./geometry.js').Size} Size
 * @typedef {import('./limits.js').EncodableType} EncodableType
 * @typedef {import('./pipeline.js').ImageFailure} ImageFailure
 * @typedef {import('./pipeline.js').ProcessOptions} ProcessOptions
 * @typedef {import('./pipeline.js').ProcessResult} ProcessResult
 * @typedef {import('./quality.js').QualityResult} QualityResult
 * @typedef {import('./resample.js').ResampleOptions} ResampleOptions
 * @typedef {import('./sniff.js').ImageInfo} ImageInfo
 * @typedef {import('./sniff.js').SniffedType} SniffedType
 */
