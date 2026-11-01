// Typed argument shapes for Supabase RPCs not yet covered by generated types.
// Import these in any file that calls the RPC so parameter shapes stay in sync.

import type { PostgrestError } from "@supabase/supabase-js";

export type MergeUserSettingsArgs = {
  p_user_id: string;
  p_patch: Record<string, unknown>;
};

// Narrow function-shape type for the merge_user_settings RPC.
// Keep the cast on the *call expression* (not a separate const) so the JS
// member-access reference is preserved and `this` binds to `client` - 
// extracting to a local const would strip `this` and SupabaseClient.rpc reads
// `this.rest` on every call.
export type MergeUserSettingsRpc = (
  name: "merge_user_settings",
  args: MergeUserSettingsArgs,
) => Promise<{ error: PostgrestError | null }>;

// The same call-expression rule applies to the two below.

// check_rate_limit (migration 041, actions in RATE_LIMIT_ACTIONS): true when the
// attempt is within the cap.
export type CheckRateLimitRpc = (
  name: "check_rate_limit",
  args: { p_ip_hash: string; p_action: string },
) => Promise<{ data: boolean | null; error: PostgrestError | null }>;

// claim_optimizer_slot (migration 050): 0 when claimed, otherwise the
// milliseconds until the slot frees up.
export type ClaimOptimizerSlotRpc = (
  name: "claim_optimizer_slot",
) => Promise<{ data: number | null; error: PostgrestError | null }>;
