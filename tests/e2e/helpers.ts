import { expect, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';

export const FIXTURE = fileURLToPath(new URL('../fixtures/portrait.png', import.meta.url));
export const FIXTURE_SIZE = { width: 256, height: 256 };

/** Load the deterministic fixture image into the editor via the file input. */
export async function loadFixture(page: Page): Promise<void> {
  await page.goto('editor');
  await page.locator('input[type="file"]').setInputFiles(FIXTURE);
  await expect(page.locator('canvas.ie-canvas-el')).toBeVisible({ timeout: 15000 });
  // Let the first real render land (the canvas exists before the first frame draws).
  await page.waitForTimeout(300);
}

export type Rgba = [number, number, number, number];

/** Read a single pixel from the live presentation canvas, in fixture-space fractions. */
export async function readPixel(page: Page, xFrac: number, yFrac: number): Promise<Rgba> {
  return page.evaluate(
    ({ xFrac, yFrac }) => {
      const canvas = document.querySelector('canvas.ie-canvas-el') as HTMLCanvasElement;
      const ctx = canvas.getContext('2d')!;
      const x = Math.min(canvas.width - 1, Math.floor(xFrac * canvas.width));
      const y = Math.min(canvas.height - 1, Math.floor(yFrac * canvas.height));
      const data = ctx.getImageData(x, y, 1, 1).data;
      return [data[0], data[1], data[2], data[3]] as Rgba;
    },
    { xFrac, yFrac },
  );
}

/** Local-variance proxy: mean absolute difference between neighbouring pixels in a small patch. */
export async function readPatchVariance(page: Page, xFrac: number, yFrac: number, size = 20): Promise<number> {
  return page.evaluate(
    ({ xFrac, yFrac, size }) => {
      const canvas = document.querySelector('canvas.ie-canvas-el') as HTMLCanvasElement;
      const ctx = canvas.getContext('2d')!;
      const x = Math.max(0, Math.floor(xFrac * canvas.width) - size / 2);
      const y = Math.max(0, Math.floor(yFrac * canvas.height) - size / 2);
      const data = ctx.getImageData(x, y, size, size).data;
      let sum = 0;
      let count = 0;
      for (let row = 0; row < size; row++) {
        for (let col = 0; col < size - 1; col++) {
          const i = (row * size + col) * 4;
          const j = (row * size + col + 1) * 4;
          sum += Math.abs(data[i] - data[j]);
          count += 1;
        }
      }
      return sum / count;
    },
    { xFrac, yFrac, size },
  );
}

export function toolTab(page: Page, label: string) {
  return page.locator('nav[aria-label="Editor tools"]').getByText(label, { exact: true });
}
