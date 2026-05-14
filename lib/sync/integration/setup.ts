/**
 * Integration test helpers for Supabase branch lifecycle.
 *
 * Requires:
 *   SUPABASE_ACCESS_TOKEN  — Management API personal access token.
 *   SUPABASE_PROJECT_REF   — The parent project ref (e.g. "abcdefghijklmnop").
 *
 * Creates an ephemeral branch, returns a configured client pair, and tears
 * the branch down when you are done.  The branch is named:
 *   test-<GITHUB_RUN_ID>-<timestamp>
 * so concurrent runs on different PRs don't collide.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN ?? "";
const PROJECT_REF = process.env.SUPABASE_PROJECT_REF ?? "";

/** Milliseconds to wait between polling the branch-ready endpoint. */
const POLL_INTERVAL_MS = 3_000;
/** Maximum time to wait for a branch to become ready before throwing. */
const BRANCH_READY_TIMEOUT_MS = 120_000;

/** Shape returned by the Management API GET /v1/branches/{ref}. */
interface BranchDetails {
  id: string;
  name: string;
  project_ref: string;
  /** "running" once migrations have been applied. */
  status: string;
  db_host?: string;
  anon_key?: string;
  service_role_key?: string;
}

interface BranchListItem {
  id: string;
  name: string;
  project_ref: string;
  status: string;
}

async function managementFetch(
  path: string,
  options: RequestInit = {},
): Promise<unknown> {
  const url = `https://api.supabase.com${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${ACCESS_TOKEN}`,
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "(no body)");
    throw new Error(
      `Management API ${options.method ?? "GET"} ${path} failed with ${res.status}: ${body}`,
    );
  }
  // 204 No Content on delete
  if (res.status === 204) return null;
  return res.json();
}

/** Wait for the branch to reach "running" status, polling every POLL_INTERVAL_MS. */
async function waitForBranchReady(branchId: string): Promise<BranchDetails> {
  const deadline = Date.now() + BRANCH_READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const details = (await managementFetch(
      `/v1/branches/${branchId}`,
    )) as BranchDetails;
    if (details.status === "running") return details;
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error(
    `Branch ${branchId} did not reach 'running' status within ${BRANCH_READY_TIMEOUT_MS}ms`,
  );
}

export interface TestBranch {
  /** Management API branch ID (UUID). */
  branchId: string;
  /** The branch project ref (used to construct the Supabase URL). */
  branchRef: string;
  /** Base URL for the branch, e.g. "https://<branchRef>.supabase.co". */
  branchUrl: string;
  /** Anon key for constructing per-test user clients. */
  anonKey: string;
  /** Anon-key client — mirrors what a browser would use (subject to RLS). */
  client: SupabaseClient;
  /** Service-role client — bypasses RLS; used for test setup/teardown. */
  serviceClient: SupabaseClient;
}

/**
 * Creates an ephemeral Supabase branch, applies all migrations in numeric
 * order, and returns a ready-to-use client pair.
 *
 * Call `teardownTestBranch(branch)` in `afterAll` to clean up.
 */
export async function setupTestBranch(): Promise<TestBranch> {
  if (!ACCESS_TOKEN) throw new Error("SUPABASE_ACCESS_TOKEN is not set");
  if (!PROJECT_REF) throw new Error("SUPABASE_PROJECT_REF is not set");

  const branchName = `test-${process.env.GITHUB_RUN_ID ?? Date.now()}`;

  // Create the branch.
  const created = (await managementFetch(
    `/v1/projects/${PROJECT_REF}/branches`,
    {
      method: "POST",
      body: JSON.stringify({ branch_name: branchName }),
    },
  )) as { id: string; ref: string };

  const branchId = created.id;
  // The branch ref is used to build the Supabase project URL.
  const branchRef = created.ref ?? branchId;

  // Wait until the branch is accepting connections.
  const details = await waitForBranchReady(branchId);

  // Supabase branch URLs follow the same pattern as the parent project:
  // https://<branchRef>.supabase.co
  const branchUrl = `https://${branchRef}.supabase.co`;

  // Keys may be returned on the branch details or must be fetched separately.
  // Fall back to a second GET if not present in the create response.
  const anonKey =
    details.anon_key ??
    ((
      await managementFetch(`/v1/branches/${branchId}`)
    ) as BranchDetails).anon_key;
  const serviceKey =
    details.service_role_key ??
    ((
      await managementFetch(`/v1/branches/${branchId}`)
    ) as BranchDetails).service_role_key;

  if (!anonKey || !serviceKey) {
    throw new Error(
      `Branch ${branchId} did not return API keys. Check Management API response shape.`,
    );
  }

  const client = createClient(branchUrl, anonKey, {
    auth: { persistSession: false },
  });
  const serviceClient = createClient(branchUrl, serviceKey, {
    auth: { persistSession: false },
  });

  return { branchId, branchRef, branchUrl, anonKey, client, serviceClient };
}

/**
 * Deletes the ephemeral branch, cleaning up all DB resources.
 * Safe to call from `afterAll` even when setup failed — it no-ops if
 * branchId is empty.
 */
export async function teardownTestBranch(branch: TestBranch): Promise<void> {
  if (!branch.branchId) return;
  try {
    await managementFetch(`/v1/branches/${branch.branchId}`, {
      method: "DELETE",
    });
  } catch (err) {
    // Log but do not rethrow — a failed teardown should not mask test failures.
    console.warn("[integration] Failed to delete branch:", err);
  }
}
