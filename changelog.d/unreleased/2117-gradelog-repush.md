---
kind: fixed
issue: 2117
---
- Signed-in grade history entries that failed to reach the cloud (offline, tab closed, or held for undo across a reload) are now re-sent on the next sync, so other devices and Stats no longer under-count them.
