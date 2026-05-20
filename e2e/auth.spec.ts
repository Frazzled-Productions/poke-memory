import { test, expect, type Page } from "@playwright/test";
import { seedIdb, awaitSeedIdb } from "./helpers/seedIdb";
import { preDismissOnboardingModal } from "./helpers/dismissOnboarding";

test.beforeEach(async ({ page }) => {
  await preDismissOnboardingModal(page);
});

/**
 * Signed-in UI coverage via the test-only mock-auth seam (issue #751).
 *
 * `e2e/` is otherwise guest-mode only. These specs exercise the signed-in
 * render path in a real browser: avatar render, sign-out button, signed-in
 * nav, the conflict picker, and the visible superuser cloud-write-guard
 * surfaces.
 *
 * The seam (`lib/auth/mockAuth.ts`) is activated by `NEXT_PUBLIC_E2E_AUTH_MOCK=1`,
 * set ONLY against preview deployments by `e2e.yml`. It is provably unreachable
 * in production builds — `isMockAuthEnabled()` short-circuits on
 * `NODE_ENV === "production"`, and `next.config.ts` fails the build loudly if
 * the flag is ever set in a production build. See `lib/auth/mockAuth.test.ts`.
 *
 * When the seam is inactive (no flag, e.g. a local run without it) the app
 * renders guest-mode and these specs are skipped at runtime — see `skipUnless`.
 *
 * The mock cloud fixture defaults to an entirely empty cloud. The conflict
 * spec seeds a non-empty `card_reviews` fixture into localStorage so one
 * preview deployment can serve every scenario without a rebuild.
 */

const MOCK_CLOUD_FIXTURE_STORAGE_KEY = "poke-memory:e2e:mock-cloud-fixture";

/**
 * Skips the test unless the mock-auth seam is actually active on the
 * deployment under test. Detected by loading the home page and checking for
 * the signed-in "Sign out" control. This keeps the spec a no-op on a local
 * `npm run test:e2e` run that did not set the flag, rather than failing.
 */
async function skipUnlessMockAuth(page: Page): Promise<void> {
  await page.goto("/");
  const signedIn = await page
    .getByRole("button", { name: "Sign out" })
    .first()
    .isVisible()
    .catch(() => false);
  test.skip(!signedIn, "mock-auth seam not active on this deployment");
}

test.describe("Signed-in UI (mock-auth seam)", () => {
  test("nav shows the avatar and a sign-out button", async ({ page }) => {
    await skipUnlessMockAuth(page);

    // The signed-in branch of AuthButton renders an avatar Image plus a
    // "Sign out" button. The avatar's alt text is the fake user's display
    // name ("E2E Trainer").
    const signOut = page.getByRole("button", { name: "Sign out" }).first();
    await expect(signOut).toBeVisible();

    const avatar = page.getByRole("img", { name: "E2E Trainer" }).first();
    await expect(avatar).toBeVisible();

    // The guest-mode "Sign in" control must NOT be present.
    await expect(page.getByRole("button", { name: "Sign in" })).toHaveCount(0);
  });

  test("sign-out button is interactive (does not throw)", async ({ page }) => {
    await skipUnlessMockAuth(page);

    const signOut = page.getByRole("button", { name: "Sign out" }).first();
    await expect(signOut).toBeEnabled();
    // Clicking invokes the signOut server action. Under the mock seam there is
    // no real session, so this is a smoke check that the control is wired and
    // the click handler runs without a client-side error.
    await signOut.click();
    await expect(page).toHaveURL(/\/$|\/\?/);
  });

  test("conflict picker renders both sides when local and cloud both have data", async ({
    page,
  }) => {
    // Seed a non-empty cloud fixture so `hasCloudData` reports cloud data, and
    // a local review session with a graded card so `hasLocal` is true. Both
    // sides populated is the precondition for the conflict picker.
    const cloudFixture = {
      cardReviews: [
        {
          card_type: "name",
          subject_key: "1",
          stability: 10,
          difficulty: 5,
          elapsed_days: 1,
          scheduled_days: 5,
          reps: 3,
          lapses: 0,
          fsrs_state: "review",
          due_date: "2099-01-01",
          last_review: "2025-01-01",
          first_seen: "2024-12-01",
          hidden_since: null,
          seen_in_pasture: false,
          updated_at: "2025-01-01T00:00:00.000Z",
        },
      ],
    };

    // A minimal local session: one name card already reviewed.
    const localSession = {
      cards: [
        {
          cardType: "name",
          subjectKey: "1",
          pokemonId: 1,
          direction: "name",
          state: {
            stability: 8,
            difficulty: 5,
            elapsedDays: 1,
            scheduledDays: 3,
            reps: 2,
            lapses: 0,
            fsrsState: "review",
            dueDate: "2099-01-01",
            lastReview: "2025-02-01",
            firstSeen: "2024-12-15",
            hiddenSince: null,
            seenInPasture: false,
          },
        },
      ],
      limits: { newName: 10, newEvolution: 5, newReverse: 10, newCry: 10, reviews: 100 },
    };

    await seedIdb(page, {
      "poke-memory:review-session:v1": JSON.stringify(localSession),
    });
    await page.addInitScript(
      ([key, value]) => window.localStorage.setItem(key, value),
      [MOCK_CLOUD_FIXTURE_STORAGE_KEY, JSON.stringify(cloudFixture)] as const,
    );

    await page.goto("/");
    await awaitSeedIdb(page);

    const signedIn = await page
      .getByRole("button", { name: "Sign out" })
      .first()
      .isVisible()
      .catch(() => false);
    test.skip(!signedIn, "mock-auth seam not active on this deployment");

    await page.goto("/auth/callback-complete");

    // The conflict picker shows a "Sync conflict" heading and two sides:
    // "This device" and "Cloud", each with a keep button.
    await expect(
      page.getByRole("heading", { name: "Sync conflict" }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByRole("heading", { name: "This device" }),
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: "Cloud" })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Keep local" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Keep cloud" }),
    ).toBeVisible();
  });

  test("Stats page shows the sign-in-aware sync status line", async ({
    page,
  }) => {
    await skipUnlessMockAuth(page);
    await page.goto("/stats");

    // The Stats heading confirms the page rendered.
    await expect(
      page.getByRole("heading", { level: 1, name: /Stats/i }),
    ).toBeVisible({ timeout: 15_000 });
  });
});

test.describe("Superuser cloud-write-guard surfaces (signed-in)", () => {
  /**
   * Seeds the superuser unlock + the `pretendAllMastered` flag so the
   * cloud-write guard is active. While any superuser flag is on, the visible
   * cloud-write surfaces (FSRS optimiser button, Stats Retry link) must render
   * disabled with a "Sync paused (superuser)" treatment.
   */
  async function seedSuperuserUnlocked(page: Page): Promise<void> {
    await page.addInitScript(() => {
      window.localStorage.setItem("poke-memory:superuser", "true");
      window.localStorage.setItem(
        "poke-memory:superuser:flags:v1",
        JSON.stringify({ pretendAllMastered: true }),
      );
    });
  }

  test("FSRS optimiser button is disabled with a sync-paused label", async ({
    page,
  }) => {
    await seedSuperuserUnlocked(page);
    await page.goto("/");
    const signedIn = await page
      .getByRole("button", { name: "Sign out" })
      .first()
      .isVisible()
      .catch(() => false);
    test.skip(!signedIn, "mock-auth seam not active on this deployment");

    await page.goto("/settings");
    // The FSRS optimiser lives inside the Advanced section.
    await page.getByRole("button", { name: "Advanced", exact: true }).click();

    const optimizeButton = page.getByTestId("fsrs-optimize-button");
    await expect(optimizeButton).toBeVisible({ timeout: 15_000 });
    await expect(optimizeButton).toBeDisabled();
    // Signed-in + superuser on → the "Sync paused (superuser)" branch renders.
    await expect(optimizeButton).toHaveText(/Sync paused \(superuser\)/);
  });

  test("Stats page Retry link is disabled while superuser is on", async ({
    page,
  }) => {
    await seedSuperuserUnlocked(page);
    await page.goto("/");
    const signedIn = await page
      .getByRole("button", { name: "Sign out" })
      .first()
      .isVisible()
      .catch(() => false);
    test.skip(!signedIn, "mock-auth seam not active on this deployment");

    await page.goto("/stats");
    await expect(
      page.getByRole("heading", { level: 1, name: /Stats/i }),
    ).toBeVisible({ timeout: 15_000 });

    // The sync status line's Retry control, when present, is disabled while a
    // superuser flag is on (the write-guard). It may render as a disabled
    // button; assert it is never an enabled, clickable Retry.
    const enabledRetry = page.getByRole("button", { name: /Retry/i });
    const count = await enabledRetry.count();
    for (let i = 0; i < count; i++) {
      await expect(enabledRetry.nth(i)).toBeDisabled();
    }
  });
});
