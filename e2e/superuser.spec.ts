import { test, expect, type Page } from "@playwright/test";
import { preDismissOnboardingModal } from "./helpers/dismissOnboarding";

test.beforeEach(async ({ page }) => {
  await preDismissOnboardingModal(page);
});

// Seeds localStorage on the about-to-load page so the Developer panel is
// visible without exercising the chord/tap gesture (awkward to drive across
// desktop + mobile from Playwright). The chord/tap path is covered by unit
// tests; this spec verifies the wiring from the persisted flag to surfaces.
type SeedOptions = { unlocked: boolean; pretendAllMastered: boolean };

async function seedSuperuser(page: Page, opts: SeedOptions): Promise<void> {
  await page.addInitScript((o: SeedOptions) => {
    if (o.unlocked) {
      window.localStorage.setItem("poke-memory:superuser", "true");
    } else {
      window.localStorage.removeItem("poke-memory:superuser");
    }
    window.localStorage.setItem(
      "poke-memory:superuser:flags:v1",
      JSON.stringify({ pretendAllMastered: o.pretendAllMastered }),
    );
  }, opts);
}

test.describe("Superuser mode", () => {
  test("Developer panel is hidden by default", async ({ page }) => {
    await page.goto("/settings");
    // The developer region is only rendered when superuser mode is unlocked.
    // Without unlocked state, the element should not be in the DOM at all.
    await expect(
      page.getByRole("region", { name: /developer/i }),
    ).toHaveCount(0);
  });

  test("unlocked exposes the Developer panel with the pretend-all-mastered toggle", async ({
    page,
  }) => {
    await seedSuperuser(page, { unlocked: true, pretendAllMastered: false });
    await page.goto("/settings");
    // Expand the Advanced section — the Developer panel lives inside it.
    await page.getByRole("button", { name: "Advanced", exact: true }).click();
    // Wait for settings to hydrate — the Developer panel only renders once
    // `settings !== null` (useEffect) AND `unlocked` (SuperuserContext useEffect)
    // are both resolved. Waiting for the region is the right gate.
    const developerSection = page.getByRole("region", {
      name: /developer/i,
    });
    await expect(developerSection).toBeVisible({ timeout: 10_000 });
    // The switch button inside the Developer section has no aria-label so we
    // find it by its position inside the section and confirm aria-checked.
    const toggle = developerSection.getByRole("switch").first();
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-checked", "false");
  });

  test("pretendAllMastered makes the Pokédex generation counters read full / full", async ({
    page,
  }) => {
    await seedSuperuser(page, { unlocked: true, pretendAllMastered: true });
    await page.goto("/pokedex");
    // Generation I has 151 species; under the flag both numerator and
    // denominator should be 151. The exact tally is rendered inside each
    // generation section's heading.
    await expect(
      page.getByText(/Generation I.*151\s*\/\s*151/i).first(),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("pretendAllMastered populates the Pasture", async ({ page }) => {
    await seedSuperuser(page, { unlocked: true, pretendAllMastered: true });
    await page.goto("/pasture");
    // Empty-state copy contains "Your pasture is empty". Under the flag, the
    // page should instead show the Pasture header with a species count.
    await expect(
      page.getByRole("heading", { level: 1, name: /Pasture/ }),
    ).toBeVisible();
    await expect(page.getByText(/Your pasture is empty/)).toHaveCount(0);
  });
});
