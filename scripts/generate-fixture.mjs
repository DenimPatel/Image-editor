import { chromium } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Builds a deterministic 256x256 PNG fixture for the Playwright pixel-verification
 * suite:
 *  - top-left quadrant: high-frequency noise (skin-smoothing should reduce local variance here)
 *  - top-right quadrant: a hard black/white edge (smoothing must not wash it out)
 *  - a dark "blemish" dot on flat background at (200, 200) for the heal tool
 *  - a saturated-red "eye" dot on flat background at (60, 200) for red-eye removal
 */
const outPath = fileURLToPath(new URL('../tests/fixtures/portrait.png', import.meta.url));

const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || '/opt/pw-browsers/chromium',
});
const page = await browser.newPage();
const dataUrl = await page.evaluate(() => {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#a08070';
  ctx.fillRect(0, 0, 256, 256);

  // Deterministic PRNG so the fixture is reproducible across runs.
  let seed = 42;
  function rand() {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  }
  const noise = ctx.getImageData(0, 0, 128, 128);
  for (let i = 0; i < noise.data.length; i += 4) {
    const v = Math.floor(rand() * 255);
    noise.data[i] = v;
    noise.data[i + 1] = v;
    noise.data[i + 2] = v;
    noise.data[i + 3] = 255;
  }
  ctx.putImageData(noise, 0, 0);

  ctx.fillStyle = '#000000';
  ctx.fillRect(128, 0, 64, 128);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(192, 0, 64, 128);

  ctx.fillStyle = '#3a2a20';
  ctx.beginPath();
  ctx.arc(200, 200, 10, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#ff0000';
  ctx.beginPath();
  ctx.arc(60, 200, 10, 0, Math.PI * 2);
  ctx.fill();

  return canvas.toDataURL('image/png');
});
await browser.close();

const base64 = dataUrl.split(',')[1];
writeFileSync(outPath, Buffer.from(base64, 'base64'));
console.log(`Wrote ${outPath}`);
