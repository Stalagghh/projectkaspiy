// Visual evidence against the actual running stack, with no API interception or data injection.
// SMOKE_BASE_URL=http://127.0.0.1:3100 node e2e/capture-redesign.mjs
import { chromium } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const baseURL = process.env.SMOKE_BASE_URL ?? 'http://localhost:3000';
const browser = await chromium.launch();
const errors = [];
try {
  const page = await browser.newPage({ baseURL, reducedMotion: 'reduce' });
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  for (const [width, height] of [[1672, 941], [1440, 900], [1024, 768], [390, 844]]) {
    await page.setViewportSize({ width, height });
    for (const [route, name] of [['/', 'dashboard'], ['/audio', 'audio'], ['/forecast', 'forecast']]) {
      await page.goto(route);
      await page.getByTestId('sse-status').waitFor();
      if (route === '/') {
        await page.locator('.dev-marker').first().waitFor();
        await page.locator('.mini-day').first().waitFor();
        await page.locator('.clip-visual svg rect').first().waitFor();
      }
      if (route === '/forecast') await page.getByTestId('forecast-day').first().waitFor();
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(800);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
      if (overflow) throw new Error(`Horizontal overflow: ${route}, ${width}`);
      await page.screenshot({ path: fileURLToPath(new URL(`../docs/screenshots/light-${name}-${width}.png`, import.meta.url)) });
      if (width === 390) await page.screenshot({ path: fileURLToPath(new URL(`../docs/screenshots/light-${name}-${width}-full.png`, import.meta.url)), fullPage: true });
      if (route === '/' && (width === 1672 || width === 390)) {
        await page.getByTestId('alert-item').first().click();
        await page.getByRole('dialog').waitFor();
        await page.screenshot({ path: fileURLToPath(new URL(`../docs/screenshots/light-alert-${width}.png`, import.meta.url)) });
      }
      if (route === '/audio' && (width === 1672 || width === 390)) {
        await page.getByTestId('audio-file-input').setInputFiles(fileURLToPath(new URL('../data/demo/boat_engine.wav', import.meta.url)));
        await page.getByTestId('audio-result').waitFor();
        await page.locator('.clip-visual svg rect').first().waitFor();
        await page.screenshot({ path: fileURLToPath(new URL(`../docs/screenshots/light-audio-result-${width}.png`, import.meta.url)), fullPage: width === 390 });
      }
      if (route === '/forecast' && (width === 1672 || width === 390)) {
        await page.locator('.rank-item').first().click();
        await page.locator('.maplibregl-popup').waitFor();
        await page.locator('.maplibregl-popup').scrollIntoViewIfNeeded();
        await page.screenshot({ path: fileURLToPath(new URL(`../docs/screenshots/light-forecast-cell-${width}.png`, import.meta.url)) });
      }
      console.log(`${name} ${width}×${height}: rendered, no horizontal overflow`);
    }
  }
  console.log('Browser errors:', JSON.stringify(errors));
  if (errors.length) process.exitCode = 1;
} finally {
  await browser.close();
}
