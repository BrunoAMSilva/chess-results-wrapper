# Chess Results Wrapper

A modern, responsive wrapper for [chess-results.com](https://chess-results.com) tournament data, built with Astro 5 SSR.

## Features

- **Modern UI** — Clean, mobile-first interface for viewing pairings, standings, and player profiles
- **TV/Presenter Mode** — Auto-cycling carousel view optimized for projector displays at tournaments
- **5-Language Support** — English, Portuguese, Spanish, German, and French (UI + data parsing)
- **Player Profiles** — Cross-tournament history, round-by-round results, and detailed statistics
- **Linked Tournaments** — Navigate related events within the same chess event via segmented control
- **Women Standings** — Automatically derived from main standings by filtering sex='F' players
- **Dark/Light Theme** — Three-state toggle (System/Light/Dark) with FOUC prevention
- **PWA** — Service worker, manifest, and offline-capable shell
- **4 Tournament Types** — Swiss, Round Robin, Team Swiss, Team Round Robin — auto-detected

## Architecture

```
chess-results.com HTML → Scraper (Cheerio) → SQLite DB → Astro SSR pages
```

| Layer | Technology | Details |
|-------|-----------|---------|
| Runtime | Node.js + Astro 5 | SSR with `@astrojs/node` standalone adapter |
| Database | better-sqlite3 | WAL mode, foreign keys ON, SQLite |
| Scraping | Cheerio | HTML parsing, no browser automation at runtime |
| Strategies | TypeScript classes | Swiss, RoundRobin, TeamSwiss, TeamRoundRobin |
| Styling | CSS custom properties | Design tokens in `src/styles/tokens.css` |

### File Organization

| Directory | Purpose |
|-----------|---------|
| `src/pages/` | Astro pages — fetch data, compose components |
| `src/components/` | Reusable `.astro` components with typed Props |
| `src/layouts/` | `ResponsiveLayout` (mobile) and `TVLayout` (projector) |
| `src/lib/` | Core logic: `db.ts`, `scraper.ts`, `utils.ts`, `cache.ts`, `types.ts` |
| `src/lib/strategies/` | Tournament type parsers with shared `base.ts` |
| `src/i18n/` | Translation strings (80+ keys per language) |
| `src/styles/` | Design tokens and global CSS |
| `src/scripts/` | Client-side JS: theme toggle, carousel |
| `scripts/` | Import/seeding CLI tools |
| `tests/fixtures/` | Saved HTML fixtures for unit tests |

## URL Parameters

All pages accept:

- `tid` — Tournament ID (default: `1361358`)
- `round` — Round number
- `lang` — Language ID: `0`=DE, `1`=EN (default), `2`=ES, `10`=PT, `20`=FR

Example: `/?tid=1361358&round=1&lang=10`

## Development

### Setup

```sh
npm install
git config core.hooksPath .githooks  # enables pre-commit test hook
```

### Commands

| Command | Purpose |
|---------|---------|
| `npm run dev` | Start development server |
| `npm run build` | Build for production |
| `npm run preview` | Preview production build |
| `npm run test:unit` | Run offline unit tests (pre-commit hook) |
| `npm run test:live` | Run tests including live chess-results.com checks |
| `npm run test:browser` | Run the Playwright browser suite |
| `npm run test:browser:screenshots` | Capture reference screenshots into `.artifacts/page-screenshots/<label>` |
| `npm run compare:browser:screenshots -- <baseline> <candidate>` | Build a side-by-side HTML comparison report |
| `npm run test:watch` | Watch mode for development |

### Testing

- **Framework:** Vitest with in-memory SQLite (`DATABASE_PATH=:memory:`)
- **Pre-commit hook:** `.githooks/pre-commit` runs `npm run test:unit` — never bypass with `--no-verify`
- **CI:** GitHub Actions runs `npm run test:unit` before every deployment
- **Test suites:** 100+ tests covering DB operations, HTML parsing, persistence roundtrips, and utilities

### Visual Regression Workflow

Capture a baseline screenshot set:

```sh
SCREENSHOT_RUN_LABEL=baseline npm run test:browser:screenshots
```

Capture a candidate screenshot set after your changes:

```sh
SCREENSHOT_RUN_LABEL=candidate npm run test:browser:screenshots
```

Generate a side-by-side HTML report:

```sh
npm run compare:browser:screenshots -- baseline candidate
```

This writes screenshots and reports into `.artifacts/page-screenshots/`, which is gitignored.
The comparison report is saved under `.artifacts/page-screenshots/comparisons/` and marks each page as identical, changed, or missing.

### Bulk Seed (Federation + Year)

To discover and import federation tournaments for a given year into the local DB:

```sh
npm run seed:por2026
```

For the easiest server import workflow (auto-uses your Turniersuche export if present):

```sh
npm run seed:por2026:server
```

This checks `~/Downloads/Chess-Results.com - Turniersuche.html` first and uses it
to import the full search result set. If the file is missing, it falls back to
live discovery automatically.

This command crawls the `fed=POR` listing, filters 2026 tournaments, and hydrates
standings and pairings into `data/chess-results.db`.

For custom runs:

```sh
npx tsx scripts/import-federation-year.ts --fed POR --year 2026 --lang 10
```

Optional flags:
- `--max 20` to cap imports
- `--max-pages 200` to crawl more federation pages
- `--no-pairings` to import only standings
- `--strict-title-year` to keep only titles explicitly containing the year

You can pass the same flags to the server wrapper command, for example:

```sh
npm run seed:por2026:server -- --max 25 --no-pairings
```

## License

MIT
