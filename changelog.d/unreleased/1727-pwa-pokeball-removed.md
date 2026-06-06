---
kind: removed
issue: 1727
---
- Removed the Pokéball loading overlay (`#pwa-splash`) that appeared during PWA boot. Boot-perf work (#1677/#1705) resolved the blank-content gap it was covering, and the literal Pokéball SVG was gratuitous Pokémon branding. The neutral theme background now shows through during hydration. The iOS cold-launch fix (apple-touch-startup-image PNGs) is unaffected.
