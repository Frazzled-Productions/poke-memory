---
kind: fixed
issue: 1789
---
- Offline precache now downloads only the 9 WebP widths used by offline-reachable surfaces (drops the 180 px `ThemeWatermark` decorative variant), cutting the precache from ~67.5 MB to ~59.7 MB of actual file bytes.
