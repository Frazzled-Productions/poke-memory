import { test, expect, type Page } from "@playwright/test";

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
    await expect(
      page.getByRole("heading", { level: 2, name: "Developer" }),
    ).toHaveCount(0);
  });

  test("unlocked exposes the Developer panel with the pretend-all-mastered toggle", async ({
    page,
  }) => {
    await seedSuperuser(page, { unlocked: true, pretendAllMastered: false });
    await page.goto("/settings");
    // Wait for settings to hydrate — the Developer panel only renders once
    // `settings !== null` (useEffect) AND `unlocked` (SuperuserContext useEffect)
    // are both resolved. Waiting for the heading is the right gate.
    const developerSection = page.getByRole("region", {
      name: /developer/i,
    });
    await expect(developerSection).toBeVisible({ timeout: 10_000 });
    const toggle = developerSection.getByRole("switch", {
      name: /pretend all/i,
    });
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
