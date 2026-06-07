---
kind: changed
issue: 1740
---
- Offline precache reduced from ~212 MB to ~67.5 MB (drops ~144.6 MB, 68%) by switching the Pokédex grid to the pre-generated 64 px WebP sprites already in the precache, and removing raw PNGs from the precache list. Offline Pokédex browsing is unchanged.
