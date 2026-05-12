---
kind: security
---
- Added a Postgres trigger on `card_reviews` that rejects sync writes which would un-review or un-see a card, or move a card's `last_review` date backward. Protects cloud progress from being clobbered by a buggy client.
