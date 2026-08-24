# JGDzine — how to build with this kit

This is a **brand kit, not a component library**: there is no JS bundle and no `window.*` runtime components. Build screens with plain HTML/JSX styled by `styles.css` — everything below ships in that file's `@import` closure (tokens + fonts + utility classes), so no extra setup or wrapper is needed.

## Styling idiom
Use the CSS custom properties from `tokens/colors.css` / `tokens/typography.css` (`var(--jg-*)`) plus the small utility-class vocabulary in `styles.css`. Write your own layout CSS freely, but pull every color and font from tokens.

**Classes:** `.jg-display` (+ `--midnight`, `--2am`), `.jg-heading`, `.jg-diamond` (+ `--solid`), `.jg-btn` (+ `--cta`).
**Color tokens:** `--jg-ink`, `--jg-charcoal`, `--jg-gray-600`, `--jg-gray-300`, `--jg-surface`, `--jg-surface-bright`, `--jg-white`, `--jg-cyan`, `--jg-blue`, `--jg-blue-light`, `--jg-orange`, `--jg-logo-gradient`, plus aliases `--jg-bg`, `--jg-bg-dark`, `--jg-text`, `--jg-text-muted`, `--jg-text-on-dark`, `--jg-accent`, `--jg-cta`.
**Font tokens:** `--jg-font-display`, `--jg-font-display-alt`, `--jg-font-display-open`, `--jg-font-heading`, `--jg-font-body`; sizes `--jg-text-xs` … `--jg-text-2xl`, `--jg-text-hero`.

## Rules that keep it on-brand
- Display faces (Blackout trio) and Norwester are **uppercase only**, single weight — never bold/italicize them; sentence-case text always goes in Open Sans.
- Cyan `--jg-cyan` = accent details only; orange `--jg-orange` = CTAs only; `--jg-blue` = logo only.
- Dark sections: `background: var(--jg-bg-dark); color: var(--jg-text-on-dark)`.
- Prefer diagonal section joins (`clip-path`) and the `.jg-diamond` motif over rounded-corner card aesthetics. Corners are square; radius ≤ 2px.
- Logos: `components/Brand/Logo/jg.svg` on light, `jg-wht.svg` on dark.

## Where the truth lives
Read `styles.css` (and its `tokens/*.css` imports) before styling; usage details in `guidelines/brand.md`.

## Idiomatic snippet
```html
<section style="background: var(--jg-bg-dark); color: var(--jg-text-on-dark); padding: 4rem 2rem; clip-path: polygon(0 0, 100% 4rem, 100% 100%, 0 100%);">
  <h1 class="jg-display" style="font-size: var(--jg-text-hero); margin: 0;">Developer<br>&amp; Designer</h1>
  <p style="max-width: 40ch; color: var(--jg-gray-300);">Building sharp, fast sites from Minneapolis.</p>
  <button class="jg-btn jg-btn--cta">See the work</button>
</section>
```

---

## Bundle contents
- `styles.css` — entry stylesheet: @font-face for all six font files, token imports, base + utility classes.
- `tokens/colors.css`, `tokens/typography.css` — the `--jg-*` custom properties.
- `fonts/` — Norwester, Blackout Sunrise/Midnight/2AM, Open Sans variable (roman + italic), all woff2.
- `components/Brand/Logo/` — jg.svg (color), jg-wht.svg (white) + preview.
- `components/Brand/Motifs/` — diamond motif and button styles preview.
- `components/Type/` — display/heading and body type specimens.
- `components/Colors/Palette/` — full palette with token names.
- `guidelines/brand.md` — full brand guidelines.

Provenance: hand-authored from Joshua Giowaya's brand assets (font files, JG logo SVGs) and the jgdzine.com site design, 2026-08-24.
