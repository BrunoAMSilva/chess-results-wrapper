# Design System Document

## 1. Overview & Creative North Star: "The Grandmaster’s Ledger"

This design system is built to transform a high-utility referee tool into an instrument of "Calm Authority." In the high-pressure environment of a chess tournament, the interface must act as a silent, reliable partner.

The **Creative North Star** is **"The Grandmaster’s Ledger."** We move away from the "app-like" feel of generic sports software and toward an editorial, premium experience that mimics the weight and tactile satisfaction of high-end physical objects. By utilizing intentional asymmetry, deep tonal layering, and "physically present" UI elements, we create an atmosphere of quiet confidence. We avoid the "template" look by eschewing standard borders in favor of sophisticated surface shifts that guide the eye with professional precision.

---

## 2. Colors & Surface Philosophy

The palette is rooted in a deep, obsidian foundation, punctuated by the "Authority Gold" of a champion’s trophy and the organic tones of a premium wooden chessboard.

### Tone & Role
* **Surface Hierarchy:** We utilize a "Nested Depth" model.
* **Background (`#131313`)**: The base floor.
* **Surface-Container-Low (`#1c1b1b`)**: Secondary regions.
* **Surface-Container-High (`#2a2a2a`)**: Primary interactive cards.
* **Authority Accents:**
* **Primary (`#fff2d6`) / Primary-Container (`#fcd34d`)**: Use for critical referee actions and high-level status.
* **Secondary-Fixed-Dim (`#e7bdb1`)**: Representing "Walnut/Black" chess assets.
* **Tertiary-Fixed-Dim (`#e1c299`)**: Representing "Tan/White" chess assets.

### The "No-Line" Rule
**Explicit Instruction:** Do not use 1px solid borders to define sections. Boundaries must be defined solely through background color shifts. For example, a result card (`surface-container-high`) should sit on a tournament list background (`surface-container-low`) without a stroke.

### The "Glass & Gradient" Rule
To elevate the "Gold on Dark" aesthetic, use subtle linear gradients (e.g., `primary-fixed-dim` to `primary-container`) on high-importance CTAs. For floating navigation or modal overlays, apply **Glassmorphism**: use `surface-container-highest` at 70% opacity with a `24px` backdrop blur. This ensures the UI feels like a cohesive, physical environment rather than a collection of flat stickers.

---

## 3. Typography: Scannable Authority

The system uses a pairing of **Manrope** for editorial impact and **Inter** for high-utility data density.

* **Display & Headlines (Manrope):** Large, bold, and authoritative. Used for Table Numbers and Round Status. The "Display-LG" (`3.5rem`) is specifically reserved for the primary table number—this must be legible from 5 feet away.
* **Body & Labels (Inter):** Optimized for the rapid scanning of player names and ELO ratings.
* **Intentional Scale:** Use high contrast between `headline-lg` and `label-sm`. The referee needs to know *where* they are (Table 12) and *who* is playing (Player Name) instantly.

---

## 4. Elevation & Depth: Tonal Layering

We reject traditional drop shadows in favor of **Tonal Layering**. Depth is achieved by "stacking" the surface-container tiers from the Spacing Scale.

* **The Layering Principle:** Place a `surface-container-highest` component on a `surface-container-low` section to create a natural, soft lift.
* **Ambient Shadows:** If a floating action button (FAB) or modal requires a shadow, use a large blur (`32px`) at a very low opacity (`6%`). The shadow color should be a tinted version of `on-surface` (`#e5e2e1`) to mimic natural light dispersion on a dark surface.
* **The "Ghost Border" Fallback:** If a container requires further definition for accessibility, use the `outline-variant` token at **15% opacity**. Never use 100% opaque, high-contrast borders.

---

## 5. Components: Tactile Utility

### Buttons (The Tactile Object)
Buttons should feel like physical switches.
* **Primary:** Uses a subtle gradient of `primary-fixed-dim` to `primary-container`. Use `lg` (1rem) roundedness.
* **Secondary:** `surface-container-highest` background with `on-surface` text.
* **Sizing:** All tap targets for referee input must be a minimum of `12` (`4rem`) in height to facilitate one-handed use during floor walks.

### Cards & Result Lists
* **Constraint:** No divider lines. Separate "Board Rows" using vertical whitespace from the Spacing Scale (`2` or `3`).
* **Visual Soul:** Use a vertical accent bar (4px wide) on the left side of a card using `primary-container` to indicate the "Active Table" or the "Current Selection."

### Chess Status Indicators
* **White Win:** Use `tertiary-fixed-dim` container.
* **Black Win:** Use `secondary-fixed-dim` container.
* **Draw:** Use `surface-container-highest` with `outline` ghost border.

### Table Selectors (Signature Component)
Large-scale grid items using `display-lg` numbers. When selected, the background shifts to `primary-container` and the number to `on-primary-fixed`, creating an undeniable "Authority" state.

---

## 6. Do's and Don'ts

### Do
* **Do** use `16` (`5.5rem`) spacing for page-level margins to create an editorial, premium feel.
* **Do** rely on font weight (Manrope Bold) and color (`primary-container`) to create hierarchy before adding any structural elements.
* **Do** ensure all "Result Input" buttons are reachable by a thumb on a 6.7-inch device.

### Don't
* **Don't** use pure white (`#FFFFFF`) for text. Always use `on-surface` (`#e5e2e1`) to reduce eye strain in dimly lit tournament halls.
* **Don't** use standard Material Design "elevations" with harsh shadows. If it doesn't look like a physical layer of matte material, it’s too "digital."
* **Don't** use 1px dividers between list items. Use the `surface-container` shifts.```