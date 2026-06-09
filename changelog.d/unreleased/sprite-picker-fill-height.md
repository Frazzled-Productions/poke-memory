---
kind: fixed
---

Fix pick-the-sprite card clipping top pill and bottom controls on real iPhones (#1801, #1840).

`ReviewCardLayout`'s card-region wrapper used `items-center`, which centred `SpritePicker` at its natural height rather than stretching it to fill the `flex-1` wrapper. The `SpritePicker`'s internal `flex-1 min-h-0` chain therefore never received a constrained height to shrink within, so the 2x2 grid stayed full-size, the outer column overflowed, and `overflow-hidden` clipped the queue-state pill at the top and the queue counters at the bottom. Fixed by adding `self-stretch h-full min-h-0` to the `SpritePicker` root so it actually fills the available height. The clip-bounds e2e assertion is updated to check real element positions rather than `scrollHeight <= clientHeight` (which is always true under `overflow-hidden` and proves nothing).
