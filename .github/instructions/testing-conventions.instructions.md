---
description: "Use when writing, running, or reviewing tests. Enforces test conventions, fixture usage, and regression coverage expectations."
applyTo: "tests/**/*.test.ts,tests/**/*.spec.ts,vitest.config.ts"
---

# Testing Conventions

## Framework & Configuration

- **Vitest** with config at `vitest.config.ts`
- **In-memory SQLite** via `DATABASE_PATH=:memory:` env var — no file I/O in tests
- **Playwright tests excluded** — `tests/` directory is excluded from vitest; those run separately

## Test Scripts

| Command | Purpose |
|---------|---------|
| `npm test` | All vitest tests (respects SKIP_LIVE) |
| `npm run test:unit` | Offline tests only (SKIP_LIVE=1) — used by pre-commit hook and CI |
| `npm run test:live` | Includes tests that hit chess-results.com |
| `npm run test:watch` | Watch mode for development |

## Pre-Commit Hook

`.githooks/pre-commit` runs `npm run test:unit` before every commit. **Never bypass this** with `--no-verify`. If tests fail, fix them before committing.

## Test File Organization

| File | Scope |
|------|-------|
| `tests/unit/db.test.ts` | Database CRUD, upsert preservation, deduplication, batch persistence |
| `tests/unit/scraper-parse.test.ts` | HTML parsing: metadata, linked tournaments, standings, pairings, type detection |
| `tests/unit/e2e-persist.test.ts` | Parse → persist → retrieve roundtrips |
| `tests/unit/utils.test.ts` | Utility functions (reverseName, etc.) |
| `tests/unit/scraper.test.ts` | Fixture-based parser tests + live canary tests (skipped by default) |
| `tests/unit/strategies/strategies.test.ts` | Strategy-specific live tests (skipped by default) |

## Writing Tests

### DB Tests
- Use `getDb()` with `DATABASE_PATH=:memory:` — each test file gets a fresh database
- Test both the happy path AND the preservation invariant (re-upsert must not erase existing data)
- For upsert tests: insert with full data, re-upsert with partial data, verify original fields are preserved

### Parser Tests
- Use synthetic HTML strings (Cheerio loaded in-test) for unit tests
- Use saved HTML files in `tests/fixtures/` for integration tests
- Always test with multiple language variants (at minimum EN and PT)

### Live Tests
- Guard with `describe.skipIf(process.env.SKIP_LIVE === '1')`
- These are canary tests — they verify the scraper still works against the live site
- Keep them fast (single page fetches) and tolerant of minor HTML changes

## Key Regression Areas

Every PR touching these areas must verify the related test suite passes:

1. **Linked tournaments** — parsing all 5 language labels, preserving on re-upsert
2. **event_label** — persistence across re-imports
3. **totalRounds fallback** — all 4 strategies, not just the first match
4. **Tie-break columns** — TB1-TB6 AND Desp1-Desp6 headers
5. **Sex column** — detection from both crosstable and standard list
6. **Player deduplication** — placeholder adoption, FIDE ID matching, federation handling
7. **Row class variants** — CRg1/CRg2/CRng1/CRng2 all handled
8. **BYE handling** — "BYE", "bye", "Livre", empty cells
9. **Tournament type detection** — Swiss, RoundRobin, TeamSwiss, TeamRoundRobin
10. **Batch persistence** — delete-then-insert idempotency

## CI Pipeline

GitHub Actions (`deploy.yml`) runs `npm run test:unit` before building. Failed tests block deployment.
