---
kind: changed
---
- Refactor card identity from integer `pokemon_id` to `(card_type, subject_key)` string pair; sync conflict key updated to the composite natural key (behavior-preserving, no user-visible change).
