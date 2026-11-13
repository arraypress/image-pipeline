/**
 * The pipeline in Playwright's Chromium: what Chrome's canvas really does (limits, the types it
 * writes, colour), and every result read back and compared pixel by pixel.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { startBrowser } from './browser.js';

/** @type {Awaited<ReturnType<typeof startBrowser>>} */
let browser;
before(async () => {
  browser = await startBrowser();
  await browser.page.evaluate("import('/tests/page.js').then((page) => { globalThis.T = page; })");
});
after(() => browser?.close());

/**
 * Run a function in the page, with the page module as `T`.
 *
 * @template R, A
 * @param {(T: typeof import('./page.js'), arg: A) => Promise<R>} run
 * @param {A} [arg]
 * @returns {Promise<R>}
 */
function inPage(run, arg) {
  return browser.page.evaluate(`(${run.toString()})(globalThis.T, ${JSON.stringify(arg ?? null)})`);
}

test('Chrome\'s limits and encoders are what limits.js says', async () => {
  const measured = await inPage(async ({ lib }) => {
    /** @param {number} width @param {number} height */
    const draws = (width, height) => {
      const canvas = new OffscreenCanvas(width, height);
      const context = canvas.getContext('2d');
      if (!context) return false;
      context.fillRect(0, 0, 1, 1);
      const drew = context.getImageData(0, 0, 1, 1).data[3] === 255;
      canvas.width = 1;
      return drew;
    };
    const canvas = new OffscreenCanvas(8, 8);
    canvas.getContext('2d');
    /** @type {Record<string, string>} */
    const written = {};
    for (const type of [...lib.ENCODABLE_TYPES, 'image/avif', 'image/gif', 'image/jxl', 'image/bmp']) written[type] = (await canvas.convertToBlob({ type })).type;
    const tall = new OffscreenCanvas(1, 16_390);
    tall.getContext('2d');
    const webp = await createImageBitmap(await tall.convertToBlob({ type: 'image/webp' }));
    return {
      side: [draws(lib.CANVAS_MAX_SIDE, 1), draws(lib.CANVAS_MAX_SIDE + 1, 1)],
      area: [draws(16_384, 16_384), draws(16_385, 16_384)],
      written, encoder: typeof Reflect.get(globalThis, 'ImageEncoder'), webpHeight: webp.height,
    };
  });
  assert.deepEqual(measured.side, [true, false]);
  assert.deepEqual(measured.area, [true, false]);
  assert.deepEqual(measured.written, {
    'image/png': 'image/png', 'image/jpeg': 'image/jpeg', 'image/webp': 'image/webp',
    'image/avif': 'image/png', 'image/gif': 'image/png', 'image/jxl': 'image/png', 'image/bmp': 'image/png',
  });
  assert.equal(measured.encoder, 'undefined');
  assert.equal(measured.webpHeight, 16_383, 'Chrome cuts a WebP at its format\'s limit without a word');
});

test('resize: a checkerboard comes out one grey; fine rings come out flat where Chrome\'s own high quality leaves moiré', async () => {
  const measured = await inPage(async ({ lib, fixtures, pixelsOf, unevenness }) => {
    const board = new Blob([await fixtures.buildPng(fixtures.checkerboard(512, 512), 512, 512)], { type: 'image/png' });
    const small = await pixelsOf((await lib.processImage(board, { type: 'image/png', resize: { mode: 'width', width: 75 } })).blob);
    const size = 1600;
    const to = 250;
    const plate = new Blob([await fixtures.buildPng(fixtures.zonePlate(size), size, size)], { type: 'image/png' });
    const ours = await pixelsOf((await lib.processImage(plate, { type: 'image/png', resize: { mode: 'width', width: to }, linear: false })).blob);
    const canvas = new OffscreenCanvas(to, to);
    const context = /** @type {OffscreenCanvasRenderingContext2D} */ (canvas.getContext('2d'));
    context.imageSmoothingQuality = 'high';
    context.drawImage(await createImageBitmap(plate), 0, 0, to, to);
    const from = (1.5 * size) / (2 * (size / to) ** 2);
    return {
      board: [small.width, small.height, Math.min(...small.data.filter((_, i) => i % 4 === 0)), Math.max(...small.data.filter((_, i) => i % 4 === 0))],
      ours: unevenness(ours.data, to, from), chrome: unevenness(context.getImageData(0, 0, to, to).data, to, from),
    };
  });
  assert.deepEqual(measured.board.slice(0, 2), [75, 75]);
  assert.ok(measured.board[2] >= 187 && measured.board[3] <= 188, `the board's greys: ${measured.board[2]}–${measured.board[3]}`);
  assert.ok(measured.ours < 1.5, `ours: ${measured.ours.toFixed(2)} levels`);
  assert.ok(measured.chrome > 5 * measured.ours, `Chrome's high quality: ${measured.chrome.toFixed(2)} levels against ours ${measured.ours.toFixed(2)}`);
});

test('a camera\'s EXIF orientation is applied, all eight of them, for JPEG and PNG; a WebP\'s is ignored, as Chrome ignores it', async () => {
  const seen = await inPage(async ({ lib, fixtures, pixelsOf, encoded, quadrants, corners }) => {
    /** @type {Record<string, string>} */
    const out = {};
    const pixels = quadrants(16);
    const picture = { width: 32, height: 32, alpha: false };
    for (let orientation = 1; orientation <= 8; orientation++) {
      const exif = fixtures.buildExif({ orientation });
      const jpeg = /** @type {Uint8Array<ArrayBuffer>} */ (lib.withExif(await encoded(pixels, 32, 32, 'image/jpeg'), 'image/jpeg', exif, picture));
      const png = await fixtures.buildPng(pixels, 32, 32, [lib.pngChunk('eXIf', exif)]);
      for (const [name, file] of /** @type {const} */ ([['jpeg', jpeg], ['png', png]])) {
        const result = await lib.processImage(new Blob([file]), { type: 'image/png', metadata: 'keep' });
        out[`${name}${orientation}`] = corners(await pixelsOf(result.blob));
      }
    }
    const webp = /** @type {Uint8Array<ArrayBuffer>} */ (lib.withExif(await encoded(pixels, 32, 32, 'image/webp'), 'image/webp', fixtures.buildExif({ orientation: 6 }), picture));
    out.webp6 = corners(await pixelsOf((await lib.processImage(new Blob([webp]), { type: 'image/png' })).blob));
    return out;
  });
  // Top left, top right, bottom left, bottom right of red, green / blue, white, as each orientation shows it.
  const upright = ['rgbw', 'grwb', 'wbgr', 'bwrg', 'rbgw', 'brwg', 'wgbr', 'gwrb'];
  upright.forEach((expected, index) => {
    assert.equal(seen[`jpeg${index + 1}`], expected, `JPEG orientation ${index + 1}`);
    assert.equal(seen[`png${index + 1}`], expected, `PNG orientation ${index + 1}`);
  });
  assert.equal(seen.webp6, 'rgbw');
});

test('turn, flip and crop: every pixel lands where the plan says, exactly, for all eight ways up', async () => {
  const cases = await inPage(async ({ lib, fixtures, pixelsOf }) => {
    const [W, H] = [5, 3];
    const data = new Uint8ClampedArray(W * H * 4);
    for (let i = 0; i < W * H; i++) data.set([i * 10, 255 - i * 10, i, 255], i * 4);
    const file = new Blob([await fixtures.buildPng(data, W, H)], { type: 'image/png' });
    const out = [];
    for (const turns of /** @type {const} */ ([0, 1, 2, 3])) {
      for (const flip of [false, true]) {
        const whole = await pixelsOf((await lib.processImage(file, { type: 'image/png', orientation: { turns, flip } })).blob);
        const part = await pixelsOf((await lib.processImage(file, { type: 'image/png', orientation: { turns, flip }, crop: { rect: { x: 1, y: 1, width: 2, height: 2 } } })).blob);
        out.push({ turns, flip, whole: { ...whole, data: whole.data.filter((_, i) => i % 4 === 2) }, part: part.data.filter((_, i) => i % 4 === 2) });
      }
    }
    return out;
  });
  const source = Array.from({ length: 3 }, (_, y) => Array.from({ length: 5 }, (_, x) => y * 5 + x));
  for (const { turns, flip, whole, part } of cases) {
    let rows = flip ? source.map((row) => [...row].reverse()) : source;
    for (let i = 0; i < turns; i++) rows = rows[0].map((_, x) => rows.map((row) => row[x]).reverse());
    assert.deepEqual([whole.width, whole.height], [rows[0].length, rows.length]);
    assert.deepEqual(whole.data, rows.flat(), `turns ${turns} flip ${flip}`);
    assert.deepEqual(part, rows.slice(1, 3).flatMap((row) => row.slice(1, 3)), `crop, turns ${turns} flip ${flip}`);
  }
});

test('transparency is kept in PNG and WebP, and a JPEG is flattened onto the colour chosen', async () => {
  const read = await inPage(async ({ lib, fixtures, pixelsOf }) => {
    // Opaque red, half-clear red, clear.
    const data = new Uint8ClampedArray([255, 0, 0, 255, 255, 0, 0, 128, 0, 0, 0, 0, 0, 0, 0, 0]);
    const file = new Blob([await fixtures.buildPng(data, 4, 1)], { type: 'image/png' });
    /** @param {import('../src/index.js').ProcessOptions} options */
    const through = async (options) => (await pixelsOf((await lib.processImage(file, options)).blob)).data;
    return {
      png: await through({ type: 'image/png' }), webp: await through({ type: 'image/webp', quality: 1 }),
      white: await through({ type: 'image/jpeg', quality: 1 }), blue: await through({ type: 'image/jpeg', quality: 1, background: '#336699' }),
    };
  });
  const source = [255, 0, 0, 255, 255, 0, 0, 128, 0, 0, 0, 0, 0, 0, 0, 0];
  assert.deepEqual(read.png, source);
  assert.deepEqual(read.webp, source, 'WebP at quality 1 is lossless');
  /** @param {number[]} data @param {number} pixel @param {number[]} colour */
  const near = (data, pixel, colour) => colour.every((value, channel) => Math.abs(data[pixel * 4 + channel] - value) <= 6);
  assert.ok(near(read.white, 3, [255, 255, 255, 255]), `white under clear: ${read.white.slice(12)}`);
  assert.ok(near(read.blue, 3, [51, 102, 153, 255]), `the colour under clear: ${read.blue.slice(12)}`);
  assert.ok(near(read.blue, 0, [255, 0, 0, 255]), `opaque red stays: ${read.blue.slice(0, 4)}`);
});

test('a Display P3 picture keeps its colours and its profile in every format, where an sRGB canvas would dull them', async () => {
  const read = await inPage(async ({ lib, fixtures, pixelsOf }) => {
    // Display P3's own pure red, and an orange, tagged with cICP (primaries 12: P3 D65).
    const data = new Uint8ClampedArray([255, 0, 0, 255, 200, 100, 50, 255]);
    const bytes = await fixtures.buildPng(data, 2, 1, [lib.pngChunk('cICP', Uint8Array.of(12, 13, 0, 1))]);
    const file = new Blob([bytes], { type: 'image/png' });
    /** @type {Record<string, unknown>} */
    const out = {};
    for (const type of lib.ENCODABLE_TYPES) {
      const result = await lib.processImage(file, { type, quality: 1 });
      const info = await lib.sniffImage(lib.blobReader(result.blob));
      out[type] = { space: result.colorSpace, tagged: info?.wideGamut, p3: (await pixelsOf(result.blob, 'display-p3')).data };
    }
    // What a tool that draws on a plain canvas writes, read the same way.
    const plain = new OffscreenCanvas(2, 1);
    /** @type {OffscreenCanvasRenderingContext2D} */ (plain.getContext('2d')).drawImage(await createImageBitmap(file), 0, 0);
    out.plain = (await pixelsOf(await plain.convertToBlob(), 'display-p3')).data;
    // An sRGB picture is left in sRGB, number for number.
    const srgb = await lib.processImage(new Blob([await fixtures.buildPng(data, 2, 1)]), { type: 'image/png' });
    out.srgb = { space: srgb.colorSpace, tagged: (await lib.sniffImage(lib.blobReader(srgb.blob)))?.wideGamut, data: (await pixelsOf(srgb.blob)).data };
    return out;
  });
  for (const type of ['image/png', 'image/jpeg', 'image/webp']) {
    const { space, tagged, p3 } = /** @type {{space: string, tagged: boolean, p3: number[]}} */ (read[type]);
    assert.deepEqual([space, tagged], ['display-p3', true], type);
    [255, 0, 0, 255, 200, 100, 50, 255].forEach((value, index) => assert.ok(Math.abs(p3[index] - value) <= (type === 'image/png' ? 0 : 4), `${type} channel ${index}: ${p3[index]} for ${value}`));
  }
  const plain = /** @type {number[]} */ (read.plain);
  assert.ok(plain[0] < 240 && plain[1] > 40, `on a plain canvas P3 red comes out duller: ${plain.slice(0, 3)}`);
  assert.deepEqual(read.srgb, { space: 'srgb', tagged: false, data: [255, 0, 0, 255, 200, 100, 50, 255] });
});

test('a size to fit: the highest quality that fits it; smaller pixels when none does; said when it can\'t', async () => {
  const sizes = await inPage(async ({ lib, encoded, photo }) => {
    const file = new Blob([await encoded(photo(800, 600), 800, 600, 'image/png')], { type: 'image/png' });
    /** @type {Record<string, unknown>} */
    const out = {};
    for (const type of /** @type {const} */ (['image/jpeg', 'image/webp'])) {
      const fitted = await lib.processImage(file, { type, maxBytes: 60_000 });
      const above = await lib.processImage(file, { type, quality: ((fitted.quality ?? 0) + 1) / 100 });
      out[type] = { size: fitted.blob.size, quality: fitted.quality, fits: fitted.fits, shrunk: fitted.shrunk, width: fitted.width, above: above.blob.size };
    }
    const tiny = await lib.processImage(file, { type: 'image/jpeg', maxBytes: 6000 });
    out.tiny = { size: tiny.blob.size, fits: tiny.fits, shrunk: tiny.shrunk, width: tiny.width, height: tiny.height };
    const refused = await lib.processImage(file, { type: 'image/jpeg', maxBytes: 6000, shrink: false });
    out.refused = { fits: refused.fits, shrunk: refused.shrunk, quality: refused.quality, width: refused.width };
    const png = await lib.processImage(file, { type: 'image/png', maxBytes: 200_000 });
    out.png = { size: png.blob.size, fits: png.fits, shrunk: png.shrunk, quality: png.quality };
    return out;
  });
  for (const type of ['image/jpeg', 'image/webp']) {
    const fitted = /** @type {{size: number, quality: number, fits: boolean, shrunk: boolean, width: number, above: number}} */ (sizes[type]);
    assert.ok(fitted.fits && fitted.size <= 60_000 && !fitted.shrunk && fitted.width === 800, `${type}: ${JSON.stringify(fitted)}`);
    assert.ok(fitted.quality > 20 && fitted.quality < 95 && fitted.above > 60_000, `${type}: one more per cent would be over (${fitted.above})`);
  }
  const tiny = /** @type {{size: number, fits: boolean, shrunk: boolean, width: number, height: number}} */ (sizes.tiny);
  assert.ok(tiny.fits && tiny.shrunk && tiny.size <= 6000 && tiny.width < 800, JSON.stringify(tiny));
  assert.ok(Math.abs(tiny.width / tiny.height - 4 / 3) < 0.02, 'its shape is kept');
  assert.deepEqual(sizes.refused, { fits: false, shrunk: false, quality: 20, width: 800 });
  const png = /** @type {{size: number, fits: boolean, shrunk: boolean, quality: null}} */ (sizes.png);
  assert.ok(png.fits && png.shrunk && png.size <= 200_000 && png.quality === null, `a PNG has only its pixels to give: ${JSON.stringify(png)}`);
});

test('EXIF: removed unless asked for; kept without the location; kept with it; never the thumbnail; the picture still upright', async () => {
  const read = await inPage(async ({ lib, fixtures, pixelsOf, encoded, quadrants, corners }) => {
    const exif = fixtures.buildExif({ orientation: 6, make: 'Example', model: 'Pixel 9 Pro', taken: '2026:11:13 10:22:05', location: { latitude: 51.5007, longitude: -0.1246 }, thumbnail: new Uint8Array(fixtures.checkerboard(8, 8).buffer), pixels: { width: 32, height: 32 } });
    const jpeg = /** @type {Uint8Array<ArrayBuffer>} */ (lib.withExif(await encoded(quadrants(16), 32, 32, 'image/jpeg'), 'image/jpeg', exif, { width: 32, height: 32, alpha: false }));
    const file = new Blob([jpeg], { type: 'image/jpeg' });
    /** @type {Record<string, unknown>} */
    const out = {};
    for (const type of lib.ENCODABLE_TYPES) {
      for (const metadata of /** @type {const} */ (['remove', 'keep', 'keep-location'])) {
        const result = await lib.processImage(file, { type, metadata, quality: 1, resize: { mode: 'width', width: 16 }, maxBytes: metadata === 'keep' ? 4000 : undefined });
        const info = await lib.sniffImage(lib.blobReader(result.blob));
        const text = new TextDecoder('latin1').decode(await result.blob.arrayBuffer());
        out[`${type} ${metadata}`] = {
          said: result.exif, exif: info?.exif ? lib.readExif(info.exif) : null, mentions: /Exif|Pixel 9|eXIf|EXIF/.test(text),
          seen: corners(await pixelsOf(result.blob)), fits: result.fits, size: result.blob.size,
        };
      }
    }
    const none = await lib.processImage(new Blob([await encoded(quadrants(16), 32, 32, 'image/png')]), { type: 'image/jpeg', metadata: 'keep-location' });
    out.none = none.exif;
    return out;
  });
  for (const type of ['image/png', 'image/jpeg', 'image/webp']) {
    const [removed, kept, located] = ['remove', 'keep', 'keep-location'].map((metadata) => /** @type {any} */ (read[`${type} ${metadata}`]));
    assert.deepEqual([removed.said, removed.exif, removed.mentions], ['removed', null, false], `${type}: nothing of it is left by default`);
    assert.equal(kept.said, 'kept');
    assert.deepEqual(kept.exif, { orientation: 1, make: 'Example', model: 'Pixel 9 Pro', lens: '', software: '', taken: '2026:11:13 10:22:05', location: null, hasLocation: false, hasThumbnail: false }, type);
    assert.ok(kept.fits && kept.size <= 4000, `${type}: the size to fit counts the EXIF (${kept.size})`);
    assert.equal(located.said, 'kept-location');
    assert.equal(located.exif.location.latitude.toFixed(3), '51.501');
    assert.equal(located.exif.hasThumbnail, false);
    // Orientation 6 shows blue, red / white, green; written upright and marked 1, it still does.
    for (const result of [removed, kept, located]) assert.equal(result.seen, 'brwg', type);
  }
  assert.equal(read.none, 'none');
});

test('a PNG of few colours is written with a palette: the same pixels, a smaller file; a photograph isn\'t', async () => {
  const read = await inPage(async ({ lib, fixtures, pixelsOf, encoded, photo }) => {
    const size = 256;
    const data = new Uint8ClampedArray(size * size * 4);
    const colours = [[230, 57, 70, 255], [29, 53, 87, 255], [241, 250, 238, 255], [0, 0, 0, 0]];
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) data.set(colours[((x >> 4) + (y >> 5)) % 4], (y * size + x) * 4);
    const file = new Blob([await fixtures.buildPng(data, size, size)], { type: 'image/png' });
    const result = await lib.processImage(file, { type: 'image/png' });
    const info = await lib.sniffImage(lib.blobReader(result.blob));
    const chrome = await encoded(data, size, size, 'image/png');
    const camera = await lib.processImage(new Blob([await encoded(photo(64, 64), 64, 64, 'image/png')]), { type: 'image/png' });
    return { indexed: result.indexed, palette: info?.palette, size: result.blob.size, chrome: chrome.length, same: (await pixelsOf(result.blob)).data.every((value, index) => value === data[index]), camera: camera.indexed };
  });
  assert.deepEqual([read.indexed, read.palette, read.same, read.camera], [true, 4, true, false]);
  assert.ok(read.size < read.chrome / 2, `${read.size} bytes with a palette, ${read.chrome} as Chrome writes it`);
});

test('an animated GIF or PNG becomes an animated WebP, frame for frame; as PNG or JPEG, its first frame, and it says so', async () => {
  const read = await inPage(async ({ lib, fixtures, pixelsOf }) => {
    const palette = /** @type {[number, number, number][]} */ ([[255, 0, 0], [0, 0, 255], [0, 255, 0]]);
    const gif = new Blob([fixtures.buildGif([Uint8Array.of(0, 0, 0, 0), Uint8Array.of(1, 1, 1, 1), Uint8Array.of(2, 2, 2, 2)], { width: 2, height: 2, palette, delay: 70 })], { type: 'image/gif' });
    const apng = new Blob([await fixtures.buildApng([new Uint8ClampedArray(16).fill(255), Uint8ClampedArray.from({ length: 16 }, (_, i) => (i % 4 === 3 ? 255 : 0))], 2, 2, 120)]);
    /** @param {Blob} blob */
    const frames = async (blob) => {
      const decoder = new ImageDecoder({ data: blob.stream(), type: 'image/webp' });
      await decoder.completed;
      const track = /** @type {ImageTrack} */ (decoder.tracks.selectedTrack);
      const out = [];
      for (let frameIndex = 0; frameIndex < track.frameCount; frameIndex++) {
        const { image } = await decoder.decode({ frameIndex });
        const canvas = new OffscreenCanvas(image.displayWidth, image.displayHeight);
        const context = /** @type {OffscreenCanvasRenderingContext2D} */ (canvas.getContext('2d'));
        context.drawImage(image, 0, 0);
        out.push({ duration: (image.duration ?? 0) / 1000, width: image.displayWidth, first: [...context.getImageData(0, 0, 1, 1).data] });
        image.close();
      }
      return { frames: out, loops: track.repetitionCount === Infinity ? 'forever' : track.repetitionCount };
    };
    const moving = await lib.processImage(gif, { type: 'image/webp', quality: 1, resize: { mode: 'exact', width: 8, height: 8 } });
    const fromPng = await lib.processImage(apng, { type: 'image/webp', quality: 1 });
    const still = await lib.processImage(gif, { type: 'image/png' });
    const asked = await lib.processImage(gif, { type: 'image/webp', frames: 'first' });
    return {
      moving: { said: [moving.frames, moving.firstFrameOnly, moving.width], info: (await lib.sniffImage(lib.blobReader(moving.blob)))?.animated, ...(await frames(moving.blob)) },
      fromPng: { said: fromPng.frames, ...(await frames(fromPng.blob)) },
      still: { said: [still.frames, still.firstFrameOnly], data: (await pixelsOf(still.blob)).data.slice(0, 4) },
      asked: [asked.frames, asked.firstFrameOnly, (await lib.sniffImage(lib.blobReader(asked.blob)))?.animated],
    };
  });
  assert.deepEqual(read.moving.said, [3, false, 8]);
  assert.equal(read.moving.info, true);
  assert.deepEqual(read.moving.frames, [
    { duration: 70, width: 8, first: [255, 0, 0, 255] }, { duration: 70, width: 8, first: [0, 0, 255, 255] }, { duration: 70, width: 8, first: [0, 255, 0, 255] },
  ]);
  assert.equal(read.moving.loops, 'forever');
  assert.deepEqual([read.fromPng.said, read.fromPng.frames.map((frame) => [frame.duration, frame.first])], [2, [[120, [255, 255, 255, 255]], [120, [0, 0, 0, 255]]]]);
  assert.deepEqual(read.still, { said: [1, true], data: [255, 0, 0, 255] });
  assert.deepEqual(read.asked, [1, true, false]);
});

test('what can\'t be done is refused with its reason, before memory is spent; a stop is honoured', async () => {
  const reasons = await inPage(async ({ lib, fixtures }) => {
    /** @param {Blob} file @param {import('../src/index.js').ProcessOptions} options */
    const reason = (file, options) => lib.processImage(file, options).then(() => 'done', (error) => (error instanceof lib.ImageError ? error.reason : `${error.name}`));
    const png = new Blob([await fixtures.buildPng(fixtures.checkerboard(64, 64), 64, 64)]);
    // A PNG whose header is right and whose pixels are rubbish.
    const broken = (await fixtures.buildPng(fixtures.checkerboard(64, 64), 64, 64)).fill(7, 45);
    const stopped = new AbortController();
    stopped.abort();
    return {
      text: await reason(new Blob(['<svg xmlns="http://www.w3.org/2000/svg"/>']), { type: 'image/png' }),
      pixels: await reason(png, { type: 'image/png', maxPixels: 4000 }),
      broken: await reason(new Blob([broken]), { type: 'image/png' }),
      webpSide: await reason(png, { type: 'image/webp', resize: { mode: 'exact', width: 16_384, height: 4 } }),
      webpFits: await reason(png, { type: 'image/webp', resize: { mode: 'exact', width: 16_383, height: 4 } }),
      area: await reason(png, { type: 'image/png', resize: { mode: 'exact', width: 20_000, height: 20_000 } }),
      stopped: await reason(png, { type: 'image/png', resize: { mode: 'width', width: 32 }, signal: stopped.signal }),
    };
  });
  assert.deepEqual(reasons, { text: 'unsupported', pixels: 'too-large', broken: 'decode', webpSide: 'output-size', webpFits: 'done', area: 'output-size', stopped: 'AbortError' });
});

test('convertImage, and the whole pipeline inside a worker', async () => {
  const read = await inPage(async ({ lib, fixtures, pixelsOf, encoded, quadrants }) => {
    const webp = new Blob([await encoded(quadrants(8), 16, 16, 'image/webp')], { type: 'image/webp' });
    const png = await lib.convertImage(webp, 'png');
    const jpg = await lib.convertImage(webp, 'jpg');
    const source = `import { processImage } from '${location.origin}/src/index.js';
      onmessage = async ({ data }) => { const result = await processImage(data, { type: 'image/webp', resize: { mode: 'width', width: 75 } }); postMessage({ blob: result.blob, width: result.width, where: self.constructor.name }); };`;
    const worker = new Worker(URL.createObjectURL(new Blob([source], { type: 'text/javascript' })), { type: 'module' });
    const board = new Blob([await fixtures.buildPng(fixtures.checkerboard(512, 512), 512, 512)]);
    const answer = await new Promise((resolve, reject) => {
      worker.onmessage = (event) => resolve(event.data);
      worker.onerror = (event) => reject(new Error(event.message));
      worker.postMessage(board);
    });
    worker.terminate();
    const small = await pixelsOf(answer.blob);
    return { png: [png.type, (await pixelsOf(png)).data.slice(0, 4)], jpg: jpg.type, where: answer.where, width: answer.width, grey: small.data[(37 * 75 + 37) * 4] };
  });
  assert.deepEqual(read.png, ['image/png', [255, 0, 0, 255]]);
  assert.equal(read.jpg, 'image/jpeg');
  assert.deepEqual([read.where, read.width], ['DedicatedWorkerGlobalScope', 75]);
  assert.ok(Math.abs(read.grey - 188) <= 3, `grey ${read.grey}`);
});
