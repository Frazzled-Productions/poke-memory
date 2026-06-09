---
kind: fixed
---
- Fixed Practice content being clipped and scrollable on mobile after the #1801 app-shell change. Scroll ownership is now per-page: the app-shell fit region is `overflow-hidden` (no scroll, Practice fits); pages that need to scroll (Pokédex, Pasture, Stats, etc.) own their own `overflow-y-auto` inside the PageShell `<main>` element.
