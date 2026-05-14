---
kind: fixed
---
- "Reset all progress" now clears the IndexedDB review session and grade log too — after the #486 storage migration, IDB state survived a reset and Stats / Pasture / Pokédex continued to render pre-reset progress. Fixed by making `clearLocalProgress` async and deleting the IDB keys before dispatching a synthetic storage event so same-tab listeners re-read empty state.
