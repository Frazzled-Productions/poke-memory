---
kind: fixed
issue: 1803
---
- Fixed the ~6-second blank (black) screen on PWA cold launch. The cause was the Practice cold-boot session build calling `new Intl.DateTimeFormat(...)` once per card (via the SRS scheduler's date helpers), thousands of constructions that blocked the main thread before first paint. The per-timezone formatter is now cached, collapsing the per-card date cost from ~147ms to ~4ms per session-build pass over the full deck and removing the main-thread block.
