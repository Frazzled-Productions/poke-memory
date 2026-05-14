/**
 * Per-test user helpers for integration tests.
 *
 * `createTestUser` creates a real auth.users row via the service-role admin
 * API and returns a signed-in anon client that operates under that user's
 * identity (respecting RLS).
 *
 * `deleteTestUser` cascades through all FK-linked tables automatically
 * because every table has `ON DELETE CASCADE` on its `user_id` FK.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export interface TestUser {
  id: string;
  email: string;
  /** Anon-key client signed in as this user. Subject to RLS. */
  client: SupabaseClient;
}

let _counter = 0;

function uniqueEmail(): string {
  _counter += 1;
  return `test-user-${Date.now()}-${_counter}@integration.test`;
}

/**
 * Creates an auth user on the branch and returns a signed-in client.
 *
 * @param serviceClient  Service-role client (needed for admin.createUser).
 * @param branchUrl      The branch project URL, e.g. "https://<ref>.supabase.co".
 * @param anonKey        The branch anon key (for the returned signed-in client).
 */
export async function createTestUser(
  serviceClient: SupabaseClient,
  branchUrl: string,
  anonKey: string,
): Promise<TestUser> {
  const email = uniqueEmail();
  const password = "integration-test-password-1!";

  // auth.admin is typed as GoTrueAdminApi inside @supabase/auth-js but is not
  // re-exported from @supabase/supabase-js. Access it via the any escape hatch
  // so we don't have to depend on internal auth-js types.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const adminApi = (serviceClient.auth as unknown as { admin: any }).admin;

  const { data, error } = await adminApi.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (error || !data.user) {
    throw new Error(`createTestUser failed: ${error?.message ?? "no user"}`);
  }

  const userId = data.user.id;

  // Sign in with the anon key to get an authenticated client that honours RLS.
  const userClient = createClient(branchUrl, anonKey, {
    auth: { persistSession: false },
  });

  const { error: signInError } = await userClient.auth.signInWithPassword({
    email,
    password,
  });

  if (signInError) {
    throw new Error(`signInWithPassword failed: ${signInError.message}`);
  }

  return { id: userId, email, client: userClient };
}

/**
 * Deletes a test user. The ON DELETE CASCADE on every table's user_id FK
 * handles row cleanup automatically.
 */
export async function deleteTestUser(
  serviceClient: SupabaseClient,
  userId: string,
): Promise<void> {
  // auth.admin is typed as GoTrueAdminApi inside @supabase/auth-js but is not
  // re-exported from @supabase/supabase-js. Access it via the any escape hatch
  // so we don't have to depend on internal auth-js types.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const adminApi = (serviceClient.auth as unknown as { admin: any }).admin;
  const { error } = await adminApi.deleteUser(userId);
  if (error) {
    // Warn but don't throw — a failed delete shouldn't mask test failures.
    console.warn(`[integration] deleteTestUser(${userId}) failed:`, error);
  }
}
