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
