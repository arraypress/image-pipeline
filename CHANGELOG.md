# Changelog

All notable changes to `@arraypress/image-pipeline` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] — unreleased

First version, written for Better Images (a Chrome extension) and to give the family's other
extensions one copy of what each had its own of: Better Saves' `convertImage` (WebP and AVIF to
PNG or JPG) is `convertImage` here with the same arguments, and Better Screenshots' canvas and
format limits (`CANVAS_MAX_SIDE`, `CANVAS_MAX_AREA`, `FORMAT_MAX_SIDE`) are `limits.js`
(`TYPE_MAX_SIDE`, keyed by MIME type).

### Added

- `processImage`, `convertImage`, `encodeCanvas`, `ImageError`: the pipeline.
- `createResampler`, `resamplePixels`, `axisWeights`: Lanczos-3 in linear light, in bands.
- `planOutput`, `resizedSize`, `centredCrop`, `clampRect`, `toSourceRect`, `orientedSize`, `turned`, `UPRIGHT`: geometry.
- `sniffImage`, `isSrgbProfile`, `blobReader`, `bytesReader`: a file's facts from its headers.
- `readExif`, `rewriteExif`, `withExif`, `JPEG_MAX_EXIF`: EXIF read, rewritten and put back.
- `searchQuality`: the best quality for a file size.
- `paletteOf`, `encodeIndexedPng`, `pngChunk`, `pngChunks`, `MAX_PALETTE`: palette PNGs.
- `animatedWebp`: an animated WebP from still ones.
- `CANVAS_MAX_SIDE`, `CANVAS_MAX_AREA`, `ENCODABLE_TYPES`, `TYPE_MAX_SIDE`, `sizeProblem`: Chrome's limits.
- `@arraypress/image-pipeline/testing`: `buildExif`, `buildPng`, `buildApng`, `buildGif`, `checkerboard`, `zonePlate`.
