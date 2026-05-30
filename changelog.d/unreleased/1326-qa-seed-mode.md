---
kind: added
---
- QA seed mode: a superuser-only developer tool that injects named scenario payloads into local storage for manual QA on preview deployments. Enable the "QA seed mode" flag in Settings > Advanced > Developer, pick a scenario, and click "Apply seed". Available scenarios: `fsrs-locale-mastery` (verify locale-aware FSRS reset), `optimiser-stress` (verify the FSRS optimiser endpoint), and `pasture-progression` (verify Pasture with real data). Local-only; sync write-guard prevents seeded data from reaching Supabase.
