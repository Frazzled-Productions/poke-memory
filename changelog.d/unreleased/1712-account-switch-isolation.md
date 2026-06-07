---
kind: fixed
issue: 1712
---
- Fixed multi-user data isolation: switching accounts on one device no longer blends one user's cards, streak, grade log, or settings into another's session, and no longer pushes the blended state to the incoming user's cloud account. Outgoing user's local data is preserved in a per-user archive so it is restored if they sign back in.
