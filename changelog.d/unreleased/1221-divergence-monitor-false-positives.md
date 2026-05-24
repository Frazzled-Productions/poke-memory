---
kind: fixed
---
- Monitoring no longer alerts on in-step cards: the grade_log vs card_reviews divergence check now applies a 2-day persistence window to the "row never written" query, and adds a second query that catches the "row exists but is stuck" failure shape.
