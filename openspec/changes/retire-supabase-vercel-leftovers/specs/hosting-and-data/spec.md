## REMOVED Requirements

### Requirement: A rehearsable copy moves Supabase data into D1 and checks row counts

**Reason**: The live copy ran at the cutover (#2393) and the Supabase projects were deleted on 20 November 2026 (ops #610), so there is nothing left to copy from.

**Migration**: none; `scripts/cloudflare/copy-from-supabase.mjs`, its test and `compare-counts.mjs` are deleted. The final dumps are in the EU R2 bucket `poke-memory-backups` (their expiry is ops #611).

### Requirement: The copy maps accounts and passwords and copies no sessions

**Reason**: Describes the deleted copy script. The accounts it copied keep working: `lib/auth/password.ts` still verifies their bcrypt hashes.

**Migration**: none.
