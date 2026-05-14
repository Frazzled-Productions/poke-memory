---
kind: security
---
- Pin `merge_user_settings`'s `search_path` to `''` and qualify table references with `public.`. Matches `reset_all_progress` (migration 018) and clears Supabase advisor lint 0011 for this function.
