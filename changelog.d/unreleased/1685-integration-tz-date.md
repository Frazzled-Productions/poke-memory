---
kind: fixed
issue: 1685
---
- Integration tests no longer false-fail when run in a non-UTC timezone. Postgres `date` columns are now read back via local date components (a shared `pgDateToISO` helper) instead of `toISOString().slice(0, 10)`, which shifted the day in timezones behind UTC. Affects `pull-and-merge` and `reconcile-orphans`.
