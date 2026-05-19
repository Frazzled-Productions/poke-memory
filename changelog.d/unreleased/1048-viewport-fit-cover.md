---
kind: fixed
---
- Fixed iOS safe-area insets being ignored: added `viewport-fit=cover` to the viewport meta tag so `env(safe-area-inset-*)` resolves correctly on notched iPhones and iPads. The bottom tab bar and page padding now respect the home-indicator strip, and the Nav header now clears the status bar and Dynamic Island in standalone PWA mode, so no content sits under the status bar overlay.
