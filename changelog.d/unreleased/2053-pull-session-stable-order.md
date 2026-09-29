---
kind: fixed
issue: 2053
---
- Cloud pulls of card reviews and streak days now use a stable sort order across pages, so a concurrent write can no longer silently drop a card from a sync.
