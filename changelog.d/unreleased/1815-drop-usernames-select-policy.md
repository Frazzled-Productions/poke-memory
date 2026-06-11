---
kind: security
issue: 1815
---
- Drop the dead `usernames_select_public` RLS policy; all username rows are no longer publicly readable via PostgREST now that the sign-up/sign-in path runs entirely through Server Actions.
