---
kind: security
---
- `rls_auto_enable()` SECURITY DEFINER function is no longer callable via the REST API by `anon` or `authenticated`. The function is a leftover DDL event-trigger helper that operates on `pg_event_trigger_ddl_commands()` (no-op outside an event trigger), but exposing it via `/rest/v1/rpc/rls_auto_enable` was unnecessary attack surface. EXECUTE is now revoked from PUBLIC, anon, and authenticated; the function remains callable by privileged roles (postgres).
