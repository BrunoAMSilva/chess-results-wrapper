import { expect, test } from '@playwright/test';

test('presenter standings settings panel opens and closes accessibly', async ({ page }) => {
  await page.goto('/present/standings?tid=1361358&lang=1', { waitUntil: 'domcontentloaded' });

  const settingsToggle = page.locator('[data-presenter-config-panel] [data-config-toggle]');
  await expect(settingsToggle).toHaveAttribute('aria-expanded', 'false');

  await settingsToggle.click();
  await expect(settingsToggle).toHaveAttribute('aria-expanded', 'true');

  const tournamentId = page.getByRole('textbox', { name: 'Tournament ID' });
  await expect(tournamentId).toBeVisible();
  await expect(page.locator('[data-config-body] :focus')).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(settingsToggle).toHaveAttribute('aria-expanded', 'false');
  await expect(settingsToggle).toBeFocused();
});

test('practice page renders shared controls or a shared empty state', async ({ page }) => {
  await page.goto('/practice', { waitUntil: 'domcontentloaded' });

  const emptyState = page.getByText('No openings are available yet. Seed or import openings to start a practice session.');
  if (await emptyState.isVisible().catch(() => false)) {
    await expect(emptyState).toBeVisible();
    return;
  }

  await expect(page.getByRole('searchbox', { name: 'Search opening' })).toBeVisible();
  await expect(page.getByRole('radiogroup', { name: 'Opening' })).toBeVisible();

  const variationChoices = page.getByRole('radiogroup', { name: 'Variation and side' });
  await expect(variationChoices).toBeVisible();
  await expect(variationChoices).toHaveAttribute('aria-disabled', 'true');
  await expect(page.getByText('Pick an opening first')).toBeVisible();

  await expect(page.getByRole('status')).toContainText('Select an opening to begin.');
});