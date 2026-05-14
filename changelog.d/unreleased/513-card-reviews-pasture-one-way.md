---
kind: fixed
---
- DB regression trigger now rejects `card_reviews` updates that flip `seen_in_pasture` from `true` to `false` — there's no legitimate "un-acknowledge" path, so this transition was always a sync bug.
