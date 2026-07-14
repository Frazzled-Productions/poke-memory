# README screenshots and animations

Canonical runbook for the README media summarised in AGENTS.md (Screenshots).

The README shows six screenshots
(`docs/screenshots/{practice-front,practice-flipped,pokedex-grid,pasture,stats,journey}.png`), all
captured at the **iPhone 17 Pro viewport** (402×874 CSS px @ 3× DPR). Script:
`scripts/capture-screenshots.mjs` (`npm run screenshots`).

## Rule

When a change visibly affects any of those six surfaces (`app/page.tsx`, `app/pokedex/**`,
`app/pasture/**`, `app/stats/**`, `app/journey/**`, or a rendered `components/**`), regenerate the
affected screenshot(s) and commit them in the same PR. **macOS only** - CI does not regenerate
(Linux font anti-aliasing differs).

```bash
npm run dev &                          # in another terminal / background
npm run screenshots                    # all six
npm run screenshots -- --page=pasture  # one surface
```

A deterministic lived-in seed (`scripts/screenshot-seed.mjs`, #1296) makes renders reproducible.
Don't change the viewport, DPR, or surface list without regenerating every screenshot in the same
commit.

## Animations

`npm run animations` (`scripts/capture-animations.mjs`) produces the card-flip GIF
(`docs/screenshots/practice-cardflip.gif`), same seed/viewport, macOS only, requires ffmpeg. Each
animation file must stay under **4 MB**.
