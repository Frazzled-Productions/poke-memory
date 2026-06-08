---
kind: security
issue: 1799
---
- DB security audit: add explicit deny-all SELECT policy on `feedback` to document service-role-only intent; revoke `authenticated` execute on `reconcile_grade_log_orphans` maintenance RPC; document `delete_account`/`reset_all_progress` as intended SECURITY DEFINER; note `pg_net`-in-public WONTFIX.
