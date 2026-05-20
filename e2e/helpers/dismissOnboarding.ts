import type { Page } from "@playwright/test";

/**
 * Pre-dismisses the first-visit onboarding modal (#1103) so it does not block
 * any Practice / nav surface during a test.
 *
 * Registers an addInitScript that runs on every navigation in the page's
 * context. The script:
 *
 * 1. Reads the current localStorage settings key (may be missing or partial).
 * 2. Merges `firstVisitOnboardingDismissed: true` into `onboarding` without
 *    touching any other field.
 * 3. If the settings key was empty, also seeds `mobileNav: "bottom"` so the
 *    new-user Footer-hidden default applies. This avoids the existing-user
 *    migration in `parseStoredSettings` (which defaults missing `mobileNav` to
 *    "hamburger" - intentional for users with pre-#661 records, but wrong for
 *    a brand-new test context).
 *
 * IMPORTANT: tests that overwrite the entire settings key in their OWN
 * addInitScript (e.g. `setItem(SETTINGS_KEY, JSON.stringify({...}))`) will
 * clobber this beforeEach's merge. Those tests must include the flag in
 * their literal directly.
 *
 * Specs that need to assert the modal appears (e.g. e2e/onboarding.spec.ts)
 * should NOT call this helper.
 */
export async function preDismissOnboardingModal(page: Page): Promise<void> {
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
          /* malformed JSON - treat as empty */
        }
      }
      const merged: Record<string, unknown> = existing === null
        ? { mobileNav: "bottom" }
        : { ...existing };
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
      /* localStorage unavailable - ignore */
    }
  });
}
