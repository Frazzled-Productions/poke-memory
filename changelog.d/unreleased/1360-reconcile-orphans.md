---
kind: added
---
- Added a server-side weekly job (`reconcile_grade_log_orphans`) that auto-heals sync orphans: subjects with graduated grade_log entries but no card_reviews row are given a conservative placeholder row so future client reviews can restore correct FSRS state. Ships in dry-run mode by default; live activation is a deferred manual step after an observation period.
