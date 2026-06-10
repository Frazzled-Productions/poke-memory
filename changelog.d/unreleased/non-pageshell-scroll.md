---
kind: fixed
---
- Fix scroll regression on Settings, /privacy and /terms: the #1801/#1839 app-shell change made `[data-scroll-region]` always `overflow-hidden`, leaving pages that do not use PageShell unable to scroll on mobile.
- Extract `ScrollRegion` client component that reads `usePathname()` and applies `overflow-hidden` only on the Practice route (`/`), `overflow-y-auto` on every other route, and `md:overflow-visible` on desktop.
- Revert PageShell's internal `overflow-y-auto min-h-0` so there is a single scroller per page and no nested double-scroll on PageShell pages (#1801, #1839).
