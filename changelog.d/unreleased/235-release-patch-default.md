---
kind: fixed
---
- Restore patch-by-default release bumps under the fragment-based workflow; PR 234 inadvertently reverted PR 230 by treating `added/changed/removed/deprecated` fragments as minor bumps. Minor is now opt-in only via a `kind: minor-bump` fragment.
