import { test, expect } from '@playwright/test';

test('standings screenshot', async ({ page }) => {
  await page.goto('http://localhost:4321/standings');
  await page.waitForSelector('.standing-row');
  // Wait a bit for animations
  await page.waitForTimeout(1000);
  await page.screenshot({ path: 'debug/standings-debug.png', fullPage: true });
});