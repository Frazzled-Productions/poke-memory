import type { Page } from "@playwright/test";

/**
 * Pre-dismisses the first-visit onboarding modal (#1103) so it does not block
 * any Practice or nav surface during a test.
 *
 * Registers an `addInitScript` that runs on every navigation in the page's
 * context. The script:
 *
 * 1. Reads the current `localStorage` settings key (may be missing or partial).
 * 2. Merges `firstVisitOnboardingDismissed: true` into `onboarding` without
 *    touching any other field.
 * 3. If the settings key was empty, also seeds `mobileNav: "bottom"` so the
 *    new-user footer-hidden default applies. This avoids the existing-user
 *    migration in `parseStoredSettings` (which defaults missing `mobileNav` to
 *    `"hamburger"` — intentional for users with pre-#661 records, but wrong for
 *    a brand-new test context).
 *
 * SAFE ALONGSIDE OTHER `addInitScript` CALLS.
 * Because the script merges into existing state, calling it before OR after
 * another `addInitScript` that writes the settings key is fine, with one
 * ordering rule: if a test registers a full settings-key overwrite AFTER
 * this helper (i.e. in the test body after a `beforeEach` that called this
 * function), call `addOnboardingPreDismiss` again after the overwrite so the
 * flag is merged into the final value. The helper is idempotent — calling it
 * multiple times is harmless.
 *
 * SURVIVAL ACROSS `localStorage.clear()`.
 * `addInitScript` re-runs on every `page.goto` call, so a test that clears
 * localStorage mid-test and then calls `page.goto` will re-seed the flag. A
 * `page.evaluate(() => localStorage.clear())` followed by a `page.reload()`
 * (which does NOT trigger `addInitScript` again) is the one case that is NOT
 * automatically covered — those tests must manually re-seed.
 *
 * Specs that need to assert the modal appears (e.g. `e2e/onboarding.spec.ts`)
 * should NOT call this helper.
 */
export async function addOnboardingPreDismiss(page: Page): Promise<void> {
  await page.addInitScript(() => {
    try {
      const KEY = "poke-memory:settings:v1";
      const raw = localStorage.getItem(KEY);
      let existing: Record<string, unknown> | null = null;
      if (raw !== null) {
        try {
          const parsed = JSON.parse(raw) as unknown;
          if (typeof parsed === "object" && parsed !== null) {
            existing = parsed as Record<string, unknown>;
          }
        } catch {
          /* malformed JSON — treat as empty */
        }
      }
      const merged: Record<string, unknown> =
        existing === null ? { mobileNav: "bottom" } : { ...existing };
      const existingOnboarding =
        typeof merged.onboarding === "object" && merged.onboarding !== null
          ? (merged.onboarding as Record<string, unknown>)
          : {};
      merged.onboarding = {
        ...existingOnboarding,
        firstVisitOnboardingDismissed: true,
      };
      localStorage.setItem(KEY, JSON.stringify(merged));
    } catch {
      /* localStorage unavailable — ignore */
    }
  });
}
