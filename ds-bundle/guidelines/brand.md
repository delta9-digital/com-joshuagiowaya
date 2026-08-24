# JGDzine brand guidelines

Personal brand of Joshua Giowaya — developer & designer (jgdzine.com). The look is **grunge-industrial portfolio**: big distressed uppercase display type, angular diamond geometry, photographic dark hero bands, generous light-gray whitespace, and small hits of electric cyan and burnt orange.

## Logo
- `components/Brand/Logo/jg.svg` — color version (blue gradient monogram). Use on light backgrounds.
- `components/Brand/Logo/jg-wht.svg` — white version. Use on dark/photo backgrounds.
- The monogram is an interlocked J/G with a top-down gradient from `--jg-blue` (#2484c6) fading to near-white. Don't recolor, stretch, or add effects.

## Typography hierarchy
1. **Hero statements** — Blackout Sunrise (`.jg-display`), uppercase, huge (`--jg-text-hero`), tight leading. Often overlapping a dark photo band or clipped by angled shapes.
2. **Display alternates** — Blackout Midnight (`.jg-display--midnight`) and Blackout 2AM (`.jg-display--2am`) for variety in stacked lockups and section titles. All Blackout faces are single-weight, uppercase-only in practice.
3. **Section headings / labels / nav / buttons** — Norwester (`.jg-heading`), uppercase, letterspaced.
4. **Body & UI** — Open Sans, 300–800 variable + italic. Default 400; 300 for large intros; 600 for emphasis.

## Color usage
- Light sections sit on `--jg-surface` (#e7e7e9); cards and panels on `--jg-surface-bright`.
- Dark bands use `--jg-ink` (#1d1b1b) with white/near-white type — heroes, footers, photo overlays.
- `--jg-cyan` (#00bdff) is the signature accent: diamond outlines, links, small highlights. Use sparingly — it reads electric against the neutral base.
- `--jg-orange` (#d7481e) is reserved for calls to action.
- `--jg-blue` belongs to the logo; don't use it as a general UI accent.

## Signature motifs
- **Diamond (45°-rotated square)** — `.jg-diamond` outlined in cyan, or `.jg-diamond--solid` filled ink with white Norwester text. Scatter diamonds as interactive markers or use one large solid diamond as a callout.
- **Angled section breaks** — sections meet on diagonals, not horizontals (use `clip-path: polygon(...)` on section edges).
- **Photo duotone tiles** — portfolio grids are dark photo tiles with centered white client logos, dimmed with an ink overlay (`rgba(29,27,27,0.6)`).

## Voice
Confident, terse, uppercase where loud. Headlines are 1–4 words ("DEVELOPER & DESIGNER"). Body copy stays short and plain.
