---
kind: fixed
---
- Fixed the Practice-page bottom tab bar floating ~21px above the bottom of the screen on iOS (it now sits flush). The bottom nav is an in-flow app-shell child anchored to the large viewport (`lvh`) instead of `position:fixed`, so it reaches the true visible bottom on non-scrolling pages.
- On desktop (md+) the layout reverts to normal document scroll so existing scrollable pages are unaffected.
