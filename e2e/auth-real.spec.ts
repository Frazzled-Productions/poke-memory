import { randomUUID } from "node:crypto";
import { test, expect, request as playwrightRequest, type APIRequestContext } from "@playwright/test";
import { addOnboardingPreDismiss } from "./helpers/onboarding";

/**
 * Real-auth E2E (#1710) - the durable guard for the username/password door.
 *
 * Unlike e2e/auth.spec.ts (which drives the test-only mock-auth seam against a
 * preview), this spec exercises REAL Better Auth and the real data gateway on
 * a local build of the Cloudflare Worker with a fresh local D1 (design D6,
 * D11). It is the end-to-end regression net for #1709: sign-up succeeded
 * server-side but the signed-in UI never reflected it until the SignInSheet was
 * fixed to do a full navigation after signing in. A unit test guards the fix;
 * this spec guards the whole flow in a real browser against a real database.
 *
 * RUN MODEL
 *   - CI's `e2e-real-auth` job builds the Worker, applies every migration to a
 *     local D1, writes a random BETTER_AUTH_SECRET to .dev.vars and serves the
 *     Worker on http://localhost:8787 (`opennextjs-cloudflare preview`).
 *   - Runs chromium only (real auth does not need the mobile-safari matrix).
 *
 * EPHEMERAL USER, NO TEARDOWN
 *   - A unique username is generated per run (E2E_RUN_ID from CI, with a
 *     timestamp+random fallback for local runs) so repeated runs never collide.
 *   - The account is created through Better Auth's own endpoints (the UI's
 *     username sign-up), in the local D1 under the runner's .wrangler/ folder,
 *     which goes with the runner: there is nothing to tear down.
 *
 * SAFETY
 *   - The suite refuses to run against anything but localhost, so it can never
 *     create accounts on a deployed site.
 */

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:8787";

// A password comfortably above MIN_PASSWORD_LENGTH (8). Never logged.
const E2E_PASSWORD = "e2e-real-auth-pw-2026";

/**
 * Per-worker unique username: CI's E2E_RUN_ID (the GitHub run id + attempt),
 * or a timestamp locally, plus a random suffix. The suffix matters on a retry:
 * Playwright re-runs the whole serial group in a fresh worker against the same
 * D1, and a username the first try created would be "already taken".
 * Lowercased and trimmed to the username rule ([a-z0-9_-]{3,30}).
 */
function makeUsername(): string {
  const seed = `${process.env.E2E_RUN_ID ?? Date.now().toString(36)}_${randomUUID().replace(/-/g, "").slice(0, 6)}`;
  // Strip to allowed chars, prefix with a fixed marker so test rows are
  // identifiable, and clamp to 30 chars from the end so the suffix survives.
  const cleaned = `e2e_${seed}`.toLowerCase().replace(/[^a-z0-9_-]/g, "");
  return cleaned.length > 30 ? `e2e_${cleaned.slice(-26)}` : cleaned;
}

const username = makeUsername();

/**
 * A Node-side HTTP client signed in as the ephemeral user through Better
 * Auth's username sign-in; its cookie jar carries the session to the data
 * gateway (POST /api/db), which runs each query pinned to that user.
 */
let api: APIRequestContext | null = null;

async function signedInApi(): Promise<APIRequestContext> {
  if (api) return api;
  const context = await playwrightRequest.newContext({
    baseURL: BASE_URL,
    // Better Auth and the gateway both require a same-origin Origin header.
    extraHTTPHeaders: { origin: new URL(BASE_URL).origin },
  });
  const res = await context.post("/api/auth/sign-in/username", {
    data: { username, password: E2E_PASSWORD },
  });
  expect(res.status(), `sign-in as the ephemeral user failed: ${await res.text()}`).toBe(200);
  api = context;
  return context;
}

/** One gateway query (lib/db/gateway.ts wire format); returns its data. */
async function gateway(query: Record<string, unknown>): Promise<unknown> {
  const res = await (await signedInApi()).post("/api/db", { data: query });
  const body = (await res.json()) as { data: unknown; error: { message: string } | null };
  expect(body.error, `gateway ${String(query.kind)} failed: ${body.error?.message ?? ""}`).toBeNull();
  expect(res.status()).toBe(200);
  return body.data;
}

const cardKey = (subjectKey: string) => [
  { column: "card_type", op: "eq", value: "name" },
  { column: "subject_key", op: "eq", value: subjectKey },
  { column: "locale", op: "eq", value: "en" },
];

test.describe("Real auth: username door against a local Worker and D1 (#1710)", () => {
  // Run serially: sign-up happens once, then the data round-trip reuses the
  // same ephemeral user. Parallelism would race on the single account.
  test.describe.configure({ mode: "serial" });

  test.beforeAll(() => {
    const host = new URL(BASE_URL).hostname;
    if (host !== "localhost" && host !== "127.0.0.1") {
      throw new Error(
        `auth-real.spec refuses to run against ${BASE_URL}: it creates accounts and ` +
          "must only ever run against a local Worker (CI's e2e-real-auth job).",
      );
    }
  });

  test.afterAll(async () => {
    await api?.dispose();
    api = null;
  });

  test("sign up via the username door and the UI reflects the signed-in state", async ({
    page,
  }) => {
    await addOnboardingPreDismiss(page);
    await page.goto("/");

    const signIn = page.getByRole("button", { name: "Sign in" });
    await expect(signIn, "Sign in trigger missing").toBeVisible({ timeout: 15_000 });

    await signIn.click();

    // The SignInSheet opens; the username door is in sign-up mode by default.
    const dialog = page.getByRole("dialog", { name: /keep your progress safe/i });
    await expect(dialog).toBeVisible();

    await dialog.getByLabel("Username").fill(username);
    await dialog.getByLabel("Password").fill(E2E_PASSWORD);
    await dialog.getByRole("button", { name: "Create account" }).click();

    // The fix for #1709: Better Auth sets the session cookie and the
    // SignInSheet does a full navigation, so the signed-in UI ("Sign out")
    // appears WITHOUT a manual reload. This is the exact regression we guard.
    // A sign-up error renders inline instead: fail with its text.
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
      throw new Error(`Sign-up failed: "${msg?.trim()}". Check the Worker log (/tmp/worker.log in CI).`);
    }

    // Signed-in UI is reflected: the "Sign out" control is present and the guest
    // "Sign in" trigger is gone.
    await expect(signOut.first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign in" })).toHaveCount(0);
  });

  test("authenticated data round-trip: a card write reads back for the signed-in user", async () => {
    // At least one authenticated write that round-trips through the gateway and
    // the scope helper (which pins every row to the session user, as RLS did).
    // Driven from Node rather than the UI so the assertion does not couple to
    // per-grade sync debounce timing; the previous test proved the UI sign-in.
    //
    // A minimal, valid graduated card row: a fresh INSERT does not fire the
    // BEFORE UPDATE regression trigger, and firstSeen/lastReview are both set.
    const SUBJECT_KEY = "1"; // Bulbasaur
    await gateway({
      kind: "upsert",
      table: "card_reviews",
      rows: {
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
      },
      onConflict: "user_id,card_type,subject_key,locale",
    });

    // Read it back; only this user's rows are visible to their session.
    const readBack = await gateway({
      kind: "select",
      table: "card_reviews",
      columns: ["subject_key", "reps", "scheduled_days", "fsrs_state"],
      filters: cardKey(SUBJECT_KEY),
      single: "one",
    });
    expect(readBack).toMatchObject({
      subject_key: SUBJECT_KEY,
      reps: 3,
      scheduled_days: 21,
      fsrs_state: "review",
    });
  });

  test("signed-in backup restore moves cards forward and never lowers the cloud (#2218)", async ({
    page,
  }, testInfo) => {
    // The one path the integration suite cannot reach: a real browser, a real
    // session cookie, the real gateway and D1. Runs after the round-trip test,
    // which leaves Bulbasaur (subject "1") in the cloud at reps 3.
    testInfo.setTimeout(90_000);

    // Ivysaur (subject "2") is further on in the cloud than in the backup below.
    await gateway({
      kind: "upsert",
      table: "card_reviews",
      rows: {
        card_type: "name",
        subject_key: "2",
        locale: "en",
        stability: 10,
        difficulty: 5,
        elapsed_days: 1,
        scheduled_days: 21,
        reps: 9,
        lapses: 0,
        fsrs_state: "review",
        due_date: "2099-01-01",
        last_review: "2026-03-01",
        first_seen: "2025-12-01",
        hidden_since: null,
        seen_in_pasture: false,
      },
      onConflict: "user_id,card_type,subject_key,locale",
    });

    const cloudReps = async (subjectKey: string) => {
      const row = (await gateway({
        kind: "select",
        table: "card_reviews",
        columns: ["reps"],
        filters: cardKey(subjectKey),
        single: "one",
      })) as { reps: number } | null;
      return row?.reps;
    };

    await addOnboardingPreDismiss(page);
    await page.goto("/");
    await page.getByRole("button", { name: "Sign in" }).first().click();
    const dialog = page.getByRole("dialog", { name: /keep your progress safe/i });
    await dialog.getByRole("button", { name: /already have an account/i }).click();
    await dialog.getByLabel("Username").fill(username);
    await dialog.getByLabel("Password").fill(E2E_PASSWORD);
    await dialog.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByRole("button", { name: "Sign out" }).first()).toBeVisible({
      timeout: 20_000,
    });

    await page.goto("/settings");
    await expect(page.getByLabel("Loading settings")).toBeHidden();
    await page.getByRole("button", { name: /data & backup/i, exact: true }).click();

    const restored = (id: number, reps: number, lastReview: string) => ({
      id,
      name: `Pokemon ${id}`,
      spriteUrl: `/sprites/pokemon/${id}.png`,
      cardType: "name",
      subjectKey: String(id),
      locale: "en",
      state: {
        stability: 10,
        difficulty: 5,
        elapsedDays: 1,
        scheduledDays: 21,
        reps,
        lapses: 0,
        fsrsState: "review",
        dueDate: "2099-01-01",
        lastReview,
        firstSeen: "2025-12-01",
        learningStep: null,
        stepStartedAt: null,
        hiddenSince: null,
        seenInPasture: false,
      },
    });
    const limits = { maxNewPerDay: 10, maxReviewsPerDay: 100 };
    const backup = {
      version: 1,
      exportedAt: "2026-04-01T00:00:00.000Z",
      cards: [restored(1, 8, "2026-02-01"), restored(2, 4, "2026-01-15")],
      limits: { name: limits, evolution: limits, reverse: limits, cry: limits },
      settings: {
        masteryRepetitions: 3,
        maxNewPerDay: 10,
        maxReviewsPerDay: 100,
        maxNewEvolutionPerDay: 5,
        maxReviewsEvolutionPerDay: 50,
      },
    };

    let confirmation = "";
    page.once("dialog", (d) => {
      confirmation = d.message();
      void d.accept();
    });
    // A restore ends with window.location.reload() (app/settings/page.tsx): read
    // this device's copy only once that reload has loaded, or the read races it.
    const reloaded = page.waitForEvent("load", { timeout: 30_000 });
    const [fileChooser] = await Promise.all([
      page.waitForEvent("filechooser"),
      page.getByRole("button", { name: /^import$/i }).click(),
    ]);
    await fileChooser.setFiles({
      name: "poke-memory-backup-2026-04-01.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(backup)),
    });

    // Bulbasaur reaching reps 8 in the cloud can only come from the restore's push.
    await expect.poll(() => cloudReps("1"), { timeout: 20_000 }).toBe(8);
    expect(confirmation).toMatch(/only moves cards forward/);
    expect(await cloudReps("2")).toBe(9);

    // This device agrees with the cloud after the reload: the older copy did not stick.
    await reloaded;
    const localReps = (subjectKey: string) =>
      page.evaluate(async (key) => {
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          const req = indexedDB.open("poke-memory");
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        });
        const raw = await new Promise<unknown>((resolve, reject) => {
          const req = db.transaction("kv").objectStore("kv").get("poke-memory:review-session:v1");
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        });
        db.close();
        if (typeof raw !== "string") return null;
        const session = JSON.parse(raw) as {
          cards: { cardType: string; subjectKey: string; locale: string; state: { reps: number } }[];
        };
        return (
          session.cards.find(
            (c) => c.cardType === "name" && c.subjectKey === key && c.locale === "en",
          )?.state.reps ?? null
        );
      }, subjectKey);
    await expect.poll(() => localReps("1"), { timeout: 20_000 }).toBe(8);
    await expect.poll(() => localReps("2"), { timeout: 20_000 }).toBe(9);
  });
});
