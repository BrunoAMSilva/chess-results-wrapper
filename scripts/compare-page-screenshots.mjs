import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const SCREENSHOT_ROOT = process.env.SCREENSHOT_OUTPUT_DIR || '.artifacts/page-screenshots';
const DEFAULT_OUTPUT_DIR = path.resolve(process.cwd(), SCREENSHOT_ROOT, 'comparisons');

function usage() {
  console.error('Usage: node scripts/compare-page-screenshots.mjs <baseline-label> <candidate-label> [report-name]');
}

function normalizePath(filePath) {
  return filePath.split(path.sep).join('/');
}

function readManifest(label) {
  const directory = path.resolve(process.cwd(), SCREENSHOT_ROOT, label);
  const manifestPath = path.join(directory, 'manifest.json');

  if (!existsSync(manifestPath)) {
    throw new Error(`Missing manifest for run "${label}" at ${manifestPath}`);
  }

  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const pages = Array.isArray(manifest.pages) ? manifest.pages : [];
  return {
    label,
    directory,
    manifest,
    pages: new Map(pages.map((page) => [page.name, page])),
  };
}

function fileHash(filePath) {
  const buffer = readFileSync(filePath);
  return createHash('sha1').update(buffer).digest('hex');
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

const [, , baselineLabel, candidateLabel, explicitReportName] = process.argv;

if (!baselineLabel || !candidateLabel) {
  usage();
  process.exit(1);
}

const baseline = readManifest(baselineLabel);
const candidate = readManifest(candidateLabel);
const reportName = explicitReportName || `${baselineLabel}-vs-${candidateLabel}`;
const outputDir = DEFAULT_OUTPUT_DIR;
const reportPath = path.join(outputDir, `${reportName}.html`);

mkdirSync(outputDir, { recursive: true });

const allPageNames = Array.from(new Set([
  ...baseline.pages.keys(),
  ...candidate.pages.keys(),
])).sort();

const results = allPageNames.map((pageName) => {
  const baselinePage = baseline.pages.get(pageName);
  const candidatePage = candidate.pages.get(pageName);

  const baselineFile = baselinePage ? path.join(baseline.directory, baselinePage.file) : null;
  const candidateFile = candidatePage ? path.join(candidate.directory, candidatePage.file) : null;

  const baselineExists = !!baselineFile && existsSync(baselineFile);
  const candidateExists = !!candidateFile && existsSync(candidateFile);

  const baselineHash = baselineExists ? fileHash(baselineFile) : null;
  const candidateHash = candidateExists ? fileHash(candidateFile) : null;

  let status = 'missing';
  if (baselineExists && candidateExists) {
    status = baselineHash === candidateHash ? 'identical' : 'changed';
  } else if (baselineExists) {
    status = 'missing-candidate';
  } else if (candidateExists) {
    status = 'missing-baseline';
  }

  return {
    pageName,
    status,
    baselinePage,
    candidatePage,
    baselineRelative: baselineExists ? normalizePath(path.relative(outputDir, baselineFile)) : null,
    candidateRelative: candidateExists ? normalizePath(path.relative(outputDir, candidateFile)) : null,
  };
});

const counts = results.reduce(
  (summary, result) => {
    summary[result.status] = (summary[result.status] || 0) + 1;
    return summary;
  },
  { identical: 0, changed: 0, 'missing-baseline': 0, 'missing-candidate': 0, missing: 0 },
);

const filterDefinitions = [
  { value: 'changed', label: 'Changed' },
  { value: 'identical', label: 'Identical' },
  { value: 'missing-baseline', label: 'Missing baseline' },
  { value: 'missing-candidate', label: 'Missing candidate' },
];

const cardsHtml = results.map((result) => {
  const statusLabel = result.status.replaceAll('-', ' ');
  const baselineMeta = result.baselinePage
    ? `<p class="meta-line"><strong>URL</strong> ${escapeHtml(result.baselinePage.url)}</p>`
    : '<p class="meta-line meta-line--missing">No baseline capture</p>';
  const candidateMeta = result.candidatePage
    ? `<p class="meta-line"><strong>URL</strong> ${escapeHtml(result.candidatePage.url)}</p>`
    : '<p class="meta-line meta-line--missing">No candidate capture</p>';

  const baselinePane = result.baselineRelative
    ? `<a class="image-link" href="${escapeHtml(result.baselineRelative)}"><img src="${escapeHtml(result.baselineRelative)}" alt="${escapeHtml(result.pageName)} baseline screenshot" loading="lazy" /></a>`
    : '<div class="missing-shot">Missing baseline screenshot</div>';

  const candidatePane = result.candidateRelative
    ? `<a class="image-link" href="${escapeHtml(result.candidateRelative)}"><img src="${escapeHtml(result.candidateRelative)}" alt="${escapeHtml(result.pageName)} candidate screenshot" loading="lazy" /></a>`
    : '<div class="missing-shot">Missing candidate screenshot</div>';

  return `
    <article class="comparison-card comparison-card--${escapeHtml(result.status)}" data-status="${escapeHtml(result.status)}" data-page-name="${escapeHtml(result.pageName.toLowerCase())}">
      <header class="comparison-card__header">
        <div>
          <p class="comparison-card__eyebrow">${escapeHtml(statusLabel)}</p>
          <h2>${escapeHtml(result.pageName)}</h2>
        </div>
        <span class="status-pill status-pill--${escapeHtml(result.status)}">${escapeHtml(statusLabel)}</span>
      </header>

      <div class="comparison-card__grid">
        <section class="pane">
          <h3>${escapeHtml(baseline.label)}</h3>
          ${baselineMeta}
          ${baselinePane}
        </section>
        <section class="pane">
          <h3>${escapeHtml(candidate.label)}</h3>
          ${candidateMeta}
          ${candidatePane}
        </section>
      </div>
    </article>
  `;
}).join('\n');

const filtersHtml = filterDefinitions.map((filter) => `
  <label class="filter-option">
    <input class="filter-option__input" type="checkbox" name="status-filter" value="${escapeHtml(filter.value)}" checked />
    <span class="filter-option__label">${escapeHtml(filter.label)}</span>
  </label>
`).join('');

const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Screenshot comparison: ${escapeHtml(baseline.label)} vs ${escapeHtml(candidate.label)}</title>
    <style>
      :root {
        color-scheme: dark;
        --bg: #101217;
        --panel: #171b22;
        --panel-strong: #1f2530;
        --text: #f5f7fb;
        --text-dim: #aeb7c5;
        --border: #2e3744;
        --accent: #f5b941;
        --changed: #f5b941;
        --identical: #34d399;
        --missing: #f87171;
      }

      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: Inter, system-ui, sans-serif;
        background: linear-gradient(180deg, #101217, #0d1015 30%);
        color: var(--text);
      }

      main {
        width: min(1400px, calc(100vw - 32px));
        margin: 0 auto;
        padding: 32px 0 48px;
      }

      h1, h2, h3, p { margin: 0; }

      .hero {
        display: grid;
        gap: 20px;
        margin-bottom: 28px;
      }

      .hero__title {
        display: grid;
        gap: 8px;
      }

      .eyebrow {
        font-size: 12px;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        color: var(--text-dim);
      }

      .summary {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
        gap: 12px;
      }

      .toolbar {
        display: grid;
        gap: 14px;
        background: var(--panel);
        border: 1px solid var(--border);
        border-radius: 18px;
        padding: 16px;
      }

      .toolbar__header {
        display: flex;
        justify-content: space-between;
        gap: 16px;
        align-items: start;
        flex-wrap: wrap;
      }

      .toolbar__copy {
        display: grid;
        gap: 6px;
      }

      .toolbar__count {
        color: var(--text-dim);
        font-size: 14px;
        line-height: 1.4;
      }

      .toolbar__actions {
        display: flex;
        gap: 10px;
        flex-wrap: wrap;
      }

      .toolbar__controls {
        display: grid;
        gap: 14px;
      }

      .search-field {
        display: grid;
        gap: 8px;
      }

      .search-field__label {
        font-size: 14px;
        font-weight: 600;
      }

      .search-field__input {
        width: min(420px, 100%);
        min-height: 44px;
        padding: 10px 14px;
        border-radius: 12px;
        border: 1px solid var(--border);
        background: var(--panel-strong);
        color: var(--text);
        font: inherit;
      }

      .search-field__input::placeholder {
        color: var(--text-dim);
      }

      .search-field__input:focus-visible {
        outline: 2px solid var(--accent);
        outline-offset: 2px;
      }

      .toolbar-button {
        appearance: none;
        border: 1px solid var(--border);
        border-radius: 999px;
        background: var(--panel-strong);
        color: var(--text);
        font: inherit;
        padding: 10px 14px;
        cursor: pointer;
      }

      .toolbar-button:hover {
        border-color: var(--accent);
      }

      .toolbar-button:focus-visible {
        outline: 2px solid var(--accent);
        outline-offset: 2px;
      }

      .filter-group {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        border: 0;
        padding: 0;
        margin: 0;
      }

      .filter-group__legend {
        font-size: 14px;
        font-weight: 600;
        margin-bottom: 8px;
      }

      .filter-option {
        display: inline-flex;
        align-items: center;
        gap: 10px;
        min-height: 44px;
        padding: 10px 14px;
        border-radius: 999px;
        background: var(--panel-strong);
        border: 1px solid var(--border);
        cursor: pointer;
      }

      .filter-option:focus-within {
        outline: 2px solid var(--accent);
        outline-offset: 2px;
      }

      .filter-option__input {
        width: 16px;
        height: 16px;
        accent-color: var(--accent);
        margin: 0;
      }

      .filter-option__label {
        font-size: 14px;
        font-weight: 600;
      }

      .summary-card {
        background: var(--panel);
        border: 1px solid var(--border);
        border-radius: 18px;
        padding: 16px;
        display: grid;
        gap: 8px;
      }

      .summary-card__count {
        font-size: 32px;
        font-weight: 700;
      }

      .comparison-list {
        display: grid;
        gap: 20px;
      }

      .empty-state {
        display: none;
        background: var(--panel);
        border: 1px solid var(--border);
        border-radius: 18px;
        padding: 24px;
        color: var(--text-dim);
      }

      .empty-state[data-visible="true"] {
        display: block;
      }

      .comparison-card {
        background: var(--panel);
        border: 1px solid var(--border);
        border-radius: 24px;
        padding: 20px;
        display: grid;
        gap: 18px;
      }

      .comparison-card__header {
        display: flex;
        justify-content: space-between;
        align-items: start;
        gap: 16px;
      }

      .comparison-card__eyebrow {
        font-size: 12px;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        color: var(--text-dim);
        margin-bottom: 6px;
      }

      .status-pill {
        border-radius: 999px;
        padding: 6px 10px;
        font-size: 12px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.08em;
      }

      .status-pill--identical { background: color-mix(in srgb, var(--identical) 18%, transparent); color: var(--identical); }
      .status-pill--changed { background: color-mix(in srgb, var(--changed) 18%, transparent); color: var(--changed); }
      .status-pill--missing,
      .status-pill--missing-baseline,
      .status-pill--missing-candidate { background: color-mix(in srgb, var(--missing) 18%, transparent); color: var(--missing); }

      .comparison-card__grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 16px;
      }

      .pane {
        background: var(--panel-strong);
        border-radius: 18px;
        padding: 14px;
        display: grid;
        gap: 10px;
        min-width: 0;
      }

      .meta-line {
        font-size: 13px;
        line-height: 1.4;
        color: var(--text-dim);
        overflow-wrap: anywhere;
      }

      .meta-line--missing { color: var(--missing); }

      .image-link,
      .missing-shot {
        display: block;
        width: 100%;
        min-height: 240px;
        border-radius: 14px;
        overflow: hidden;
        border: 1px solid var(--border);
        background: #0c0f14;
      }

      .image-link img {
        display: block;
        width: 100%;
        height: auto;
      }

      .missing-shot {
        display: grid;
        place-items: center;
        color: var(--text-dim);
        padding: 24px;
        text-align: center;
      }

      @media (max-width: 960px) {
        .comparison-card__grid {
          grid-template-columns: 1fr;
        }

        .toolbar__header {
          flex-direction: column;
        }
      }
    </style>
  </head>
  <body>
    <main>
      <section class="hero">
        <div class="hero__title">
          <p class="eyebrow">Screenshot comparison report</p>
          <h1>${escapeHtml(baseline.label)} vs ${escapeHtml(candidate.label)}</h1>
          <p>Generated from manifests in ${escapeHtml(SCREENSHOT_ROOT)}. Identical status means the image bytes matched exactly.</p>
        </div>
        <div class="summary" aria-label="Comparison summary">
          <article class="summary-card"><p class="eyebrow">Changed</p><p class="summary-card__count">${counts.changed}</p></article>
          <article class="summary-card"><p class="eyebrow">Identical</p><p class="summary-card__count">${counts.identical}</p></article>
          <article class="summary-card"><p class="eyebrow">Missing baseline</p><p class="summary-card__count">${counts['missing-baseline']}</p></article>
          <article class="summary-card"><p class="eyebrow">Missing candidate</p><p class="summary-card__count">${counts['missing-candidate']}</p></article>
        </div>
        <section class="toolbar" aria-labelledby="filter-title">
          <div class="toolbar__header">
            <div class="toolbar__copy">
              <h2 id="filter-title">Filter pages</h2>
              <p class="toolbar__count" id="filter-results" aria-live="polite">Showing ${results.length} of ${results.length} pages</p>
            </div>
            <div class="toolbar__actions">
              <button class="toolbar-button" type="button" data-filter-action="all">Show all</button>
              <button class="toolbar-button" type="button" data-filter-action="changes">Changed or missing</button>
              <button class="toolbar-button" type="button" data-filter-action="reset">Reset</button>
            </div>
          </div>
          <div class="toolbar__controls">
            <div class="search-field">
              <label class="search-field__label" for="page-search">Page name</label>
              <input class="search-field__input" id="page-search" type="search" placeholder="Search by page name" autocomplete="off" />
            </div>
            <fieldset class="filter-group" aria-describedby="filter-results">
              <legend class="filter-group__legend">Statuses</legend>
              ${filtersHtml}
            </fieldset>
          </div>
        </section>
      </section>

      <p class="empty-state" id="empty-state" data-visible="false">No pages match the current filters.</p>

      <section class="comparison-list" aria-label="Per-page comparisons">
        ${cardsHtml}
      </section>
    </main>
    <script>
      (() => {
        const cards = Array.from(document.querySelectorAll('.comparison-card'));
        const checkboxes = Array.from(document.querySelectorAll('input[name="status-filter"]'));
        const resultCounter = document.getElementById('filter-results');
        const emptyState = document.getElementById('empty-state');
        const searchInput = document.getElementById('page-search');

        const applyFilters = () => {
          const activeStatuses = new Set(
            checkboxes.filter((checkbox) => checkbox.checked).map((checkbox) => checkbox.value),
          );
          const searchValue = (searchInput?.value ?? '').trim().toLowerCase();

          let visibleCount = 0;
          for (const card of cards) {
            const status = card.getAttribute('data-status') ?? '';
            const pageName = card.getAttribute('data-page-name') ?? '';
            const matchesStatus = activeStatuses.has(status);
            const matchesSearch = searchValue === '' || pageName.includes(searchValue);
            const isVisible = matchesStatus && matchesSearch;
            card.hidden = !isVisible;
            if (isVisible) visibleCount += 1;
          }

          if (resultCounter) {
            resultCounter.textContent = 'Showing ' + visibleCount + ' of ' + cards.length + ' pages';
          }

          if (emptyState) {
            emptyState.dataset.visible = visibleCount === 0 ? 'true' : 'false';
          }
        };

        const setFilters = (values) => {
          const next = new Set(values);
          for (const checkbox of checkboxes) {
            checkbox.checked = next.has(checkbox.value);
          }
          applyFilters();
        };

        for (const checkbox of checkboxes) {
          checkbox.addEventListener('change', applyFilters);
        }

        if (searchInput) {
          searchInput.addEventListener('input', applyFilters);
        }

        for (const button of Array.from(document.querySelectorAll('[data-filter-action]'))) {
          button.addEventListener('click', () => {
            const action = button.getAttribute('data-filter-action');
            if (action === 'all' || action === 'reset') {
              if (searchInput) searchInput.value = '';
              setFilters(['changed', 'identical', 'missing-baseline', 'missing-candidate']);
              return;
            }

            if (action === 'changes') {
              setFilters(['changed', 'missing-baseline', 'missing-candidate']);
            }
          });
        }

        applyFilters();
      })();
    </script>
  </body>
</html>`;

writeFileSync(reportPath, html, 'utf8');

console.log(`Comparison report written to ${reportPath}`);
console.log(`Compared ${results.length} pages: ${counts.changed} changed, ${counts.identical} identical, ${counts['missing-baseline']} missing baseline, ${counts['missing-candidate']} missing candidate.`);