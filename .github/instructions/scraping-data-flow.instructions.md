---
description: "Use when modifying the scraping pipeline, strategy parsers, or HTML-to-data conversion logic. Enforces correct data flow, multi-language support, and fallback behaviors."
applyTo: "src/lib/scraper.ts,src/lib/strategies/**"
---

# Scraping & Data Flow Conventions

## Pipeline Overview

```
chess-results.com → fetchTournamentHtml() → Cheerio $ → Strategy.parse*() → persist*() → SQLite
```

Every scraping function follows: **fetch → parse → persist**. Parsing and persistence are separate steps — never write to DB during HTML parsing.

## Fetching Rules

### URL Construction
- Base: `https://chess-results.com/tnr{tid}.aspx?lan={lang}&art={art}&rd={round}`
- Art codes: `0` = pairings, `1` = standard standings, `4` = crosstable
- Always include `wi=821` parameter (wide layout) for more columns

### Old Tournament Gate
chess-results.com blocks old tournaments behind a confirmation gate. The gate page contains a `__VIEWSTATE` hidden field and a button. When detected:
1. Extract `__VIEWSTATE`, `__VIEWSTATEGENERATOR`, `__EVENTVALIDATION` from the form
2. POST back with `__EVENTTARGET=cb_ShowTournament` plus those hidden fields. Example for tournament ID `1303334`:
```typescript
await fetch("https://s2.chess-results.com/tnr1303334.aspx?lan=10&turdet=YES&SNode=S0", {
    "credentials": "include",
    "headers": {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:147.0) Gecko/20100101 Firefox/147.0",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "pt-PT,pt;q=0.9,en-US;q=0.8,en;q=0.7",
        "Content-Type": "application/x-www-form-urlencoded",
        "Sec-GPC": "1",
        "Upgrade-Insecure-Requests": "1",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "same-origin",
        "Sec-Fetch-User": "?1",
        "Priority": "u=0, i",
        "Pragma": "no-cache",
        "Cache-Control": "no-cache"
    },
    "referrer": "https://s2.chess-results.com/tnr1303334.aspx?lan=10&turdet=YES&SNode=S0",
    "body": "__EVENTTARGET=&__EVENTARGUMENT=&__VIEWSTATE=%2FwEPDwUKLTYyNDM3NzQzNw9kFgJmD2QWBAIBDxYCHgRUZXh0BQJwdGQCCQ9kFgICAQ9kFgxmDxYCHgdWaXNpYmxlZxYCZg9kFgICAw8WAh4Fc3R5bGUFRFdJRFRIOjEwMDBweDtIRUlHSFQ6OTdweDtwb3NpdGlvbjpyZWxhdGl2ZTtiYWNrZ3JvdW5kLWNvbG9yOiMzMzQxNjY7FgQCAQ8WAh8CBStXSURUSDoxMDAwcHg7SEVJR0hUOjk3cHg7cG9zaXRpb246cmVsYXRpdmU7FgICAQ8WAh8CBTVXSURUSDo3MjhweDtIRUlHSFQ6OTdweDtsZWZ0OjI3MnB4O3Bvc2l0aW9uOmFic29sdXRlO2QCAw8WAh4Dc3JjBSNpbWFnZXMvY2hlc3NSZXN1bHRzX0VOR18xMDAweDkwLmpwZ2QCBA8WAh8BZxYCZg9kFgQCAQ8WAh4JaW5uZXJodG1sBQ9Mb2dnZWQgb246IEdhc3RkAgMPFgIfBAUeU2VydmVydGltZSAwNy4wMy4yMDI2IDE0OjA2OjA4ZAIFDxYCHwFnZAIGDxYCHwFnZAIIDxYCHwFoZAILD2QWAmYPZBYCAgMPZBYCZg9kFgJmDxYCHgV3aWR0aAUDODM0FgICAQ8WAh8CBTpQQURESU5HOjBweCAwcHggMHB4IDJweDtGTE9BVDpsZWZ0O01BUkdJTjowcHg7V0lEVEg6ODM0cHg7FgICAQ9kFgICAw9kFgQCAQ88KwARAgEQFgAWABYADBQrAABkAgMPPCsAEQIBEBYAFgAWAAwUKwAAZBgCBRJjdGwwMCRQMSRHcmlkVmlldzIPZ2QFEmN0bDAwJFAxJEdyaWRWaWV3MQ9nZPmcrU%2BMWIDpXvAdBokz5De9Vbit%2Fq9dT2FwKUYNDzOQ&__VIEWSTATEGENERATOR=D5991272&__EVENTVALIDATION=%2FwEdAAI2hSyI2FUn4IRCHtE5cNgOolKyfaSroikh4PwByU0fhr8wqlI4bF6w8agTMhyol3G8z9STFzs2cxCgGmM68cTr&cb_alleDetails=mostrar+detalhes+do+torneio",
    "method": "POST",
    "mode": "cors"
});
```
3. Use the response HTML

### Domain Fallback
If primary domain returns no data, retry with `s2.chess-results.com` (mirror/backup domain).

### Details Expansion
Some pages show truncated data until "Show tournament details" is clicked. If the initial HTML contains the details postback target, perform a second POST with `__EVENTTARGET=cb_AllDetails` to expand it.

## Parsing Rules

### Multi-Language Column Headers
chess-results.com renders headers in the tournament's source language. Parsers MUST handle all 5 languages:

| Column | EN | PT | ES | DE | FR |
|--------|----|----|----|----|-----|
| Name | Name | Nome | Nombre | Name | Nom |
| Rating | Rtg | Elo | Elo | Elo/DWZ | Elo |
| Points | Pts. | Pts. | Pts. | Pkt. | Pts. |
| Tie-break 1-6 | TB1-TB6 | Desp1-Desp6 | Des1-Des6 | BH1+ etc | Dep1-Dep6 |
| Federation | FED | Fed | Fed | Vbd | Féd |
| Club | Club/City | Clube | Club | Verein | Club |

### Row Class Selectors
Data rows use alternating CSS classes. Always select ALL variants:
```
tr.CRg1, tr.CRg2, tr.CRng1, tr.CRng2
```
Missing any of these will cause rows to be silently dropped.

### Linked Tournament Parsing
The "Selection" navigation section links related tournaments. Language labels:
- EN: `Selection`
- PT: `Selecção`
- ES: `Selección`
- FR: `Sélection`
- DE: `Auswahl`

Extract tournament IDs from `tnr{id}` in link hrefs. Return as JSON array.

### totalRounds Fallback Chain
Try these in order — use the first that succeeds:
1. Metadata cell: text matching "N Rounds/Runden/Rondas/Rondes"
2. Count of `rd=` link parameters in pairings navigation
3. Count of round separator rows (`.CRg1 th` or `.CRng1 th` containing round labels)
4. "after N rounds" text pattern in standings headers

### BYE Detection
Mark as BYE when opponent text matches: `BYE`, `bye`, `Livre`, or cell is empty with a result present. BYEs produce a result row with no opponent player.

## Strategy System

### Type Detection Priority
`detectTournamentType($)` checks in order:
1. **Metadata cell** — `td.CR` text containing "Tournament type" keywords → checks for "team"/"round robin"/"liga"/"berger"
2. **Team column headers** — "Team" in `CRs1` table header cells
3. **Round separator count** — ≥2 round headers in separator rows → round-robin; team headers → team variant
4. **Default:** Swiss

### Strategy Contract
Every strategy must implement:
- `parsePairings($, round)` → `{ meta, results[] }`
- `parseStandings($)` → `{ meta, standings[], womenStandings[] }`

All strategies share base parsers from `base.ts` — extend, don't duplicate.

## Standings Special Logic

### Crosstable vs Standard List
For standings, try `art=4` (crosstable) first. If it yields no data, fall back to `art=1` (standard list).

### Sex Column for Women Standings
If the crosstable (`art=4`) has no sex column, fetch `art=1` separately and extract sex data from it. Merge sex into the main standings before deriving women standings.

### Women Standings Derivation
Filter players where `sex='F'`, then re-rank sequentially (1, 2, 3...) by original point order. This is the `deriveWomenStandings()` function.

## Persistence Contracts

After parsing, data is persisted via transactional batch functions:
- `persistStandings(tournamentId, standings, type)` — deletes existing standings of the same type first, then inserts all rows in a transaction
- `persistPairings(tournamentId, round, results)` — deletes existing results for that round first, then inserts all rows in a transaction

Both use **delete-then-insert** inside a transaction — this ensures idempotent re-imports.
