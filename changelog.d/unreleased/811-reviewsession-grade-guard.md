---
kind: fixed
---
- `ReviewSession` now catches errors thrown by `nextReview` (e.g. a corrupt grade value) and shows a dismissable error banner rather than freezing the UI with locked grade buttons.
