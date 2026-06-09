---
kind: fixed
---

Fixed the Practice-page bottom tab bar detach on real iOS (standalone PWA). The bar sat 21px above the visible screen bottom because `position:fixed; bottom:0` resolves to `innerHeight` (853px) while the visible screen is `screen.height` (874px) on a non-scrolling page. Converted to an in-flow app-shell: body is `h-[100lvh]` on mobile (`lvh` = large viewport height = 874px, the only unit that reaches the true visible bottom), with an internal scroll region and the tab bar as the last in-flow flex child. Desktop reverts to normal document scroll (`md:h-auto md:min-h-[100svh] md:overflow-visible`).
