# @arraypress/image-pipeline

> Images in the browser, done properly: a picture file in, a picture file out, with the things
> tools get wrong got right. Zero dependencies.

Chrome can decode a picture, draw it on a canvas and write it back out, and most tools stop
there. That leaves photos resized with moiré and gone dark, sideways phone pictures, Display P3
colours turned dull, a camera's location sent along (or its thumbnail, showing what was cropped
away), 8-bit PNGs four times their size, animations reduced to a frame, and a tab that dies on a
big picture. This library is the rest.

- **`processImage(file, options)`**: decode upright → crop → resize → turn → flatten → encode →
  put EXIF back, in a page or a worker.
- **A proper resize**: Lanczos-3 as wide as the reduction, on light itself (linear), colour
  weighted by opacity, a band of rows at a time (`createResampler`).
- **A size to fit**: the best quality that fits a number of bytes (`searchQuality`).
- **EXIF**: read (`readExif`), rewritten upright without its thumbnail and, unless asked, its
  location (`rewriteExif`), and put into a JPEG, PNG or WebP (`withExif`).
- **What a file is, from its headers** (`sniffImage`): type from its bytes, size, animation,
  transparency, palette, EXIF, colour profile, wide gamut. Before a pixel is decoded.
- **Palette PNGs** (`encodeIndexedPng`) and **animated WebP** (`animatedWebp`), which Chrome
  doesn't write.
- **Chrome's limits** as data (`limits.js`), measured again by the tests.

## Install

```bash
npm install @arraypress/image-pipeline
```

## Usage

```js
import { processImage, ImageError } from '@arraypress/image-pipeline';

const { blob, width, height, quality, fits } = await processImage(file, {
  type: 'image/webp',
  resize: { mode: 'longest', size: 1600 },
  maxBytes: 200_000,        // the best quality that fits; made smaller if none does
  metadata: 'keep',         // camera and date kept, location and thumbnail removed
});
```

Best in a worker (`OffscreenCanvas`), so the page never waits:

```js
// worker.js
import { processImage } from '@arraypress/image-pipeline';
onmessage = async ({ data }) => postMessage(await processImage(data.file, data.options));
```

### `processImage(file, options)` → `Promise<ProcessResult>`

| Option | |
|---|---|
| `type` | `'image/png'`, `'image/jpeg'` or `'image/webp'`: what Chrome encodes (`ENCODABLE_TYPES`). |
| `quality` | 0 to 1, default 0.82. WebP at 1 is lossless. |
| `maxBytes`, `shrink` | A size to fit. The highest quality (20 to 95) that fits is found; when none does and `shrink` isn't false, the picture is made smaller until one does. A PNG can only shrink. |
| `orientation` | `{ turns: 0–3, flip }`: mirrored, then quarter turns clockwise (`turned()` composes actions). |
| `crop` | `{ rect }` as seen after the turn, or `{ ratio }` from the middle. |
| `resize`, `upscale` | `none`, `percent`, `longest`, `width`, `height`, `fit`, `exact`; never larger unless `upscale`. |
| `background` | The colour under a JPEG's transparency. Default white. |
| `metadata` | `'remove'` (default), `'keep'` (without location) or `'keep-location'`. Always upright, never the thumbnail. |
| `frames` | `'all'` (default): an animation becomes animated WebP when `type` is WebP. `'first'`: its first frame. |
| `linear` | `false` resizes sRGB's numbers, as a canvas does. Default: light itself. |
| `maxPixels`, `info`, `signal` | A limit on the source, its facts when already sniffed, and a stop. |

The result says what happened: `blob`, `type`, `width`, `height`, `quality` (per cent, or null),
`fits`, `shrunk`, `frames`, `firstFrameOnly`, `indexed`, `colorSpace`, `exif` (`'none'`,
`'removed'`, `'kept'`, `'kept-location'`, `'too-long'`), `source`, `sourceSize`. Failures throw
`ImageError` with a `reason`: `unsupported`, `too-large`, `decode`, `output-size`, `encode`.

`convertImage(blob, 'png' | 'jpg')` is the one-line case (a WebP as something older software opens).

## What Chrome does, measured (Chromium 156; `tests/chromium.test.js` measures it again)

- **It encodes PNG, JPEG and WebP, and nothing else.** Asked for AVIF, GIF, JPEG XL or BMP,
  `convertToBlob` writes a PNG without a word; there is no `ImageEncoder`. `encodeCanvas` throws
  instead. (AVIF could be written from WebCodecs' AV1 encoder and a hand-made container; not here yet.)
- **A canvas holds 65,535 px a side and 268,435,456 px in all**; one more and it draws nothing,
  silently. A WebP stops at 16,383 px a side and is cut there, silently. `sizeProblem` says so first.
- **Its high-quality downscale leaves moiré.** A zone plate made 6.4 times smaller comes out
  with 8.6 levels of false pattern from `drawImage` at `imageSmoothingQuality: 'high'` (the same
  from `createImageBitmap`'s `resizeQuality: 'high'`, and from halving in steps) and keeps 69% of
  the detail it should; this library's resize leaves 0.7 levels and keeps 80%. At 2.5 times: 19.0
  against 1.6 levels.
- **It averages sRGB's numbers, not light**: a black-and-white checkerboard shrinks to 127 where
  the eye sees 188. So shrunk photos lose their highlights. Here the average is of light (`linear`).
- **EXIF orientation is applied to JPEG and PNG, and ignored for WebP** (`createImageBitmap`
  with `imageOrientation: 'from-image'`). Results are upright in their pixels, and any EXIF kept
  says so.
- **Colour**: a picture with a wide-gamut profile is converted to sRGB by a default canvas and
  clipped (Display P3's red comes back as 234, 51, 35 in P3). A canvas made with
  `colorSpace: 'display-p3'` keeps it, and Chrome writes a Display P3 profile into the PNG, JPEG
  or WebP it encodes from one. So wide-gamut sources (`sniffImage().wideGamut`) are worked on in
  Display P3 and everything else stays sRGB, number for number. Colours outside Display P3 (some
  Adobe RGB greens, ProPhoto) are clipped to it. JPEG and WebP from an sRGB canvas carry a 456-byte
  sRGB profile; a PNG carries none.
- **Encoders write no metadata**: no EXIF, so nothing of the camera or the place unless `withExif`
  puts it back.
- **`ImageDecoder` gives an animation's frames whole** (GIF, WebP, APNG), with their durations;
  nothing writes an animation, so `animatedWebp` puts Chrome's own still WebPs into the container.
  Each frame is whole and unblended: correct, and larger than an optimiser would make.

## The pieces

```js
import {
  sniffImage, blobReader, readExif, rewriteExif, withExif,          // what a file is, and its EXIF
  planOutput, resizedSize, centredCrop, toSourceRect, turned,       // where pixels go
  createResampler, resamplePixels,                                  // the resize
  searchQuality, encodeCanvas, sizeProblem, ENCODABLE_TYPES,        // encoding
  paletteOf, encodeIndexedPng, animatedWebp,                        // what Chrome doesn't write
} from '@arraypress/image-pipeline';

const info = await sniffImage(blobReader(file));      // { type, width, height, animated, alpha, palette, exif, icc, wideGamut }
readExif(info.exif);                                  // { orientation, make, model, taken, location, hasLocation, hasThumbnail, … }
const small = resamplePixels(imageData, 1600, 1200);  // pure: typed arrays in and out, runs in Node too
```

`rewriteExif` changes the block in place rather than writing a new one: orientation set to 1, the
thumbnail's directory and bytes blanked and cut off, the GPS directory's every byte blanked and
its pointer taken out, the pixel size corrected. Everything else stays where it was, so a camera's
maker note still reads. XMP and IPTC aren't carried.

`@arraypress/image-pipeline/testing` builds picture files byte by byte for tests: `buildExif`,
`buildPng`, `buildApng`, `buildGif`, `checkerboard`, `zonePlate`.

## Development

`npm test` runs ESLint, a strict TypeScript check of the JSDoc, the tests (the pure parts in Node;
the pipeline in Playwright's Chromium, every result read back pixel by pixel) and the copied-code
guard. The `.d.ts` files are generated from the JSDoc: `npm run types`.

## License

MIT © 2026 David Sherlock / ArrayPress Limited
