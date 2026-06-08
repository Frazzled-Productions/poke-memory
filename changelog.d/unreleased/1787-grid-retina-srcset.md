---
kind: fixed
issue: 1787
---
- Pokédex grid sprites now render crisply on retina screens (2x/3x DPR). A `srcset` with 1x=64 px, 2x=120 px, and 3x=192 px WebP variants lets the browser pick the sharpest source for the device. The 120 and 192 px files were already in the offline precache, so no extra bytes are added for offline users.
