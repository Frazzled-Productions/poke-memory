---
kind: fixed
issue: 1854
---
- Closed six superuser write-guard gaps: sign-in callback no longer uploads QA-seeded cards; Pasture mark-seen respects the guard; Settings regional-prefs pushes are suppressed while any flag is on; a persisted cleanup-pending marker keeps writes suppressed throughout `exitCleanup` so a degraded pull cannot allow seeded data to reach Supabase; the guest destructive reset now clears all seeded state (streak, protection tokens, grade log, mastered-count cache) via `clearSeedScenario`; the QA-seed active indicator now survives a cancelled or failed cleanup; and the Cmd/Ctrl+Z undo handler captures the current guard value rather than a stale closure.
