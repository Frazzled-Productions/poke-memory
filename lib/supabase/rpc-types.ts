// Typed argument shapes for Supabase RPCs not yet covered by generated types.
// Import these in any file that calls the RPC so parameter shapes stay in sync.

export type MergeUserSettingsArgs = {
  p_user_id: string;
  p_patch: Record<string, unknown>;
};
