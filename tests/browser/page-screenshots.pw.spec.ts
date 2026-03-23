import { expect, test } from '@playwright/test';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

test.describe.configure({ mode: 'serial' });
test.use({ viewport: { width: 1440, height: 1200 } });

const TOURNAMENT_ID = '1361358';
const LANG = '1';
const SCREENSHOT_ROOT = process.env.SCREENSHOT_OUTPUT_DIR || '.artifacts/page-screenshots';
const SCREENSHOT_LABEL = process.env.SCREENSHOT_RUN_LABEL || 'current';
const screenshotDir = path.resolve(process.cwd(), SCREENSHOT_ROOT, SCREENSHOT_LABEL);

type ScreenshotEntry = {
  name: string;
  url: string;
  file: string;
};

type RouteContext = {
  playerUrl?: string;
  playerProfileUrl?: string;
  refereeSectionUrl?: string;
  refereeTableUrl?: string;
};

const manifest: ScreenshotEntry[] = [];

function screenshotPath(name: string): string {
  return path.join(screenshotDir, `${name}.png`);
}

async function settlePage(page: Parameters<typeof test>[0]['page']) {
  await page.evaluate(async () => {
    if ('fonts' in document) {
      await (document as Document & { fonts: FontFaceSet }).fonts.ready;
    }
  }).catch(() => undefined);

  await page.addStyleTag({
    content: `
      astro-dev-toolbar,
      #astro-dev-toolbar,
      [data-astro-dev-toolbar],
      [data-vscode-context] {
        display: none !important;
        visibility: hidden !important;
      }
      *, *::before, *::after {
        caret-color: transparent !important;
      }
    `,
  }).catch(() => undefined);
}

async function capturePage(
  page: Parameters<typeof test>[0]['page'],
  name: string,
  url: string,
  ready: (page: Parameters<typeof test>[0]['page']) => Promise<void>,
) {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await ready(page);
  await settlePage(page);
  await page.screenshot({
    path: screenshotPath(name),
    fullPage: true,
    animations: 'disabled',
  });
  manifest.push({ name, url: page.url(), file: `${name}.png` });
}

test.beforeAll(() => {
  rmSync(screenshotDir, { recursive: true, force: true });
  mkdirSync(screenshotDir, { recursive: true });
});

test('captures reference screenshots for every page template', async ({ page }, testInfo) => {
  test.slow();

  const routes: RouteContext = {};

  await capturePage(page, 'home', '/', async (currentPage) => {
    await expect(currentPage.getByRole('heading', { level: 1 })).toBeVisible();
  });

  await capturePage(page, 'discover', '/discover', async (currentPage) => {
    await expect(currentPage.getByRole('heading', { level: 1 })).toBeVisible();
  });

  await capturePage(page, 'options', `/options?tid=${TOURNAMENT_ID}&lang=${LANG}`, async (currentPage) => {
    await expect(currentPage.getByRole('heading', { level: 1 })).toBeVisible();
  });

  await capturePage(page, 'pairings', `/pairings?tid=${TOURNAMENT_ID}&round=1&lang=${LANG}`, async (currentPage) => {
    await expect(currentPage.getByRole('heading', { level: 1 })).toBeVisible();
  });

  await capturePage(page, 'standings', `/standings?tid=${TOURNAMENT_ID}&lang=${LANG}`, async (currentPage) => {
    await expect(currentPage.getByRole('heading', { level: 1 })).toBeVisible();
    const playerLink = currentPage.locator(`a[href^="/player?tid=${TOURNAMENT_ID}"]`).first();
    await expect(playerLink).toBeVisible();
    routes.playerUrl = await playerLink.getAttribute('href') || undefined;
  });

  if (!routes.playerUrl) {
    throw new Error('Unable to discover a player page URL from the standings page.');
  }

  await capturePage(page, 'player', routes.playerUrl, async (currentPage) => {
    await expect(currentPage.getByRole('heading', { level: 1 })).toBeVisible();
    const profileLink = currentPage.locator('a[href^="/player-profile?"]').first();
    await expect(profileLink).toBeVisible();
    routes.playerProfileUrl = await profileLink.getAttribute('href') || undefined;
  });

  if (!routes.playerProfileUrl) {
    throw new Error('Unable to discover a player profile URL from the player page.');
  }

  await capturePage(page, 'player-profile', routes.playerProfileUrl, async (currentPage) => {
    await expect(currentPage.getByRole('heading', { level: 1 })).toBeVisible();
  });

  await capturePage(page, 'practice', '/practice', async (currentPage) => {
    const emptyState = currentPage.getByText('No openings are available yet. Seed or import openings to start a practice session.');
    if (await emptyState.isVisible().catch(() => false)) {
      await expect(emptyState).toBeVisible();
      return;
    }
    await expect(currentPage.getByRole('searchbox', { name: 'Search opening' })).toBeVisible();
  });

  await capturePage(page, 'present-pairings', `/present?tid=${TOURNAMENT_ID}&lang=${LANG}`, async (currentPage) => {
    await expect(currentPage.getByRole('heading', { level: 1 })).toBeVisible();
  });

  await capturePage(page, 'present-standings', `/present/standings?tid=${TOURNAMENT_ID}&lang=${LANG}`, async (currentPage) => {
    await expect(currentPage.getByRole('heading', { level: 1 })).toBeVisible();
  });

  await capturePage(page, 'referee-search', `/referee?lang=${LANG}`, async (currentPage) => {
    await expect(currentPage.getByRole('heading', { level: 1, name: 'Search Tournament' })).toBeVisible();
  });

  await capturePage(page, 'referee-tournament', `/referee/${TOURNAMENT_ID}?lang=${LANG}`, async (currentPage) => {
    await expect(currentPage.getByRole('heading', { level: 1 })).toBeVisible();
    const sectionLink = currentPage.locator(`main a[href^="/referee/${TOURNAMENT_ID}/"][href*="?round="]`).first();
    await expect(sectionLink).toBeVisible();
    routes.refereeSectionUrl = await sectionLink.getAttribute('href') || undefined;
  });

  if (!routes.refereeSectionUrl) {
    throw new Error('Unable to discover a referee section URL from the tournament selector page.');
  }

  await capturePage(page, 'referee-section', routes.refereeSectionUrl, async (currentPage) => {
    await expect(currentPage.getByRole('heading', { level: 1 })).toBeVisible();
    const tableLink = currentPage.getByRole('link', { name: /table/i }).first();
    await expect(tableLink).toBeVisible();
    routes.refereeTableUrl = await tableLink.getAttribute('href') || undefined;
  });

  if (!routes.refereeTableUrl) {
    throw new Error('Unable to discover a referee table URL from the section selector page.');
  }

  await capturePage(page, 'referee-table', routes.refereeTableUrl, async (currentPage) => {
    await expect(currentPage.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(currentPage.getByRole('radiogroup', { name: 'Select Result' })).toBeVisible();
  });

  await capturePage(page, 'referee-results', `/referee/${TOURNAMENT_ID}/results?lang=${LANG}`, async (currentPage) => {
    await expect(currentPage.getByRole('heading', { level: 1 })).toBeVisible();
  });

  await capturePage(page, 'not-found', '/missing-route-visual-check', async (currentPage) => {
    await expect(currentPage.getByRole('heading', { level: 1 })).toBeVisible();
  });

  writeFileSync(
    path.join(screenshotDir, 'manifest.json'),
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        browser: testInfo.project.name,
        baseURL: testInfo.project.use.baseURL,
        pages: manifest,
      },
      null,
      2,
    ),
    'utf8',
  );
});