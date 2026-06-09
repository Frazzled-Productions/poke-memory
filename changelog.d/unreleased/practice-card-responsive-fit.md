---
kind: fixed
---
- Practice: all card variants now shrink to fit the viewport with no scroll and no clipping on any supported device (iPhone SE to iPhone 17 Pro). The SpritePicker 2x2 grid fills the flex-1 card region and scales sprites via `max-h-full / w-auto / object-contain`, so it no longer overflows or clips the queue-state badge on short viewports. The reverse-card variant no longer uses `overflow-y-auto` on the card region. Name, evolution, reverse-evolution, multiple-choice, and typed-entry card sprites use `max-h` instead of fixed `h-` so they can shrink on very short viewports. Builds on #1801 and #1839.
