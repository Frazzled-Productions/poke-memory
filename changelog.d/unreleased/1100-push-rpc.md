---
kind: changed
issue: 1100
---
- The daily Web Push reminder route now reads through two SECURITY DEFINER RPCs (`get_push_targets`, `get_push_due_cards`, migration 046) instead of raw service-role table SELECTs, narrowing its cross-user read surface to the functions' explicit return contracts.
