---
description: "Use when creating, editing, or reviewing Astro components, pages, or layouts. Enforces extracting reusable components for any repeated or self-contained UI pattern."
applyTo: "src/**/*.astro"
---

# Reusable Components

Extract a reusable `.astro` component for **every** self-contained UI pattern — no inline duplication.

## When to extract

- Markup appears (or could appear) in more than one place
- A section has its own visual identity, props, or state
- Error messages, empty states, icons, cards, badges, overlays, or containers that could vary by context
- Shared structures inside layouts (headers, nav bars, footers, QR code blocks) — layouts are not exempt

## Component structure

```astro
---
// 1. Imports
import type { MyType } from "../lib/types";

// 2. Props interface — always typed
interface Props {
  label: string;
  variant?: "primary" | "secondary";
}

// 3. Destructure with defaults
const { label, variant = "primary" } = Astro.props;
---

<!-- 4. Template -->
<div class:list={["wrapper", variant]}>
  {label}
  <slot />
</div>

<!-- 5. Scoped styles using design tokens -->
<style>
  .wrapper {
    padding: var(--space-4);
    border-radius: var(--radius-md);
  }
</style>
```

## Rules

- **One component per file**, PascalCase name matching the file (`ErrorCard.astro` → `<ErrorCard />`)
- **TypeScript `Props` interface** for every component — no untyped props
- **Scoped `<style>` blocks** — use CSS custom properties from `tokens.css`, avoid inline styles
- **`class:list`** for conditional classes, never string concatenation
- **`<slot />`** for composable content instead of passing large HTML via props
- **Keep pages thin** — pages fetch data and compose components, they don't contain reusable markup
