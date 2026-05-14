---
kind: changed
---
- Internal: finalised the card-identity migration. `card_reviews.pokemon_id` and `grade_log.card_id` are gone, replaced by `(card_type, subject_key)`. No user-visible behaviour change (#462).
