---
kind: fixed
issue: 1855
---
- GDPR data export now paginates the grade_log fetch, ensuring users with more than 1000 reviews receive a complete export (previously silently truncated at the PostgREST 1000-row cap).
- `pullGradeLog` and `pullStreak` paginate to completion so a fresh device always receives the full review history and streak history rather than only the oldest 1000 rows.
- The daily push notification route paginates the due-card query and adds an ORDER BY for deterministic offset pagination, preventing large backlogs from being miscounted or skipped.
- The FSRS optimiser fetches the full grade log rather than only the oldest 1000 rows, so personalised weights reflect the user's complete review history.
- A shared `fetchAllPages` helper (`lib/sync/paginatedFetch.ts`) provides a tested, client-agnostic pagination loop so future queries do not silently re-introduce the cap.
