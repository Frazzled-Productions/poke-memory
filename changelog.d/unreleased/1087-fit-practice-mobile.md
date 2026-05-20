---
kind: fixed
---
- Practice page no longer requires scrolling on iPhone 17 Pro in default mobile bottom-nav mode (#1104, follow-up to #1087). The 100dvh page-height anchor (added for #1086 to keep the bottom tab bar in place) now lives on `<body>`, so the wrapper can shrink to fit alongside the top nav and any sibling banners instead of forcing every page to overflow by ~200px.
- Grade buttons now always render on a single row at mobile widths. Easy was wrapping to a second line on iPhone 17 Pro because the per-button minimum width plus gaps overshot the available width by ~10px; the row uses a four-column grid on mobile and falls back to the original wrap layout at sm+.
- The card no longer drifts upward when the user taps Reveal. The card region anchors the sprite to the top of its space on mobile, so the empty area sits below the card instead of being split above and below: revealing adds the name and Pokédex entry beneath the sprite without moving it.
