---
kind: fixed
---
- Fixed iOS safe-area insets being ignored: added `viewport-fit=cover` to the viewport meta tag so `env(safe-area-inset-*)` resolves correctly on notched iPhones and iPads. The bottom tab bar and page padding now respect the home-indicator strip, and the `black-translucent` status bar no longer clips content in standalone PWA mode.
