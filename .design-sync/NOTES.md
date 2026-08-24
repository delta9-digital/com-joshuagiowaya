# design-sync notes — JGDzine Design System

- This repo is NOT a component library — it's an (empty) WordPress workspace. The sync is a hand-authored brand-kit bundle (`shape: "brand-assets"` in config.json), built off-script per the skill's escape hatch. No `_ds_bundle.js`, no `_ds_sync.json` anchor — a re-sync re-verifies/re-uploads everything, which is correct and cheap at this size.
- Source assets came from `.context/attachments/` (Conductor attachments, session-scoped): norwester.otf, Blackout Sunrise/Midnight/2AM ttf, jg.svg, jg-wht.svg, jgwebsite.jpg. Open Sans fetched from Google Fonts (v44 variable, latin, woff2).
- Palette was sampled from the jgwebsite.jpg screenshot: cyan #00bdff (quiz diamonds), orange #d7481e (send button), ink #1d1b1b, surface #e7e7e9/#f4f3f3. Logo blue #2484c6 from the SVG gradient stops.
- `ds-bundle/` is the committed source of truth for the uploaded project; edit it and re-run /design-sync to update.
