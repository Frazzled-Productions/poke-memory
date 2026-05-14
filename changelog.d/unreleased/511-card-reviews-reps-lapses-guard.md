---
kind: fixed
---
- DB regression trigger now rejects `card_reviews` updates that decrease `reps` or `lapses`, blocking a class of sync-bug clobbers that would degrade FSRS scheduling state.
