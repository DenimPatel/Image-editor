import { expect, test } from '@playwright/test';
import { loadFixture, readPatchVariance, readPixel, toolTab } from './helpers';

test.describe('Adjust', () => {
  test('brightness slider actually brightens the image', async ({ page }) => {
    await loadFixture(page);
    const before = await readPixel(page, 0.9, 0.75); // flat background area, right of both quadrants
    await toolTab(page, 'Adjust').click();
    await page.locator('button', { hasText: 'Brightness' }).first().click();
    const slider = page.getByRole('slider', { name: 'Brightness' });
    await slider.focus();
    await slider.press('End'); // jumps to max per DialSlider's keyboard handling
    await page.waitForTimeout(300);
    const after = await readPixel(page, 0.9, 0.75);
    const lumaBefore = 0.2126 * before[0] + 0.7152 * before[1] + 0.0722 * before[2];
    const lumaAfter = 0.2126 * after[0] + 0.7152 * after[1] + 0.0722 * after[2];
    expect(lumaAfter).toBeGreaterThan(lumaBefore + 10);
  });
});

test.describe('Retouch', () => {
  test('skin smoothing reduces local noise without erasing the hard edge', async ({ page }) => {
    await loadFixture(page);
    const varianceBefore = await readPatchVariance(page, 0.25, 0.25); // noisy quadrant
    const edgeBefore = await readPixel(page, 0.55, 0.25); // near the black/white edge

    await toolTab(page, 'Retouch').click();
    const slider = page.getByRole('slider', { name: 'Smooth' });
    await slider.focus();
    await slider.press('End');
    await page.waitForTimeout(300);

    const varianceAfter = await readPatchVariance(page, 0.25, 0.25);
    const edgeAfter = await readPixel(page, 0.55, 0.25);

    expect(varianceAfter).toBeLessThan(varianceBefore * 0.7);
    // The edge itself should stay a hard transition (still near-black or near-white),
    // proving the filter is edge-aware and doesn't just uniformly blur everything.
    const edgeLumaAfter = 0.2126 * edgeAfter[0] + 0.7152 * edgeAfter[1] + 0.0722 * edgeAfter[2];
    const edgeLumaBefore = 0.2126 * edgeBefore[0] + 0.7152 * edgeBefore[1] + 0.0722 * edgeBefore[2];
    expect(Math.abs(edgeLumaAfter - edgeLumaBefore)).toBeLessThan(40);
  });

  test('heal tool removes the blemish dot', async ({ page }) => {
    await loadFixture(page);
    const before = await readPixel(page, 200 / 256, 200 / 256);
    expect(before[0]).toBeLessThan(100); // dark blemish

    await toolTab(page, 'Retouch').click();
    await page.getByRole('tab', { name: 'Heal blemish' }).click();
    const canvas = page.locator('canvas.ie-canvas-el');
    const box = await canvas.boundingBox();
    if (!box) throw new Error('canvas not visible');
    await page.mouse.click(box.x + box.width * (200 / 256), box.y + box.height * (200 / 256));
    await page.waitForTimeout(300);

    const after = await readPixel(page, 200 / 256, 200 / 256);
    // Healed pixel should now match the surrounding flat background, not the dark blemish.
    expect(after[0]).toBeGreaterThan(before[0] + 40);
  });

  test('red-eye tool desaturates the red spot', async ({ page }) => {
    await loadFixture(page);
    const before = await readPixel(page, 60 / 256, 200 / 256);
    expect(before[0] - before[1]).toBeGreaterThan(100); // strongly red

    await toolTab(page, 'Retouch').click();
    await page.getByRole('tab', { name: 'Red-eye' }).click();
    const canvas = page.locator('canvas.ie-canvas-el');
    const box = await canvas.boundingBox();
    if (!box) throw new Error('canvas not visible');
    await page.mouse.click(box.x + box.width * (60 / 256), box.y + box.height * (200 / 256));
    await page.waitForTimeout(300);

    const after = await readPixel(page, 60 / 256, 200 / 256);
    expect(after[0] - after[1]).toBeLessThan(before[0] - before[1] - 60);
  });
});

test.describe('Undo/redo', () => {
  test('undo reverts a brightness change', async ({ page }) => {
    await loadFixture(page);
    const before = await readPixel(page, 0.9, 0.75);
    await toolTab(page, 'Adjust').click();
    await page.locator('button', { hasText: 'Brightness' }).first().click();
    const slider = page.getByRole('slider', { name: 'Brightness' });
    await slider.focus();
    await slider.press('End');
    await page.waitForTimeout(300);
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(300);
    const after = await readPixel(page, 0.9, 0.75);
    expect(Math.abs(after[0] - before[0])).toBeLessThan(5);
  });
});
