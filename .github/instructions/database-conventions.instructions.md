---
description: "Use when modifying the database layer, writing queries, or changing upsert/persistence logic. Enforces preservation semantics, deduplication rules, and schema conventions."
applyTo: "src/lib/db.ts"
---

# Database Conventions

## Connection Setup

- **Engine:** better-sqlite3, synchronous API
- **WAL mode:** `PRAGMA journal_mode = WAL` — always enabled for concurrent read safety
- **Foreign keys:** `PRAGMA foreign_keys = ON` — always enabled, cascading deletes depend on this
- **Path:** `DATABASE_PATH` env var (default `data/chess-results.db`); use `:memory:` for tests

## Schema (6 Tables)

### `tournaments`
| Column | Notes |
|--------|-------|
| `id` | TEXT PRIMARY KEY — the chess-results.com tournament ID |
| `name` | Tournament name from `<h2>` |
| `total_rounds` | Integer, updated only if incoming > 0 |
| `date`, `location` | Updated only if incoming is non-empty |
| `event_label` | Label for the event group, updated only if non-empty |
| `linked_tournaments` | JSON array of related tournament IDs, updated only if non-empty |

### `players`
| Column | Notes |
|--------|-------|
| `id` | INTEGER PRIMARY KEY AUTOINCREMENT |
| `name` | Player full name — UNIQUE with federation |
| `federation` | Country code — UNIQUE with name |
| `sex`, `club`, `rating`, `fide_id` | Updated only if incoming is non-empty/non-null |

### `tournament_players`
Links players to tournaments with tournament-specific rating and club (may differ from player's main record).

### `standings`
| Column | Notes |
|--------|-------|
| PK | (`tournament_id`, `player_id`, `type`) |
| `type` | `'open'` or `'women'` |
| `rank`, `points` | Numeric ranking and score |
| `tie_break_1` – `tie_break_6` | Up to 6 tie-break values |

### `results`
| Column | Notes |
|--------|-------|
| UNIQUE | (`tournament_id`, `round`, `table_number`) |
| `white_player_id`, `black_player_id` | FK to players, black nullable (BYE) |
| `result` | Text result string (e.g., "1-0", "½-½") |

### `cache`
Key-value cache with TTL-based expiry for raw HTML responses.

## Upsert Rules — CRITICAL

### The Preserve Non-Empty Rule
**Never overwrite existing non-empty data with empty/null/zero values.** This is the single most important invariant in the database layer.

#### `upsertTournament()`
```sql
-- total_rounds: only update if new value > 0
CASE WHEN excluded.total_rounds > 0 THEN excluded.total_rounds ELSE tournaments.total_rounds END

-- text fields (date, location, event_label, linked_tournaments):
CASE WHEN excluded.{field} != '' THEN excluded.{field} ELSE tournaments.{field} END
```

#### `upsertPlayer()`
```sql
-- Each field: only update if new value is non-empty/non-null
sex = CASE WHEN excluded.sex != '' THEN excluded.sex ELSE players.sex END
rating = CASE WHEN excluded.rating IS NOT NULL THEN excluded.rating ELSE players.rating END
```

#### `linkPlayerToTournament()`
```sql
-- rating: prefer new non-null value
rating = COALESCE(excluded.rating, tournament_players.rating)
-- club: prefer new non-empty value
club = CASE WHEN excluded.club != '' THEN excluded.club ELSE tournament_players.club END
```

### Why This Matters
Different data sources provide different subsets of player/tournament data. A standings page might provide rating but no club. A pairings page might provide club but no rating. Without preserve-non-empty, re-importing from one source would erase data gathered from another.

## Player Deduplication

### Lookup Priority in `upsertPlayer()`
1. **FIDE ID match** — if caller provides `fide_id` and a matching row exists, update that row's fields (strongest identity signal)
2. **Name + federation** — exact match on the UNIQUE constraint
3. **Name only (no federation)** — if caller has no federation info AND exactly one row matches by name, reuse it
4. **Placeholder adoption** — if caller HAS federation and a placeholder row exists (same name, `federation=''`), adopt it by updating its federation
5. **Create new** — insert a fresh row

### Startup Migration
`migrateDeduplicatePlayers()` runs at startup to merge duplicate player rows by name. It:
- Scores each duplicate by metadata richness (federation > fide_id > sex > rating > club)
- Keeps the "richest" row, re-links all references, deletes others
- Won't merge rows with different explicit (non-empty) federations

## Batch Persistence

### `persistStandings(tournamentId, standings, type)`
- Wraps in a transaction
- **Deletes** all existing standings for that tournament+type first
- **Inserts** all new standings rows
- Idempotent — safe to call repeatedly

### `persistPairings(tournamentId, round, results)`
- Wraps in a transaction
- **Deletes** all existing results for that tournament+round first
- **Inserts** all new result rows
- Idempotent — safe to call repeatedly

## Runtime Migrations
Schema changes are applied via `ALTER TABLE` wrapped in try/catch blocks at initialization:
- Adding `event_label`, `linked_tournaments` to tournaments
- Adding `tie_break_4`–`tie_break_6` to standings

These are safe to run repeatedly — the try/catch handles "column already exists" gracefully.

## Query Patterns

- `findPlayerByIdentity(name, federation)` — prioritizes exact federation match; falls back to richest metadata row
- `getPlayerTournamentHistory(playerId)` — JOINs tournaments, standings, tournament_players
- `getPlayerResultRows(playerId)` — all results where player was white or black
- `searchTournaments(query, limit)` — LIKE search on tournament names
