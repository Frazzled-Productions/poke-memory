import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { syntheticEmail } from "@/lib/auth/username";
import { addOnboardingPreDismiss } from "./helpers/onboarding";

/**
 * Real-auth E2E (#1710) - the durable guard for the username/password door.
 *
 * Unlike e2e/auth.spec.ts (which drives the test-only mock-auth seam against a
 * preview), this spec exercises REAL Supabase auth against a dedicated QA
 * project. It is the end-to-end regression net for #1709: sign-up succeeded
 * server-side but the signed-in UI never reflected it until the SignInSheet was
 * fixed to do a full navigation after the server action. A unit test guards the
 * fix; this spec guards the whole flow in a real browser against a real DB.
 *
 * RUN MODEL
 *   - Built + served on localhost with the QA NEXT_PUBLIC_SUPABASE_* env baked
 *     in at build time (NEXT_PUBLIC_* are inlined by Next at build). No Vercel
 *     SSO is involved. CI wires this in the `e2e-real-auth` job in ci.yml.
 *   - Runs chromium only (real auth does not need the mobile-safari matrix).
 *
 * EPHEMERAL USER + TEARDOWN
 *   - A unique username is generated per run (E2E_RUN_ID from CI, with a
 *     timestamp+random fallback for local runs) so concurrent / repeated runs
 *     never collide and no fixed account accretes data.
 *   - Teardown calls the authenticated `delete_account()` RPC (migration 027,
 *     SECURITY DEFINER, deletes auth.uid() and cascades to every data table).
 *     It needs ONLY the anon key: a fresh supabase-js client signs in as the
 *     ephemeral user and calls the RPC. No service-role secret is required.
 *   - Teardown runs in afterAll unconditionally (even if the test body failed)
 *     so a failure never leaves a QA user behind.
 *
 * QA-vs-PROD SAFETY
 *   - The suite asserts the build's Supabase URL is the QA URL and is NOT the
 *     production URL before doing anything. Production secrets are never set in
 *     this job.
 *
 * KNOWN PREREQUISITE (maintainer action)
 *   - The QA project MUST have "Confirm email" DISABLED in its Auth settings.
 *     The username door derives a synthetic, non-routable email, so a
 *     confirmation mail can never be received; with confirmation enabled,
 *     signUp returns no session and sign-in can never complete. If that is the
 *     case this spec fails FAST with a clear message rather than a cryptic
 *     timeout. Production has it disabled; QA must match.
 */

// NEXT_PUBLIC_SUPABASE_URL / _ANON_KEY are inlined into the client bundle at
// build time, but the spec runs in the Playwright Node process, so it reads the
// same names from its own environment. The `e2e-real-auth` CI job sets both for
// the build step AND exports them to the Playwright step.
const QA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const QA_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// The production Supabase URL. Asserting the test URL differs from this is the
// belt-and-braces guard that the job never points at production. Kept as a
// substring check on the project ref so a trailing slash / path cannot defeat it.
const PROD_SUPABASE_URL_REF = "nvxvvtvnthsgdxgksmju"; // poke-memory production project ref

// A password comfortably above MIN_PASSWORD_LENGTH (8). Never logged.
const E2E_PASSWORD = "e2e-real-auth-pw-2026";

/**
 * Per-run unique username. CI passes E2E_RUN_ID (the GitHub run id + attempt);
 * locally we fall back to a timestamp + random suffix. Lowercased and trimmed
 * to the username CHECK constraint ([a-z0-9_-]{3,30}).
 */
function makeUsername(): string {
  const seed =
    process.env.E2E_RUN_ID ??
    `${Date.now().toString(36)}${randomUUID().replace(/-/g, "").slice(0, 6)}`;
  // Strip to allowed chars, prefix with a fixed marker so QA rows are
  // identifiable, and clamp to 30 chars.
  const cleaned = `e2e_${seed}`.toLowerCase().replace(/[^a-z0-9_-]/g, "");
  return cleaned.slice(0, 30);
}

const username = makeUsername();

/** A fresh anon-key client used for the RLS round-trip and teardown. */
let nodeClient: SupabaseClient | null = null;

test.describe("Real auth: username door against the QA database (#1710)", () => {
  // Run serially: sign-up happens once, then the RLS round-trip reuses the same
  // ephemeral user. Parallelism would race on the single account.
  test.describe.configure({ mode: "serial" });

  test.beforeAll(() => {
    // Fail fast and loud if the QA env is missing - this job must run with it.
    if (!QA_URL || !QA_ANON_KEY) {
      throw new Error(
        "auth-real.spec requires NEXT_PUBLIC_SUPABASE_URL and " +
          "NEXT_PUBLIC_SUPABASE_ANON_KEY to point at the QA Supabase project. " +
          "These are set by the e2e-real-auth CI job from the QA_* GitHub secrets.",
      );
    }
    // QA-vs-prod safety: never target production.
    if (QA_URL.includes(PROD_SUPABASE_URL_REF)) {
      throw new Error(
        "auth-real.spec refuses to run: NEXT_PUBLIC_SUPABASE_URL points at the " +
          "PRODUCTION Supabase project. This spec creates and deletes accounts " +
          "and must only ever run against QA.",
      );
    }
    nodeClient = createClient(QA_URL, QA_ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  });

  test.afterAll(async () => {
    // Teardown: sign in as the ephemeral user with a fresh anon-key client and
    // call delete_account(). Runs even if the test body failed so no QA user
    // accretes. Best-effort: log but do not throw, so a teardown hiccup does
    // not mask the real test result.
    if (!nodeClient || !QA_URL || !QA_ANON_KEY) return;
    try {
      const teardownClient = createClient(QA_URL, QA_ANON_KEY, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const email = syntheticEmail(username);
      const { error: signInErr } = await teardownClient.auth.signInWithPassword({
        email,
        password: E2E_PASSWORD,
      });
      if (signInErr) {
        // The user may never have been created (sign-up failed). Nothing to clean.
        console.warn(
          `[auth-real teardown] could not sign in as '${username}' to delete - ` +
            `likely never created: ${signInErr.message}`,
        );
        return;
      }
      const { error: rpcErr } = await teardownClient.rpc("delete_account");
      if (rpcErr) {
        console.error(
          `[auth-real teardown] delete_account RPC failed for '${username}': ${rpcErr.message}`,
        );
      }
      await teardownClient.auth.signOut();
    } catch (err) {
      console.error("[auth-real teardown] threw:", err);
    }
  });

  test("sign up via the username door and the UI reflects the signed-in state", async ({
    page,
  }) => {
    await addOnboardingPreDismiss(page);
    await page.goto("/");

    // The guest AuthButton renders the "Sign in" trigger. If it is absent the
    // build has no Supabase env - that means the QA env was NOT baked in, which
    // is a hard failure for this job (do not silently skip).
    const signIn = page.getByRole("button", { name: "Sign in" });
    await expect(
      signIn,
      "Sign in trigger missing - the build lacks NEXT_PUBLIC_SUPABASE_* (QA env not baked in)",
    ).toBeVisible({ timeout: 15_000 });

    await signIn.click();

    // The SignInSheet opens; the username door is in sign-up mode by default.
    const dialog = page.getByRole("dialog", { name: /keep your progress safe/i });
    await expect(dialog).toBeVisible();

    await dialog.getByLabel("Username").fill(username);
    await dialog.getByLabel("Password").fill(E2E_PASSWORD);
    await dialog.getByRole("button", { name: "Create account" }).click();

    // The fix for #1709: the server action sets the session cookie and the
    // SignInSheet does a full navigation, so the signed-in UI ("Sign out")
    // appears WITHOUT a manual reload. This is the exact regression we guard.
    //
    // If the QA project has "Confirm email" ENABLED, signUp returns no session,
    // signUpWithUsername returns signup_failed, and the inline error renders
    // instead of the signed-in nav. Detect that and fail with a clear message.
    const signOut = page.getByRole("button", { name: "Sign out" });
    const signupFailed = dialog.getByRole("alert");

    await expect(async () => {
      const signedIn = await signOut.isVisible().catch(() => false);
      const errored = await signupFailed.isVisible().catch(() => false);
      expect(
        signedIn || errored,
        "Neither the signed-in nav nor a sign-up error appeared",
      ).toBe(true);
    }).toPass({ timeout: 20_000 });

    if (await signupFailed.isVisible().catch(() => false)) {
      const msg = await signupFailed.textContent();
      throw new Error(
        `Sign-up failed: "${msg?.trim()}". The most likely cause is that the QA ` +
          `Supabase project has "Confirm email" ENABLED. The username door uses a ` +
          `synthetic, non-routable email, so a confirmation mail can never be ` +
          `received and signUp returns no session. A maintainer must DISABLE ` +
          `"Confirm email" in the QA project's Auth settings (production has it off).`,
      );
    }

    // Signed-in UI is reflected: the "Sign out" control is present and the guest
    // "Sign in" trigger is gone.
    await expect(signOut.first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign in" })).toHaveCount(0);
  });

  test("authenticated RLS round-trip: a card write reads back for the signed-in user", async () => {
    // This asserts at least one authenticated write that round-trips through
    // real RLS. We use a fresh anon-key client signed in as the ephemeral user
    // rather than driving the grade through the UI: the insert+select is the
    // exact RLS contract (the card_reviews policies are auth.uid() = user_id for
    // both INSERT WITH CHECK and SELECT USING), and it avoids coupling the RLS
    // assertion to per-grade sync debounce timing. The previous test already
    // proved the UI sign-in path; this proves the data path.
    if (!nodeClient) throw new Error("nodeClient not initialised");

    const email = syntheticEmail(username);
    const { data: signInData, error: signInErr } =
      await nodeClient.auth.signInWithPassword({
        email,
        password: E2E_PASSWORD,
      });
    expect(
      signInErr,
      `sign-in as the ephemeral user failed: ${signInErr?.message ?? ""}`,
    ).toBeNull();
    const userId = signInData.user?.id;
    expect(userId, "signed-in session has no user id").toBeTruthy();

    // Write a minimal, valid graduated card row. A fresh INSERT does not fire
    // the BEFORE UPDATE regression trigger, and the row satisfies the
    // firstSeen/lastReview invariant (both set = graduated). The RLS INSERT
    // policy passes only because user_id = auth.uid() from the session JWT.
    const SUBJECT_KEY = "1"; // Bulbasaur
    const cardRow = {
      user_id: userId,
      card_type: "name",
      subject_key: SUBJECT_KEY,
      locale: "en",
      stability: 10,
      difficulty: 5,
      elapsed_days: 1,
      scheduled_days: 21,
      reps: 3,
      lapses: 0,
      fsrs_state: "review",
      due_date: "2099-01-01",
      last_review: "2026-01-01",
      first_seen: "2025-12-01",
      hidden_since: null,
      seen_in_pasture: false,
      updated_at: new Date().toISOString(),
    };

    const { error: writeErr } = await nodeClient
      .from("card_reviews")
      .upsert(cardRow, { onConflict: "user_id,card_type,subject_key,locale" });
    expect(
      writeErr,
      `authenticated card_reviews write failed: ${writeErr?.message ?? ""}`,
    ).toBeNull();

    // Read it back. The SELECT policy (auth.uid() = user_id) returns only this
    // user's row, so a successful read of the just-written row proves the full
    // authenticated round-trip end to end.
    const { data: readBack, error: readErr } = await nodeClient
      .from("card_reviews")
      .select("subject_key, reps, scheduled_days, fsrs_state")
      .eq("card_type", "name")
      .eq("subject_key", SUBJECT_KEY)
      .eq("locale", "en")
      .single();
    expect(
      readErr,
      `read-back of the written card failed: ${readErr?.message ?? ""}`,
    ).toBeNull();
    expect(readBack).toMatchObject({
      subject_key: SUBJECT_KEY,
      reps: 3,
      scheduled_days: 21,
      fsrs_state: "review",
    });

    await nodeClient.auth.signOut();
  });
});
