---
kind: fixed
---
- Sign-in conflict picker: "Keep cloud" now stamps `lastPullAt` after applying cloud data. Previously the cursor stayed null, so subsequent background pulls treated every local-with-progress card as authoritative and silently dropped cloud updates indefinitely.
