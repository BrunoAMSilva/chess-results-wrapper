---
goal: Align UI with "The Grandmaster's Ledger" design system
version: 1.0
date_created: 2025-03-19
last_updated: 2025-03-19
owner: Bruno Silva
status: 'Planned'
tags: [design, refactor, ui, tokens, accessibility]
---

# Introduction

![Status: Planned](https://img.shields.io/badge/status-Planned-blue)

Comprehensive alignment of the Chess Results Wrapper UI with the new **"The Grandmaster's Ledger"** design system document (`design.instructions.md`). The audit revealed **~100+ violations** across tokens, typography, borders, shadows, surface hierarchy, chess indicators, glassmorphism, and button sizing. This plan organizes the remediation into 8 sequential phases.

## 1. Requirements & Constraints

- **REQ-001**: All surface boundaries must use background-color shifts, not 1px solid borders ("No-Line" rule)
- **REQ-002**: Manrope font must be loaded for display/headline typography (Display & Headlines)
- **REQ-003**: Inter remains the body/utility font (already implemented)
- **REQ-004**: No hardcoded hex/rgba color values in components or pages — all must reference CSS custom properties
- **REQ-005**: Surface hierarchy must follow the "Nested Depth" model: Background → Surface-Container-Low → Surface-Container-High
- **REQ-006**: Chess status indicators must use `tertiary-fixed-dim` (White Win), `secondary-fixed-dim` (Black Win), `surface-container-highest` + ghost border (Draw)
- **REQ-007**: Referee/presenter tap targets must be minimum 4rem (64px) height
- **REQ-008**: Floating nav/modal overlays must use glassmorphism (70% opacity + 24px backdrop blur)
- **REQ-009**: Primary CTAs should use subtle linear gradients (`primary-fixed-dim` → `primary-container`)
- **REQ-010**: Elevation via tonal layering only — no harsh drop shadows; ambient shadows with 32px blur at 6% max
- **SEC-001**: No visual regressions that break accessibility (WCAG 2.2 AA contrast ratios must be maintained)
- **CON-001**: Theme switching (dark/light) must remain functional throughout all changes
- **CON-002**: Changes must not break existing Vitest unit tests
- **CON-003**: All existing components must maintain their Props interface contracts
- **GUD-001**: Use `--font-display` token for Manrope; `--font-sans` for Inter
- **GUD-002**: All new tokens must have both dark and light variants in `tokens.css`
- **GUD-003**: Ghost borders use `outline-variant` at 15% opacity maximum
- **PAT-001**: Card separation via vertical whitespace (--space-2 or --space-3) + background color shifts, not dividers
- **PAT-002**: Active card/selection indicated by 4px vertical accent bar using `primary-container`

## 2. Implementation Steps

### Phase 1: Token Foundation — Add Missing Design Tokens

- GOAL-001: Extend `tokens.css` with all tokens referenced in the design system but currently absent

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-001 | Add `--font-display: 'Manrope', var(--font-sans)` to `:root` in `tokens.css` | | |
| TASK-002 | Add display text size tokens: `--text-display-lg: 3.5rem` (reserved for table numbers per spec) — verify existing `--text-display-sm/md/lg` align with spec | | |
| TASK-003 | Add surface hierarchy tokens to dark theme: `--surface-container-low` (`#1c1b1b`), `--surface-container-high` (`#2a2a2a`), `--surface-container-highest` (derive ~`#333`) | | |
| TASK-004 | Add surface hierarchy tokens to light theme with appropriate light-mode values | | |
| TASK-005 | Add chess indicator tokens: `--tertiary-fixed-dim` (`#e1c299`), `--secondary-fixed-dim` (`#e7bdb1`), `--on-primary-fixed` (dark text for gold bg) | | |
| TASK-006 | Add `--primary-container` (`#fcd34d`), `--primary-fixed-dim` (`#fff2d6`) (already partially present as `--gold-300`/`--gold-50` but need semantic aliases) | | |
| TASK-007 | Add `--outline-variant` token (e.g., `rgba(229, 226, 225, 0.15)` dark / `rgba(0, 0, 0, 0.12)` light) for ghost borders | | |
| TASK-008 | Add `--on-surface` token (`#e5e2e1` dark / `#1c1917` light) — currently `--text` serves this role, alias or keep both | | |
| TASK-009 | Replace undefined `--accent-400` references across 6 referee page files with existing `--accent-hover` token | | |
| TASK-010 | Add `--shadow-ambient: 0 8px 32px rgba(229, 226, 225, 0.06)` for tinted ambient shadows per spec | | |
| TASK-011 | Add light theme variants in `@media (prefers-color-scheme: light)` fallback for all new tokens | | |

### Phase 2: Typography — Import Manrope & Apply Font Hierarchy

- GOAL-002: Load Manrope font and assign it to display/headline elements, keeping Inter for body

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-012 | Add Manrope Google Font import to `BaseHead.astro`: `family=Manrope:wght@600;700;800` | | |
| TASK-013 | Update `ResponsiveLayout.astro` `.page-title` to use `font-family: var(--font-display)` | | |
| TASK-014 | Update `TVLayout.astro` `.title` to use `font-family: var(--font-display)` | | |
| TASK-015 | Update `StandingRow.astro` rank display (medal/rank numbers) to use `var(--font-display)` | | |
| TASK-016 | Update `PresenterPairingCard.astro` table number display to use `var(--font-display)` at `--text-display-lg` | | |
| TASK-017 | Update presenter/TV page headings (`present/index.astro`, `present/standings.astro`) to use `var(--font-display)` for round/title headings | | |
| TASK-018 | Update referee table number displays (`referee/[id]/[section]/[table].astro`) to use `var(--font-display)` at `--text-display-lg` for 5-foot legibility | | |

### Phase 3: No-Line Rule — Remove 1px Borders, Replace with Surface Shifts

- GOAL-003: Eliminate all `border: 1px solid` section separators and replace with background-color hierarchy shifts and spacing

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-019 | **ResponsiveLayout.astro**: Remove `border-top: 1px solid var(--border)` from `.mobile-nav`; replace with `background: var(--surface-container-low)` sitting on `--bg` | | |
| TASK-020 | **ResponsiveLayout.astro**: Remove `border: 1px solid var(--border)` from `.desktop-nav`; replace with `background: var(--surface-container-low)` | | |
| TASK-021 | **TVLayout.astro**: Remove `border-top: 1px solid` from `.carousel-footer` and all `.result-badge` container borders; use background color shift | | |
| TASK-022 | **TVLayout.astro**: Remove hardcoded `rgba(248, 113, 113, 0.3)` border on `.status-badge.live`; use background color and text color for differentiation | | |
| TASK-023 | **MatchCard.astro**: Remove row dividers and table border; use `gap` + surface background shifts | | |
| TASK-024 | **PlayerRoundRow.astro**: Remove `border-bottom: 1px solid` row separator; use `margin-bottom: var(--space-2)` with distinct background | | |
| TASK-025 | **PresenterPairingCard.astro**: Remove grid borders (4 instances); separate sections with background shifts and spacing | | |
| TASK-026 | **RoundSelector.astro**: Remove `border: solid var(--border) 1px` from container and items; use surface-container-high bg on items, surface bg on wrapper | | |
| TASK-027 | **TabsControl.astro**: Remove border-bottom between tabs; use underline indicator (`--tab-indicator`) only for the active state | | |
| TASK-028 | **ResponsiveMatchCard.astro**: Remove 3 border declarations; use hover background shifts from surface tokens | | |
| TASK-029 | **StandingRow.astro**: Remove top-border divider on row; keep left accent bar (correct per spec) but replace bottom-border with spacing | | |
| TASK-030 | **TeamStandingRow.astro**: Remove 3 border declarations; maintain the existing 4px left accent bar (correct per spec) | | |
| TASK-031 | **PlayerTournamentHistoryRow.astro**: Remove 3 border declarations from history cards; use surface-container-high background | | |
| TASK-032 | **TournamentSelector.astro**: Remove border from select element; use surface-container-high background | | |
| TASK-033 | **RecentTournaments.astro**: Remove border on list items; increase list item spacing and use surface shift | | |
| TASK-034 | **StandingsFilters.astro**: Remove 3 borders on form elements; restyle with surface backgrounds | | |
| TASK-035 | **ExportControls.astro**: Remove 2 borders; use surface-container-high bg for export buttons | | |
| TASK-036 | **PresenterQrCode.astro**: Remove border on QR card; use surface-container-high background | | |
| TASK-037 | **Pages — index.astro**: Remove search-results border ($`.search-results { border: 1px solid }`) and result-item bottom borders; use surface shift | | |
| TASK-038 | **Pages — discover.astro**: Remove `.discover-card` / `.page-link` borders | | |
| TASK-039 | **Pages — player-profile.astro**: Remove `.summary-item` and `.empty-state` borders | | |
| TASK-040 | **Pages — referee/**: Remove borders from search results, results header, table buttons; use surface backgrounds | | |
| TASK-041 | **Pages — present/**: Remove `.sponsor-card` borders in both `present/index.astro` and `present/standings.astro` | | |
| TASK-042 | Where definitions absolutely need subtle separation (form inputs, interactive controls), replace hard borders with ghost border: `border: 1px solid var(--outline-variant)` | | |

### Phase 4: Hardcoded Colors — Replace with Design Tokens

- GOAL-004: Eliminate all hardcoded hex/rgba values from component and page `<style>` blocks

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-043 | **PresenterPairingCard.astro**: Replace `#f5f5f5` → `var(--white-piece)`, `#111` → `var(--black-piece-dark)`, `#555` → `var(--black-piece-border)` | | |
| TASK-044 | **PlayerRoundRow.astro**: Replace `#e0e0e0` → `var(--neutral-200)`, `#222` → `var(--neutral-800)` in gradient endpoints | | |
| TASK-045 | **PlayerRoundRow.astro**: Replace 4 hardcoded `rgba()` result backgrounds with token-based alternatives: `rgba(from var(--win) r g b / 0.15)` pattern or add `--win-subtle`, `--loss-subtle`, `--draw-subtle` tokens | | |
| TASK-046 | **ResponsiveMatchCard.astro**: Replace 4 hardcoded `rgba(255, 255, 255, …)` with `var(--border-light)`, `var(--surface-hover)`, or appropriate tokens | | |
| TASK-047 | **StandingRow.astro**: Replace `rgba(255, 255, 255, 0.05)` with `var(--border-light)` or `var(--surface-hover)` | | |
| TASK-048 | **RoundSelector.astro**: Replace `rgb(255 255 255 / 0.1)` with `var(--surface-hover)` | | |
| TASK-049 | **404.astro**: Replace 4 hardcoded board colors with chess-piece tokens or add `--board-light` / `--board-dark` tokens | | |
| TASK-050 | **player.astro**: Replace `rgba(255, 255, 255, 0.05)` stat-block background with `var(--surface-hover)` | | |
| TASK-051 | **Referee pages**: Replace all `var(--accent-400)` (15 occurrences) with `var(--accent-hover)` | | |
| TASK-052 | **Referee pages**: Replace hardcoded `#fff`, `#000`, `#e53e3e`, `#38a169` fallbacks with proper tokens | | |
| TASK-053 | **TournamentSelector.astro**: Replace `%2388` SVG arrow color with url-encoded version of appropriate token value | | |
| TASK-054 | **TVLayout.astro**: Replace `rgba(248, 113, 113, 0.3)` hardcoded red with `var(--loss)` at 30% opacity or add `--loss-subtle` token | | |

### Phase 5: Elevation & Shadows — Tonal Layering Model

- GOAL-005: Replace harsh shadows with tonal layering; apply ambient shadow pattern where floating elements are needed

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-055 | **MatchCard.astro**: Remove `text-shadow: var(--shadow-md)` from player names; use font-weight/color contrast only | | |
| TASK-056 | **PlayerRoundRow.astro**: Replace hardcoded box-shadow on chess piece icons with either token shadows or surface-color differentiation | | |
| TASK-057 | **ResponsiveMatchCard.astro**: Replace hardcoded box-shadow (`rgba(0,0,0,0.2)` / `rgba(255,255,255,0.1)`) on piece icons with `var(--shadow-ambient)` or tonal surface layers | | |
| TASK-058 | Review all remaining `box-shadow` in components that use `var(--shadow-card)` / `var(--shadow-sm)` — these are acceptable but verify blur radius ≤ 32px and opacity ≤ 6% per spec for elevated items | | |
| TASK-059 | Ensure `.segmented-control` active indicator uses surface-tint shift rather than shadow for elevation feeling | | |

### Phase 6: Glassmorphism & Gradients — Premium Finishes

- GOAL-006: Apply glassmorphism to floating nav overlays and gradient treatment to primary CTAs

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-060 | **RoundSelector.astro**: Update backdrop-filter from `blur(14px)` to `blur(24px)` and replace `rgb(255 255 255 / 0.1)` with `color-mix(in srgb, var(--surface-container-highest) 70%, transparent)` | | |
| TASK-061 | **ResponsiveLayout.astro**: Update `.mobile-nav` backdrop-filter from `blur(14px)` to `blur(24px)` for spec compliance | | |
| TASK-062 | Apply subtle gradient (`var(--primary-fixed-dim)` → `var(--primary-container)`) to primary CTA buttons in: referee table result buttons, export action buttons, options update button | | |
| TASK-063 | Review `StandingRow` medal gradients — verify they use the correct primary-container palette for the "Authority Gold" aesthetic | | |

### Phase 7: Chess Status Indicators & Piece Colors

- GOAL-007: Align chess piece and game result indicator colors with the design system's chess-specific tokens

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-064 | **PresenterPairingCard.astro**: Update `.white-chip` to use `var(--tertiary-fixed-dim)` background, `.black-chip` to use `var(--secondary-fixed-dim)` | | |
| TASK-065 | **ResponsiveMatchCard.astro**: Verify `.piece-white`/`.piece-black` use `var(--white-piece)` and `var(--black-piece)` tokens (currently correct via gradient, but endpoint hardcoded) | | |
| TASK-066 | **PlayerRoundRow.astro**: Align `.piece-white`/`.piece-black` gradient endpoints with token values instead of hardcoded hex | | |
| TASK-067 | Update draw indicator style across components to use `var(--surface-container-highest)` with `var(--outline-variant)` ghost border per spec | | |
| TASK-068 | Standardize win/loss result backgrounds: White Win → `var(--tertiary-fixed-dim)` container, Black Win → `var(--secondary-fixed-dim)` container | | |

### Phase 8: Button Tap Targets & Referee UX

- GOAL-008: Ensure referee/presenter interactive elements meet the 4rem minimum touch target size

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-069 | **Referee table buttons** (`referee/[id]/index.astro`, `referee/[id]/[section]/index.astro`): Set `min-height: 4rem` on `.table-btn` | | |
| TASK-070 | **Referee result input buttons** (`referee/[id]/[section]/[table].astro`): Set `min-height: 4rem` on result submission buttons | | |
| TASK-071 | **Referee selected table number**: Apply `var(--font-display)` at `--text-display-lg` (3.5rem) with `--primary-container` background and `--on-primary-fixed` text per "Table Selectors" spec | | |
| TASK-072 | **Presenter view**: Ensure round navigation buttons in `present/index.astro` meet 44px minimum (presenter is not referee, so 44px WCAG minimum is sufficient) | | |
| TASK-073 | Add `border-radius: var(--radius-lg)` (1rem) to all primary referee action buttons per spec | | |

## 3. Alternatives

- **ALT-001**: Instead of adding new surface hierarchy tokens (`--surface-container-low/high/highest`), we could rename existing `--surface`, `--surface-hover`, `--surface-raised` to match the spec naming. Rejected: renaming would require updating every reference across all files and risks regressions. Adding aliases is safer.
- **ALT-002**: Instead of removing ALL borders, we could classify borders as "structural" (input outlines, active indicators) vs. "decorative" (card edges, row dividers) and only remove decorative ones. **Chosen approach** — reflected in TASK-042 which keeps ghost borders where form controls need definition.
- **ALT-003**: Instead of loading Manrope from Google Fonts, we could self-host. Deferred: Google Fonts is already the pattern for Inter, keeping consistency.

## 4. Dependencies

- **DEP-001**: Google Fonts CDN for Manrope: `https://fonts.googleapis.com/css2?family=Manrope:wght@600;700;800&display=swap`
- **DEP-002**: All new tokens in Phase 1 must be complete before Phases 3–8 can reference them
- **DEP-003**: Phase 2 (typography) requires Phase 1 TASK-001 (the `--font-display` token)
- **DEP-004**: Phase 7 (chess indicators) requires Phase 1 TASK-005 (chess indicator tokens)

## 5. Files

### Token & Global Files
- **FILE-001**: `src/styles/tokens.css` — Add ~15 new tokens (Phases 1)
- **FILE-002**: `src/styles/global.css` — Minimal changes (already clean)
- **FILE-003**: `src/components/BaseHead.astro` — Add Manrope font import (Phase 2)

### Layout Files
- **FILE-004**: `src/layouts/ResponsiveLayout.astro` — Remove borders, update nav glassmorphism (Phases 3, 6)
- **FILE-005**: `src/layouts/TVLayout.astro` — Remove borders, fix hardcoded colors (Phases 3, 4)

### Component Files (sorted by violation count)
- **FILE-006**: `src/components/PresenterPairingCard.astro` — 4 borders, 3 hardcoded colors (Phases 3, 4, 7)
- **FILE-007**: `src/components/PlayerRoundRow.astro` — 2 borders, 6 hardcoded colors, shadows (Phases 3, 4, 5)
- **FILE-008**: `src/components/ResponsiveMatchCard.astro` — 3 borders, 4 hardcoded colors, shadows (Phases 3, 4, 5)
- **FILE-009**: `src/components/StandingRow.astro` — 2 borders, 1 hardcoded color (Phase 3, 4)
- **FILE-010**: `src/components/TeamStandingRow.astro` — 3 borders (Phase 3)
- **FILE-011**: `src/components/PlayerTournamentHistoryRow.astro` — 3 borders (Phase 3)
- **FILE-012**: `src/components/RoundSelector.astro` — 2 borders, 1 hardcoded color, glassmorphism fix (Phases 3, 4, 6)
- **FILE-013**: `src/components/SegmentedControl.astro` — 1 border, hardcoded spacing (Phase 3)
- **FILE-014**: `src/components/TabsControl.astro` — 2 borders (Phase 3)
- **FILE-015**: `src/components/ExportControls.astro` — 2 borders (Phase 3)
- **FILE-016**: `src/components/StandingsFilters.astro` — 3 borders (Phase 3)
- **FILE-017**: `src/components/TournamentSelector.astro` — 1 border, 1 hardcoded color (Phases 3, 4)
- **FILE-018**: `src/components/RecentTournaments.astro` — 1 border (Phase 3)
- **FILE-019**: `src/components/PresenterQrCode.astro` — 1 border (Phase 3)
- **FILE-020**: `src/components/MatchCard.astro` — 3 borders, text-shadow (Phases 3, 5)
- **FILE-021**: `src/components/ThemeToggle.astro` — Minor spacing (Phase 3)

### Page Files
- **FILE-022**: `src/pages/index.astro` — 2 borders (Phase 3)
- **FILE-023**: `src/pages/discover.astro` — 2 borders (Phase 3)
- **FILE-024**: `src/pages/player-profile.astro` — 2 borders (Phase 3)
- **FILE-025**: `src/pages/player.astro` — 1 hardcoded color (Phase 4)
- **FILE-026**: `src/pages/404.astro` — 4 hardcoded board colors (Phase 4)
- **FILE-027**: `src/pages/present/index.astro` — 1 border, hardcoded spacing (Phases 3, 5)
- **FILE-028**: `src/pages/present/standings.astro` — 1 border, hardcoded spacing (Phases 3, 5)
- **FILE-029**: `src/pages/referee/index.astro` — 2 `--accent-400` refs (Phase 4)
- **FILE-030**: `src/pages/referee/[id]/index.astro` — 3 `--accent-400` refs, 1 fallback hex (Phase 4)
- **FILE-031**: `src/pages/referee/[id]/results.astro` — 4 `--accent-400` refs (Phase 4)
- **FILE-032**: `src/pages/referee/[id]/[section]/index.astro` — 2 `--accent-400` refs (Phase 4)
- **FILE-033**: `src/pages/referee/[id]/[section]/[table].astro` — 4 `--accent-400` refs, hardcoded colors (Phases 4, 8)

## 6. Testing

- **TEST-001**: Run `npm run test:unit` after Phase 1 (token changes) — verify no regressions
- **TEST-002**: Run `npm run test:unit` after Phase 3 (border removal) — verify scraper/strategy tests unaffected
- **TEST-003**: Visual smoke test dark mode after each phase — check all pages render correctly
- **TEST-004**: Visual smoke test light mode after each phase — verify theme switching
- **TEST-005**: Verify contrast ratios (4.5:1 text, 3:1 large text/focus) for all new color token pairs using browser DevTools or axe
- **TEST-006**: Verify touch target sizing in referee pages using browser DevTools device mode (iPhone 15 Pro Max)
- **TEST-007**: Verify glassmorphism rendering in Chrome, Safari, and Firefox (backdrop-filter support)
- **TEST-008**: Verify Manrope loads correctly (check Network tab, verify display/headline elements use it)
- **TEST-009**: Verify forced-colors / high-contrast mode doesn't break with new token values (Windows, macOS accessibility settings)
- **TEST-010**: Run `npm run build` to verify no SSR build errors after all phases

## 7. Risks & Assumptions

- **RISK-001**: Removing borders may reduce visual separation in light mode where surface color contrast is lower — mitigate by ensuring light-mode surface tokens have sufficient contrast between tiers
- **RISK-002**: Manrope font adds ~30-50KB to page load — mitigate with `display=swap` and preconnect hint
- **RISK-003**: The `color-mix()` CSS function (used for glassmorphism) has limited support in older browsers — mitigate with fallback `rgba()` value
- **RISK-004**: Ghost borders at 15% opacity may be invisible on some displays — mitigate by testing on low-quality monitors and increasing to 20% if needed
- **RISK-005**: Replacing hardcoded rgba result backgrounds (green/red/amber at 0.15 opacity) with token-based equivalents may require adding `--win-subtle`, `--loss-subtle`, `--draw-subtle` tokens — adds slightly more tokens but is cleaner
- **ASSUMPTION-001**: The design system intends for Manrope to be used only in display/headline contexts, not body text
- **ASSUMPTION-002**: The "No-Line Rule" applies to decorative boundaries only — form inputs and interactive control outlines are acceptable (per ALT-002)
- **ASSUMPTION-003**: The 4rem button minimum applies only to referee/presenter contexts, not the general pairings/standings UI
- **ASSUMPTION-004**: Existing `--surface`, `--surface-hover`, `--surface-raised` tokens can coexist alongside new `--surface-container-*` tokens during gradual migration

## 8. Related Specifications / Further Reading

- [design.instructions.md](../.github/instructions/design.instructions.md) — The Grandmaster's Ledger design system
- [styling-conventions.instructions.md](../.github/instructions/styling-conventions.instructions.md) — CSS token & scoped style rules
- [a11y.instructions.md](../.github/instructions/a11y.instructions.md) — WCAG 2.2 AA accessibility requirements
- [reusable-components.instructions.md](../.github/instructions/reusable-components.instructions.md) — Component extraction rules
