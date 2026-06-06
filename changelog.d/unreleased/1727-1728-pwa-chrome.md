---
kind: removed
issue: 1727
---
- Removed the Pokéball loading overlay (#pwa-splash) that appeared during PWA boot. Boot-perf work (#1677/#1705) resolved the blank-content gap it was covering, and the literal Pokéball SVG was gratuitous Pokémon branding. The neutral theme background now shows through during hydration. The iOS cold-launch fix (apple-touch-startup-image PNGs) is unaffected.
- Fixed the iOS bottom tab bar detaching from the screen bottom on cold load and snapping into place after the first scroll. Changed `min-h-dvh` to `min-h-[100svh]` on `<body>`: `svh` (URL-bar-expanded height) is correct at first paint, whereas `dvh` (URL-bar-collapsed height) resolved to the wrong value before any scroll reconciled the viewports (#1728).
