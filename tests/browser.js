/**
 * Playwright's Chromium with this library's modules served to it, for the tests of what only a
 * browser can do (decode, draw, encode).
 *
 * @module tests/browser
 */

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('..', import.meta.url));

/**
 * Start a browser on a blank page that can import `/src/*.js`.
 *
 * @returns {Promise<{page: import('playwright').Page, close: () => Promise<void>}>} The page, and how to end.
 */
export async function startBrowser() {
  const server = createServer(async (request, response) => {
    const file = path.join(root, decodeURIComponent(new URL(request.url ?? '/', 'http://x').pathname));
    if (!file.startsWith(root) || !file.endsWith('.js')) {
      response.setHeader('content-type', 'text/html');
      response.end('<!doctype html><title>image-pipeline</title>');
      return;
    }
    response.setHeader('content-type', 'text/javascript');
    response.end(await readFile(file));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(null)));
  const { port } = /** @type {import('node:net').AddressInfo} */ (server.address());
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on('console', (message) => { if (message.type() === 'error') console.error(message.text()); });
  await page.goto(`http://127.0.0.1:${port}/`);
  return {
    page,
    close: async () => {
      await browser.close();
      server.close();
    },
  };
}
