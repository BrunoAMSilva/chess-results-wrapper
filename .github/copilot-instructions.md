# Chess Results Wrapper — Project Instructions

## Architecture Overview

Astro 5 SSR application that wraps chess-results.com with a modern UI. Data flows through three stages:

```
chess-results.com HTML → Scraper (Cheerio) → SQLite DB → Astro SSR pages
```

- **Runtime:** Node.js with Astro's `@astrojs/node` standalone adapter (`output: 'server'`)
- **Database:** better-sqlite3 with WAL mode, foreign keys ON. Path from `DATABASE_PATH` env (default `data/chess-results.db`)
- **Scraping:** Cheerio parses HTML from chess-results.com. No browser automation at runtime (Playwright is only used during bulk import discovery)
- **Strategy pattern:** Four tournament parsers in `src/lib/strategies/` — Swiss, RoundRobin, TeamSwiss, TeamRoundRobin — auto-detected per tournament

## Key Behavioral Contracts

These are the most regression-prone areas. Always verify these behaviors when modifying related code:

### 1. Upsert "Preserve Non-Empty" Rule
All upserts **never overwrite existing non-empty data with empty/null values**:
- `upsertTournament()`: Only updates `total_rounds`, `date`, `location`, `event_label`, `linked_tournaments` if the incoming value is non-empty/positive
- `upsertPlayer()`: Only updates `sex`, `club`, `rating`, `fide_id` if incoming values are non-empty/non-null
- `linkPlayerToTournament()`: Uses `COALESCE` for rating, `CASE` for club

### 2. Player Deduplication Priority
`upsertPlayer()` lookup order:
1. By FIDE ID (strongest signal — updates all fields)
2. By name + federation (UNIQUE constraint)
3. By name only if caller has no federation AND only one match exists
4. Placeholder adoption: if caller HAS federation and a placeholder (`federation=''`) exists, adopt it
5. Create new row

### 3. Linked Tournaments
- Parsed from "Selection" links on chess-results.com (5 language labels: "Selection"/"Selecção"/"Selección"/"Sélection"/"Auswahl")
- Stored as JSON array in `tournaments.linked_tournaments`
- **Must be preserved on re-upsert** — never overwrite existing linked_tournaments with empty value
- Displayed via `TournamentSelector` component as a segmented control

### 4. totalRounds Fallback Chain
`parseTournamentMeta()` tries four strategies in order:
1. Metadata cell text ("N Rounds" / "N Runden" / "N Rondas" / "N Rondes")
2. Count of `rd=` links in pairings navigation
3. Count of round separator rows (`tr.CRg1 th` or `tr.CRng1 th` containing "Round"/"Ronda"/"Runde"/"Ronde")
4. "after N rounds" text from standings headers

### 5. Tie-Break Columns
Standings support TB1–TB6 (English) and Desp1–Desp6 (Portuguese) column headers. Both must be detected.

### 6. Row Class Variants
chess-results.com uses alternating row classes: `CRg1`/`CRg2` (gray) **and** `CRng1`/`CRng2` (non-gray). All four must be handled when selecting data rows.

### 7. Women Standings
Derived from the main standings by filtering `sex='F'` players and re-ranking. The `sex` column may come from the main standings table or a separate `art=1` fetch.

### 8. BYE/Unpaired Handling
Pairings mark byes as "BYE" (English), "bye" (lowercase), or "Livre" (Portuguese). These produce single-sided result rows with no opponent.

## URL Parameters

All pages accept:
- `tid` — Tournament ID (default: `1361358`)
- `round` — Round number
- `lang` — Language ID: `0`=DE, `1`=EN (default), `2`=ES, `10`=PT, `20`=FR

## Database Schema

Six tables: `cache`, `tournaments`, `players`, `tournament_players`, `standings`, `results`.

Key constraints:
- `players`: UNIQUE(`name`, `federation`)
- `results`: UNIQUE(`tournament_id`, `round`, `table_number`)
- `standings`: PRIMARY KEY(`tournament_id`, `player_id`, `type`)
- Foreign keys enforced with CASCADE deletes

## Testing Requirements

- **Framework:** Vitest with in-memory SQLite (`DATABASE_PATH=:memory:`)
- **Pre-commit hook:** `.githooks/pre-commit` runs `npm run test:unit` — never bypass this
- **Before any PR:** All unit tests must pass (`npm run test:unit`)
- **After modifying db.ts:** Run the full db test suite and verify upsert preservation logic
- **After modifying scraper/strategies:** Run parse tests with the HTML fixtures in `tests/fixtures/`
- **Live tests:** Canary tests that hit chess-results.com are skipped by default (SKIP_LIVE=1). Run with `npm run test:live`

## i18n

- 5 languages supported (EN, PT, ES, DE, FR)
- Translations in `src/i18n/ui.ts` keyed by language ID
- Language stored in cookie (`lang`, 1-year expiry) and propagated via `?lang=` URL param
- When parsing chess-results.com HTML, column headers appear in the tournament's source language — parsers must handle all 5 languages

## File Organization

| Directory | Purpose |
|-----------|---------|
| `src/pages/` | Astro pages — fetch data, compose components, minimal markup |
| `src/components/` | Reusable `.astro` components with typed Props |
| `src/layouts/` | `ResponsiveLayout` (mobile-first) and `TVLayout` (projector/TV) |
| `src/lib/` | Core logic: `db.ts`, `scraper.ts`, `utils.ts`, `cache.ts`, `types.ts` |
| `src/lib/strategies/` | Tournament type parsers with shared `base.ts` |
| `src/i18n/` | Translation strings |
| `src/styles/` | `tokens.css` (design tokens) and `global.css` |
| `src/scripts/` | Client-side JS: `theme.ts` (dark/light), `carousel.ts` (TV mode) |
| `scripts/` | Import/seeding CLI tools |
| `tests/` | Playwright E2E tests (excluded from vitest) |
| `tests/fixtures/` | Saved HTML fixtures for unit tests |

## Deployment

- Docker via `Dockerfile` + `docker-compose.yml`
- CI/CD: GitHub Actions (`deploy.yml`) — runs `npm run test:unit` before build
- Database file is persisted as a Docker volume
