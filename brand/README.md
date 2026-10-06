# Reactive Forge — Logo Guidelines

## 1. The logo

**Idea:** a blocky anvil with a slanted slot and a pointed heel that together spell `/>`, the end of a React component tag. The cyan slash is a component slotted into the forge.

Construction: one angle language, 45° for the heel and base corners and 60° for the slot and slash, on a 256-unit grid with 12-unit gaps.

| Version | File | Use |
|---|---|---|
| Horizontal (primary) | `logo-horizontal.svg` | Headers, README, docs |
| Stacked | `logo-stacked.svg` | Square spaces, title slides |
| Symbol | `symbol.svg` | Avatars, social, where the name is nearby |
| Symbol, small cut | `symbol-small.svg` | 16–24 px (wider slot gaps, thicker slash) |
| Wordmark | `wordmark.svg` | Where the symbol is already shown |

Every version also comes as `-reversed` (dark backgrounds), `-black` and `-white` (one colour).

Web icons are in `icons/`: `favicon.ico`, `favicon.svg`, PNG favicons, `apple-touch-icon.png`, `icon-192/512.png`, `maskable-512.png`, `site.webmanifest`, and `head-snippet.html` with the `<head>` tags.

## 2. Clear space

Keep clear space on every side equal to **the height of the anvil's base block** (32 of 256 units, one eighth of the symbol's canvas). It scales with the logo.

## 3. Minimum size

| Version | Screen | Print |
|---|---|---|
| Horizontal | 120 px wide | 30 mm wide |
| Stacked | 64 px wide | 16 mm wide |
| Symbol | 24 px | 6 mm |
| Symbol below 24 px | use `symbol-small.svg` or `icons/favicon.svg` | — |

## 4. Colour

| Name | Role | HEX | RGB | CMYK (approx.) | Pantone (closest, verify) |
|---|---|---|---|---|---|
| Iron | Ink on light | `#16181D` | 22 24 29 | 24 17 0 89 | Black 6 C |
| Forge Cyan | Slash on light | `#149ECA` | 20 158 202 | 90 22 0 21 | 2995 C |
| Hot Cyan | Slash on dark | `#58C4DC` | 88 196 220 | 60 11 0 14 | 2985 C |
| Ash | Ink on dark | `#F5F5F2` | 245 245 242 | 0 0 1 4 | — |

**Approved pairs:**
- full colour on white or light grey
- reversed (Ash + Hot Cyan) on Iron or other near-black
- black on white
- white on Forge Cyan or on a photo with a calm area

The cyan slash is the only accent. Never use cyan for the anvil itself.

## 5. Typography

- **Wordmark:** Space Grotesk Bold, tracking −1 %, converted to outlines. Don't retype it.
- **Licence:** SIL Open Font License 1.1, so logo use and outlining are allowed.
- **Web text near the logo:** Space Grotesk, or the system stack (`system-ui, sans-serif`).

## 6. Don'ts

- Don't stretch, rotate or mirror the logo. Mirroring breaks the `/>`.
- Don't recolour the parts or swap the slash and anvil colours.
- Don't add shadows, outlines, gradients or glows.
- Don't close the gaps or move the slash out of its slot.
- Don't rearrange or resize the parts of a lockup.
- Don't put the light-ink version on dark backgrounds. Use `-reversed`.

## 7. Notes

- **Trademark:** not cleared yet. Run a trademark search before wider use.
- **Rebuilding:** the masters are hand-built SVG paths. Lockups were generated from Space Grotesk outlines.
- **Board:** `presentation.html` shows the concept, its rationale and mockups.
