import { test, expect, type Page } from "@playwright/test";
import { addOnboardingPreDismiss } from "./helpers/onboarding";
import { seedSessionIdb, awaitSeedIdb } from "./helpers/seedIdb";
import {
  buildCompletedSession,
  SEED_POKEMON_IDS,
  EVOLUTION_CARD_IDS,
} from "./helpers/completedSession";

test.beforeEach(async ({ page }) => {
  await addOnboardingPreDismiss(page);
});

// Seeds localStorage on the about-to-load page so the Developer panel is
// visible without exercising the chord/tap gesture (awkward to drive across
// desktop + mobile from Playwright). The chord/tap path is covered by unit
// tests; this spec verifies the wiring from the persisted flag to surfaces.
type SeedOptions = {
  unlocked: boolean;
  pretendAllMastered: boolean;
  forceCardsGraduated?: boolean;
};

async function seedSuperuser(page: Page, opts: SeedOptions): Promise<void> {
  await page.addInitScript((o: SeedOptions) => {
    if (o.unlocked) {
      window.localStorage.setItem("poke-memory:superuser", "true");
    } else {
      window.localStorage.removeItem("poke-memory:superuser");
    }
    window.localStorage.setItem(
      "poke-memory:superuser:flags:v1",
      JSON.stringify({
        pretendAllMastered: o.pretendAllMastered,
        forceCardsGraduated: o.forceCardsGraduated ?? false,
      }),
    );
  }, opts);
}

// A session where Bulbasaur (id=1) is a new (learning-phase) name card.
// All other cards are future-due with new-card caps set to 0 so only
// Bulbasaur surfaces. Under `forceCardsGraduated` the typed-entry input
// must appear instead of the MC card.
const baseSession = buildCompletedSession({
  pokemonIds: SEED_POKEMON_IDS,
  evolutionCardIds: EVOLUTION_CARD_IDS,
});
const SESSION_BULBASAUR_LEARNING_ONLY = {
  ...baseSession,
  cards: (baseSession.cards as Array<{ id: number; [key: string]: unknown }>).map((c) =>
    c.id === 1
      ? {
          ...c,
          state: {
            stability: 0,
            difficulty: 5,
            elapsedDays: 0,
            scheduledDays: 0,
            reps: 0,
            lapses: 0,
            fsrsState: "new",
            dueDate: "2026-01-01",
            lastReview: null,
            firstSeen: null,
            learningStep: null,
            stepStartedAt: null,
            hiddenSince: null,
            seenInPasture: false,
          },
        }
      : c,
  ),
  limits: {
    name: { maxNewPerDay: 1, maxReviewsPerDay: 0 },
    evolution: { maxNewPerDay: 0, maxReviewsPerDay: 0 },
    reverse: { maxNewPerDay: 0, maxReviewsPerDay: 0 },
    cry: { maxNewPerDay: 0, maxReviewsPerDay: 0 },
  },
};

test.describe("Superuser mode", () => {
  test("Developer panel is hidden by default", async ({ page }) => {
    await page.goto("/settings");
    // The developer section is only rendered when superuser mode is unlocked.
    // Without unlocked state, the element should not be in the DOM at all.
    await expect(
      page.locator("#developer-heading"),
    ).toHaveCount(0);
  });

  test("unlocked exposes the Developer panel with the pretend-all-mastered toggle", async ({
    page,
  }) => {
    await seedSuperuser(page, { unlocked: true, pretendAllMastered: false });
    await page.goto("/settings");
    // Expand the Advanced section - the Developer panel lives inside it.
    await page.getByRole("button", { name: "Advanced", exact: true }).click();
    // Wait for settings to hydrate - the Developer panel only renders once
    // `settings !== null` (useEffect) AND `unlocked` (SuperuserContext useEffect)
    // are both resolved. Waiting for the heading is the right gate.
    const developerSection = page.locator("#developer-heading");
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
    // 20 s: the Pokédex page renders ~1 025 tiles and the next-intl Suspense
    // boundary from #1260 adds a hydration round-trip that pushes WebKit over
    // the previous 10 s ceiling.
    await expect(
      page.getByText(/Generation I.*151\s*\/\s*151/i).first(),
    ).toBeVisible({ timeout: 20_000 });
  });

  test("pretendAllMastered populates the Pasture", async ({ page }) => {
    await seedSuperuser(page, { unlocked: true, pretendAllMastered: true });
    await page.goto("/pasture");
    // Wait positively for the populated state: the count span ("{N} Pokémon")
    // only appears in the populated heading branch, never in the empty-state
    // branch. This auto-waits for the heavy ~1 025-species WebKit render instead
    // of racing a fixed-window negative assertion.
    // 30 s: synthesising and placing all SEED_POKEMON into habitat zones is
    // significantly heavier on WebKit than Chromium.
    await expect(
      page.getByText(/\d+ Pokémon/),
    ).toBeVisible({ timeout: 30_000 });
    // Once the populated state is confirmed visible, the empty-state copy must
    // be absent (the two branches are mutually exclusive in page.tsx).
    await expect(page.getByText(/Your pasture is empty/)).toHaveCount(0);
  });

  test("forceCardsGraduated flag shows the Developer toggle", async ({ page }) => {
    await seedSuperuser(page, { unlocked: true, pretendAllMastered: false, forceCardsGraduated: false });
    await page.goto("/settings");
    await page.getByRole("button", { name: "Advanced", exact: true }).click();
    const developerSection = page.locator("#developer-heading");
    await expect(developerSection).toBeVisible({ timeout: 10_000 });
    // The force-cards-graduated toggle must be present in the Developer panel.
    const toggle = developerSection.getByRole("switch", { name: /force cards graduated/i });
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-checked", "false");
  });

  test("forceCardsGraduated + typed-entry: a learning-phase card renders typed-entry input, not MC", async ({
    page,
  }) => {
    // Seed: superuser on, forceCardsGraduated on, typed-entry mode on.
    await seedSuperuser(page, { unlocked: true, pretendAllMastered: false, forceCardsGraduated: true });
    await page.addInitScript(() => {
      try {
        const KEY = "poke-memory:settings:v1";
        const raw = localStorage.getItem(KEY);
        let existing: Record<string, unknown> = { mobileNav: "bottom" };
        if (raw !== null) {
          try {
            const parsed = JSON.parse(raw) as unknown;
            if (typeof parsed === "object" && parsed !== null) {
              existing = parsed as Record<string, unknown>;
            }
          } catch { /* malformed */ }
        }
        localStorage.setItem(KEY, JSON.stringify({ ...existing, verifiedTypedEntryMode: true }));
      } catch { /* localStorage unavailable */ }
    });
    // Pre-seed Bulbasaur in a learning-phase state (lastReview: null).
    await seedSessionIdb(page, SESSION_BULBASAUR_LEARNING_ONLY);
    await page.goto("/");
    await awaitSeedIdb(page);

    // With forceCardsGraduated on, isInLearningPhase is false, so typed-entry
    // input must appear (not the MC buttons).
    await expect(
      page.getByRole("textbox", { name: /type the pokémon name/i }),
    ).toBeVisible({ timeout: 10_000 });

    // MC option buttons must NOT be present.
    await expect(page.getByRole("button", { name: /^Arbok$/i })).not.toBeVisible();
  });
});
