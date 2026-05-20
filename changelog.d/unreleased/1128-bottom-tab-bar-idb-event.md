---
kind: fixed
---
- Pasture nav guard now reliably appears on mobile-safari after earning a mastered card. The tab bar re-checks mastery whenever a session write commits to IndexedDB, not only on `storage` events (which WebKit does not reliably propagate to same-tab listeners).
