---
kind: added
issue: 1707
---
- Add QA cloud seeder script (`npm run qa:seed-cloud`) that creates five durable named users in the QA Supabase project (`qa-fresh`, `qa-mastery`, `qa-locale`, `qa-streak`, `qa-conflict`) and seeds each with a faithful, cloud-specific dataset via the service-role client. Includes `--dry-run` mode (no network calls or credentials required) and a forcing-function test suite that enforces FSRS bounds, name+reverse pairing, and locale consistency.
