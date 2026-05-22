---
kind: changed
---
- Practice: added a "Wait for audio before next card" toggle in Settings (Audio section). When off, the next card appears immediately after grading and any in-progress cry or spoken name continues playing under it. Default on, preserving existing behaviour. Also tightened the sprite-decode ceiling on the grade critical path from 500 ms to 150 ms and removed two redundant settings reads per grade.
