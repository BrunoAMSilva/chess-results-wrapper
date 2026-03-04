---
description: "Use when writing or reviewing CSS styles in Astro components, pages, or layouts. Enforces design token usage, scoped styles, and bans inline styles and hardcoded values."
applyTo: "src/**/*.astro"
---

# Styling Conventions

All visual styling must use the project's design token system and scoped `<style>` blocks.

## Design tokens

Use CSS custom properties from `src/styles/tokens.css` — never hardcode raw values.

| Category | Token pattern | Example |
|----------|---------------|---------|
| Spacing | `--space-{0-12}` | `padding: var(--space-4)` |
| Font size | `--text-{xs,sm,base,lg,xl,2xl,3xl,4xl}` | `font-size: var(--text-sm)` |
| Font weight | `--font-{normal,medium,semibold,bold,extrabold}` | `font-weight: var(--font-semibold)` |
| Radius | `--radius-{sm,md,lg,xl,full}` | `border-radius: var(--radius-md)` |
| Shadow | `--shadow-{sm,md,lg,xl,card,elevated}` | `box-shadow: var(--shadow-card)` |
| Color | `--text`, `--text-dim`, `--surface`, `--border`, `--accent-*` | `color: var(--text-dim)` |
| Duration | `--duration-{fast,normal,slow}` | `transition-duration: var(--duration-fast)` |
| Easing | `--ease-out`, `--ease-in-out` | `transition-timing-function: var(--ease-out)` |

If a needed token doesn't exist, add it to `tokens.css` rather than hardcoding.

## Rules

1. **Scoped styles only** — use `<style>` blocks inside components; avoid adding rules to `global.css` unless they are truly global (resets, animations, base typography)
2. **No inline `style=` attributes** — move all styling to scoped CSS classes. For dynamic values (e.g., animation delays), use CSS custom properties set via `style={`--delay: ${delay}ms`}` and reference them in scoped CSS: `animation-delay: var(--delay)`
3. **No hardcoded colors** — use semantic tokens (`--text`, `--surface`, `--border`, `--accent-*`). Theme switching depends on all colors coming from tokens
4. **No hardcoded pixel values** — use spacing tokens for padding/margin/gap, text tokens for font sizes, radius tokens for border-radius
5. **No `!important`** — fix specificity issues by restructuring selectors instead
6. **`class:list` for conditional classes** — never concatenate class strings manually
7. **Theme-aware** — all new tokens must have both dark and light variants in `tokens.css` under `[data-theme="light"]`

## Dynamic values pattern

```astro
<!-- ✅ Correct: CSS custom property bridge -->
<div class="card" style={`--delay: ${index * 40}ms`}>

<style>
  .card { animation-delay: var(--delay); }
</style>

<!-- ❌ Wrong: inline style -->
<div style={`animation-delay: ${index * 40}ms`}>
```

## Dynamic colors pattern

```astro
<!-- ✅ Correct: map to a class -->
<span class:list={["score", { win: isWin, loss: isLoss }]}>

<style>
  .score { color: var(--text); }
  .win   { color: var(--green-400); }
  .loss  { color: var(--red-400); }
</style>

<!-- ❌ Wrong: inline color -->
<span style={`color: ${scoreColor}`}>
```
