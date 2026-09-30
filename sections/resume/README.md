# Résumé section

Portfolio résumé section for joshuagiowaya.com, built on the JGDzine brand kit in `../../ds-bundle/`.

| File | What it is |
| --- | --- |
| `resume.css` | Section styles. Every color and font comes from the `--jg-*` tokens; no values are hard-coded. |
| `resume.html` | Standalone preview. Open it in a browser (it links the brand kit relatively) to see the section, or use it as the source of truth for markup. |
| `resume-pattern.php` | The same section as a WordPress block pattern (`jgdzine/resume`), ready for a block theme's `patterns/` folder. |

## Layout

1. **Header band** — ink background, diagonal bottom edge (`clip-path`), Blackout Sunrise title, Open Sans 300 intro, orange "Download PDF" CTA, and three diamond stat callouts.
2. **Experience timeline** — vertical rule with cyan diamond markers. Current roles use a solid ink marker. Dates in Norwester, role in Norwester, org and bullets in Open Sans.
3. **Sidebar** — Skills (square Norwester chips grouped by area), Focus, and Reach me, each on a `--jg-surface-bright` panel with an ink top rule.

Collapses to a single column under 56rem. Timeline entries stagger in on scroll when JS is present and the user hasn't asked for reduced motion; without JS everything is simply visible.

## Installing in WordPress

1. Copy `resume-pattern.php` into the active block theme's `patterns/` directory.
2. Enqueue the brand kit and this stylesheet from `functions.php`:

```php
add_action( 'wp_enqueue_scripts', function () {
    wp_enqueue_style( 'jg-brand', get_theme_file_uri( 'assets/ds-bundle/styles.css' ), [], '1.0' );
    wp_enqueue_style( 'jg-resume', get_theme_file_uri( 'assets/css/resume.css' ), [ 'jg-brand' ], '1.0' );
} );
```

   Copy `ds-bundle/` into the theme's `assets/` folder so the relative `fonts/` and `tokens/` imports in `styles.css` resolve.

3. In the Site Editor, insert the **Résumé** pattern (category "JGDzine") on the About or Résumé page.
4. Optional: add the scroll-reveal script from the bottom of `resume.html` to the theme's JS, or leave it out.

Validate the pattern before shipping if Block Runner is available:

```sh
npx block-runner validate sections/resume/resume-pattern.php --strict
```

## Content

Work history, skills, and contact details were taken from Joshua's résumé (the same source as `resume/index.html`): Yardstik, Self Esteem Brands, Code42, Linnihan Foy, Rocket55, The Alt Bike and Board, and Shop Jimmy, 2009 to present. Each timeline entry keeps two or three headline bullets; the full bullet lists live in the standalone `resume/` page.

Still to set:

- Download PDF link: upload the résumé PDF to the Media Library and replace `/wp-content/uploads/joshua-giowaya-resume.pdf`.
- Add a LinkedIn link to the "Reach me" list if wanted.
- Trim the skill chips if the list feels long for the sidebar.

## Brand rules honored

- Display faces and Norwester are uppercase, single weight; sentence-case text is Open Sans.
- Cyan is accent-only (markers, eyebrow, label rules). Orange is CTA-only. Logo blue is unused.
- Corners are square; the diamond motif and a diagonal section join carry the brand geometry.
