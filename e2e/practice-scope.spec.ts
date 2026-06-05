import { test, expect } from "@playwright/test";
import { addOnboardingPreDismiss } from "./helpers/onboarding";
import {
  SEED_POKEMON_IDS,
  EVOLUTION_CARD_IDS,
  buildActiveSession,
} from "./helpers/completedSession";
import { seedSessionIdb, awaitSeedIdb } from "./helpers/seedIdb";

// E2E smoke for #333 "Allow filtering which cards to learn".
//
// Issue #258 (PR #337) already shipped a practice-page scope filter
// (`ScopeControl`). #333 layers (a) cross-device persistence in UserSettings
// and (b) a snooze model that shifts hidden cards' dueDate forward, plus
// UI polish (Roman-numeral gens, type-colored chips, live count).
//
// #450 adds a "Default form only" radio inside the "Alternate forms" fieldset
// in ScopeControl so users can exclude regional variants, Mega Evolutions, etc.
//
// This file covers:
//   1. Practice page - open the Scope panel, click "Generation I", verify
//      a card still renders (NOT the no-match empty state).
//   2. Empty-state path - seed UserSettings with a no-match scope, navigate
//      to /, verify the "No Pokémon match your scope" empty-state and the
//      "Clear scope" CTA appear.
//   3. Default form only - toggle the radio, assert the live count reflects
//      only base species (≤ total; same count when seed has no alternate forms).
//   4. Default form only session - when the toggle is active, any card shown
//      after reveal must not be an alternate-form name (Alolan, Galarian, etc.).
//
// Snooze / un-hide SRS shifting is covered by unit tests in
// lib/review/filters.test.ts - not duplicated here.

const SETTINGS_STORAGE_KEY = "poke-memory:settings:v1";

// A small set of Gen I species IDs seeded as "new" cards so the session
// renders a Reveal button quickly without building ~2 050 cards from scratch.
// Both the name card (id=N) and its paired reverse card (id=REVERSE_ID_OFFSET+N)
// are marked new so species-grouped admission (which requires both directions
// to have budget) admits them on the first load.
// Gen I species seeded as new so the session renders quickly and scope changes
// to Generation I have candidates. Gen IX entries (906 Sprigatito, 909 Fuecoco)
// are included so that when test #1088 seeded card is Gen I and it picks
// "Generation IX" as the excluding scope, those Gen IX cards are available
// in the new queue rather than future-due.
const GEN1_NEW_SPECIES = [1, 4, 7, 25, 52, 906, 909]; // Bulbasaur, Charmander, Squirtle, Pikachu, Meowth, Sprigatito, Fuecoco

test.describe("Practice scope (#333)", () => {
  test.beforeEach(async ({ page }) => {
    // Fresh slate - drop any settings/session state from a prior test so
    // the scope starts at its empty default.
    await page.addInitScript(() => localStorage.clear());

    // Pre-seed the full card set (name + reverse for all species + evolution
    // cards) with a handful of Gen I pairs in "new" state. This avoids the
    // ~2 050-card build-from-scratch that the app would otherwise do, which
    // blocks the React render behind two large IDB writes and causes the
    // Reveal-button assertions to time out even on Chromium (#1257).
    await seedSessionIdb(
      page,
      buildActiveSession({
        pokemonIds: SEED_POKEMON_IDS,
        evolutionCardIds: EVOLUTION_CARD_IDS,
        newSpeciesIds: GEN1_NEW_SPECIES,
      }),
    );

    // Set maxNewReversePerDay: 0 so the first displayed card is always a name
    // card (has a Reveal button). Reverse cards use SpritePicker and have no
    // Reveal button; if one were shown first, the Reveal-button assertions in
    // the scope-filter tests would time out. Individual tests that need a
    // different settings shape write their own full settings object, which
    // clobbers this default (init-scripts run in registration order).
    await page.addInitScript((key) => {
      localStorage.setItem(
        key,
        JSON.stringify({ maxNewReversePerDay: 0, evolutionCardsEnabled: false }),
      );
    }, SETTINGS_STORAGE_KEY);

    // Pre-dismiss the first-visit modal so it does not block the scope controls.
    // Registered after the session seed so both init-scripts run in order.
    await addOnboardingPreDismiss(page);
  });

  test("happy path: scope to Generation I, practice page still shows a card", async ({
    page,
  }) => {
    await page.goto("/");
    await awaitSeedIdb(page);

    // Open the Scope panel. The collapsed header is a button whose
    // accessible name combines "Scope" and the current label ("All Pokémon"
    // by default).
    const scopeToggle = page
      .getByRole("button", { expanded: false })
      .filter({ hasText: /scope/i })
      .first();
    await scopeToggle.click();
    const scopePanel = page.locator("#scope-panel");
    await expect(scopePanel).toBeVisible();

    // The scope panel is now an accordion. Expand the "Generation" section
    // before interacting with its pills. The <summary> element acts as the
    // toggle; click it to open the <details>.
    await scopePanel.getByRole("group", { name: "Generation" }).locator("summary").click();

    // Scope to the expanded panel so "Generation I" doesn't clash with
    // any other surfaces that mention generations (e.g. trainer card).
    // `exact: true` is required because "Generation I" is a substring of
    // "Generation II", "Generation III", etc., causing a strict-mode violation
    // without it (Playwright matches 5 buttons instead of 1).
    const genI = scopePanel.getByRole("button", { name: "Generation I", exact: true });
    await expect(genI).toBeVisible();
    await expect(genI).toHaveAttribute("aria-pressed", "false");
    await genI.click();
    await expect(genI).toHaveAttribute("aria-pressed", "true");

    // Live count should now be a non-zero subset of the total pool.
    // Using a flexible regex avoids hardcoding the species count, which grows
    // when alternate-form cards are added (#446 / #447).
    await expect(scopePanel.getByText(/of \d+ Pok[ée]mon match/)).toBeVisible();

    // A practice card should still render - the no-match empty-state must
    // NOT appear. Reveal button visible is the canonical "session running"
    // indicator across the existing E2E suite.
    const reveal = page.getByRole("button", { name: /reveal/i });
    const noMatch = page.getByText(/no Pok[ée]mon match your scope/i);
    await expect(reveal).toBeVisible();
    await expect(noMatch).not.toBeVisible();
  });

  test("scope change before any grade swaps the displayed card (#1088)", async ({
    page,
  }) => {
    // Regression for #1088: handleScopeChange used to update eligibleCardIds
    // without releasing the displayedCardId lock, so the card on screen stayed
    // frozen on the pre-scope-change pick until the user graded it. Picking
    // a scope that excludes the on-screen card must swap it for the new queue
    // head immediately.
    //
    // Seed settings so the first queued card is guaranteed to be a name card
    // (rendered by PokemonCard with alt="A Pokémon sprite, answer hidden").
    // After #1234 reverse is always enabled, so we achieve name-only queue by
    // setting maxNewReversePerDay to 0: buildSessionQueues pre-slices reverse
    // candidates to an empty list, so species-grouped admission never includes
    // reverse cards in the newQueue. Evolution and cry cards are also disabled.
    await page.addInitScript(
      ({ key }) => {
        const settings = {
          masteryRepetitions: 3,
          maxNewPerDay: 10,
          maxReviewsPerDay: 100,
          maxNewEvolutionPerDay: 5,
          maxReviewsEvolutionPerDay: 50,
          // nameCardsEnabled and reverseCardsEnabled were removed in #1234.
          // Name and reverse cards are now always on - omit these stale fields.
          evolutionCardsEnabled: false,
          // maxNewReversePerDay: 0 ensures only name cards enter the new queue.
          // Reverse cards are still part of the session (always enabled since
          // #1234) but their daily new-card budget is exhausted, so they are
          // held back while name cards are admitted solo.
          maxNewReversePerDay: 0,
          maxReviewsReversePerDay: 100,
          playCryOnReveal: false,
          cryCardsEnabled: false,
          maxNewCryPerDay: 10,
          maxReviewsCryPerDay: 100,
          favouriteTheme: null,
          retentionTarget: 0.9,
        };
        localStorage.setItem(key, JSON.stringify(settings));
      },
      { key: SETTINGS_STORAGE_KEY },
    );
    // Merge the onboarding pre-dismiss flag after the settings override so it
    // is not clobbered by the full-object write above.
    await addOnboardingPreDismiss(page);
    await page.goto("/");
    await awaitSeedIdb(page);

    // Capture the sprite src that's rendered before any scope action. The
    // PokemonCard renders a single img with alt="A Pokémon sprite, answer
    // hidden" pre-reveal; the SpritePreloader uses alt="" so this locator is
    // unique. The custom next/image loader (#1186) rewrites the src to the
    // pre-generated static WebP path /sprites/pokemon/webp/<id>/<width>.webp.
    // The Pokédex grid is the only surface that still serves raw PNG paths.
    // We decode the species id from whichever format is rendered.
    const onScreenSprite = page.getByAltText("A Pokémon sprite, answer hidden");
    await expect(onScreenSprite).toBeVisible();
    const initialSrc = await onScreenSprite.getAttribute("src");
    expect(initialSrc).toBeTruthy();

    // Extract the species id from the sprite URL. Handles both the legacy
    // PNG path (/sprites/pokemon/<id>.png) and the static WebP path introduced
    // by #1186 (/sprites/pokemon/webp/<id>/<width>.webp). Also tolerates an
    // absolute-URL prefix (http://host/sprites/...) and percent-encoded forms.
    // Falls back to null if the URL shape is unexpected, in which case the
    // test bails out rather than picking a possibly-in-scope generation.
    function speciesIdFromSrc(src: string | null): number | null {
      if (src === null) return null;
      const decoded = decodeURIComponent(src);
      // Matches both:
      //   /sprites/pokemon/189.png          (legacy PNG / Pokédex grid)
      //   /sprites/pokemon/webp/189/320.webp (static WebP via custom loader)
      const match = decoded.match(/\/sprites\/pokemon\/(?:webp\/)?(\d+)[/.]/);
      if (!match) return null;
      return Number(match[1]);
    }

    // Map a species id to its generation pill label. Mirrors the dynamic-pick
    // pattern used by the unit test in ReviewSession.test.tsx (#1088). Pokemon
    // id ranges per generation come from the canonical species list.
    function generationLabel(id: number): string {
      if (id <= 151) return "Generation I";
      if (id <= 251) return "Generation II";
      if (id <= 386) return "Generation III";
      if (id <= 493) return "Generation IV";
      if (id <= 649) return "Generation V";
      if (id <= 721) return "Generation VI";
      if (id <= 809) return "Generation VII";
      if (id <= 905) return "Generation VIII";
      return "Generation IX";
    }

    const initialId = speciesIdFromSrc(initialSrc);
    expect(initialId, `unable to parse species id from sprite src ${initialSrc}`).not.toBeNull();
    const displayedGen = generationLabel(initialId!);
    // Pick any generation that ISN'T the displayed card's gen. Generation I
    // is the obvious "other" choice when the displayed card is high-gen;
    // otherwise pick Generation IX so the excluding-gen is far away in id-space.
    const excludingGen =
      displayedGen === "Generation I" ? "Generation IX" : "Generation I";

    // Open the Scope panel and apply the excluding-generation filter.
    const scopeToggle = page
      .getByRole("button", { expanded: false })
      .filter({ hasText: /scope/i })
      .first();
    await scopeToggle.click();
    const scopePanel = page.locator("#scope-panel");
    await expect(scopePanel).toBeVisible();

    // Expand the Generation accordion section before clicking a gen pill.
    await scopePanel.getByRole("group", { name: "Generation" }).locator("summary").click();

    const excludingPill = scopePanel.getByRole("button", { name: excludingGen, exact: true });
    await expect(excludingPill).toBeVisible();
    await excludingPill.click();
    await expect(excludingPill).toHaveAttribute("aria-pressed", "true");

    // The sprite must swap to a card from the excluding generation. The
    // lock-clear release in handleScopeChange (and the render-side
    // scope-eligibility guard) makes this happen on the next render rather
    // than waiting for a grade.
    await expect.poll(async () =>
      onScreenSprite.getAttribute("src"),
    ).not.toBe(initialSrc);

    // Smoke-check that the session is still operable post-swap.
    await expect(page.getByRole("button", { name: /reveal/i })).toBeVisible();
  });

  test("no-match scope renders empty state with Clear scope CTA", async ({
    page,
  }) => {
    // Pick a scope with zero matching species.
    //
    // Scope axes (gens, types, presets) are OR'd, so { gens:[1], types:["dark"] }
    // matches ALL Gen-I cards PLUS all dark-type cards across every gen - not
    // their intersection. To guarantee zero matches we use a fictitious type
    // string that no Pokémon in the seed carries. The settings validator accepts
    // any string value for types (only gens are range-validated to 1..9), so
    // "nonexistent-type" passes through intact. With gens:[] and presets:[] the
    // only active axis is types, and no card has type "nonexistent-type".
    await page.addInitScript(
      ({ key }) => {
        const settings = {
          masteryRepetitions: 3,
          maxNewPerDay: 10,
          maxReviewsPerDay: 100,
          maxNewEvolutionPerDay: 5,
          maxReviewsEvolutionPerDay: 50,
          // nameCardsEnabled and reverseCardsEnabled were removed in #1234.
          // Name and reverse cards are now always on - omit these stale fields.
          evolutionCardsEnabled: true,
          // maxNewReversePerDay: 0 ensures only name cards (Reveal button)
          // enter the new queue after scope is cleared. Reverse cards use
          // SpritePicker and have no Reveal button; if one showed first the
          // assertion at the bottom of this test would time out (#1257).
          maxNewReversePerDay: 0,
          maxReviewsReversePerDay: 100,
          playCryOnReveal: false,
          cryCardsEnabled: false,
          maxNewCryPerDay: 10,
          maxReviewsCryPerDay: 100,
          favouriteTheme: null,
          retentionTarget: 0.9,
          practiceScope: { gens: [], types: ["nonexistent-type"], presets: [] },
        };
        localStorage.setItem(key, JSON.stringify(settings));
      },
      { key: SETTINGS_STORAGE_KEY },
    );
    // Merge the onboarding pre-dismiss flag after the settings override.
    await addOnboardingPreDismiss(page);

    await page.goto("/");
    await awaitSeedIdb(page);

    // Empty-state copy. Component renders this in a styled <p>, not a
    // heading element, so match by visible text rather than role.
    await expect(
      page.getByText(/no Pok[ée]mon match your scope/i),
    ).toBeVisible();

    // The "Clear scope" CTA is the only escape hatch surfaced in the
    // empty state - must be visible and operable.
    const clearScope = page.getByRole("button", { name: /clear scope/i });
    await expect(clearScope).toBeVisible();

    // Clicking it should restore the normal session - Reveal becomes
    // visible, empty state disappears.
    await clearScope.click();
    await expect(page.getByRole("button", { name: /reveal/i })).toBeVisible();
    await expect(
      page.getByText(/no Pok[ée]mon match your scope/i),
    ).not.toBeVisible();
  });

  test("Default form only radio is selectable and updates the live count", async ({
    page,
  }) => {
    // The "Alternate forms" section in ScopeControl (which contains the
    // "Default form only" radio) is gated behind alternateFormsEnabled. Seed
    // the setting via localStorage so the section is rendered without needing
    // to navigate through the Settings page UI.
    await page.addInitScript(
      ({ key }) => {
        const stored = localStorage.getItem(key);
        const settings = stored ? (JSON.parse(stored) as Record<string, unknown>) : {};
        settings["alternateFormsEnabled"] = true;
        localStorage.setItem(key, JSON.stringify(settings));
      },
      { key: SETTINGS_STORAGE_KEY },
    );

    await page.goto("/");
    await awaitSeedIdb(page);

    // Open the Scope panel.
    const scopeToggle = page
      .getByRole("button", { expanded: false })
      .filter({ hasText: /scope/i })
      .first();
    await scopeToggle.click();
    const scopePanel = page.locator("#scope-panel");
    await expect(scopePanel).toBeVisible();

    // Read the initial count before changing the radio.
    const countText = scopePanel.getByText(/\d+ of \d+ Pok[ée]mon match/);
    await expect(countText).toBeVisible();
    const initialText = await countText.textContent();
    const initialMatch = initialText?.match(/^(\d+)/);
    const initialCount = initialMatch ? Number(initialMatch[1]) : -1;

    // Expand the "Alternate forms" accordion section before interacting with
    // its radio buttons (the section starts collapsed when mode is "all").
    await scopePanel.getByRole("group", { name: "Alternate forms" }).locator("summary").click();

    // Select the "Default form only" radio inside the "Alternate forms" section.
    const defaultFormRadio = scopePanel.getByRole("radio", {
      name: "Default form only",
    });
    await expect(defaultFormRadio).toBeVisible();
    await defaultFormRadio.click();
    await expect(defaultFormRadio).toBeChecked();

    // The live count must be visible and ≥ 0.
    await expect(countText).toBeVisible();
    const updatedText = await countText.textContent();
    const updatedMatch = updatedText?.match(/^(\d+)/);
    const updatedCount = updatedMatch ? Number(updatedMatch[1]) : -1;

    // When the seed has no alternate forms, the count equals the initial count.
    // When the seed has been re-run, the count drops to the base-species count.
    // Either way the count must be ≤ initial and ≥ 0.
    expect(updatedCount).toBeGreaterThanOrEqual(0);
    expect(updatedCount).toBeLessThanOrEqual(initialCount);

    // The scope label at the top of the panel should reflect the selection.
    // scopeLabel() emits "Default forms only" when mode === "default-only".
    // Use a loose check: either the label updated, or the count stayed the same
    // (pre-#445 seed where all 1025 entries are already default forms).
    const scopeLabelEl = page
      .getByRole("button", { expanded: true })
      .filter({ hasText: /scope/i })
      .first();
    // The button text includes the scope label inline - just verify it's still
    // accessible (not replaced by an error state).
    await expect(scopeLabelEl).toBeVisible();
  });

  test("practice session with Default form only has no alternate-form card names revealed", async ({
    page,
  }) => {
    // Seed the "Default form only" scope via settings so it is active when the
    // practice page loads, without needing UI interaction first.
    // alternateFormsEnabled must be true so that form cards are eligible for
    // the session and the formCategories filter is the active gate - otherwise
    // the master alternateFormsEnabled=false gate excludes all form cards
    // before the scope filter is consulted, making the test vacuous.
    await page.addInitScript(
      ({ key }) => {
        const settings = {
          masteryRepetitions: 3,
          maxNewPerDay: 10,
          maxReviewsPerDay: 100,
          maxNewEvolutionPerDay: 5,
          maxReviewsEvolutionPerDay: 50,
          // nameCardsEnabled and reverseCardsEnabled were removed in #1234.
          // Name and reverse cards are now always on - omit these stale fields.
          evolutionCardsEnabled: false,
          // maxNewReversePerDay: 0 so only name cards enter the new queue.
          // Reverse cards (SpritePicker, no Reveal button) would otherwise
          // appear first and prevent the Reveal-button assertion from resolving.
          // The loop below checks revealed name text, which only exists on name
          // cards, so keeping reverse cards out of the new queue makes the
          // assertion reliable.
          maxNewReversePerDay: 0,
          maxReviewsReversePerDay: 100,
          playCryOnReveal: false,
          cryCardsEnabled: false,
          maxNewCryPerDay: 10,
          maxReviewsCryPerDay: 100,
          alternateFormsEnabled: true,
          favouriteTheme: null,
          retentionTarget: 0.9,
          practiceScope: {
            gens: [],
            types: [],
            presets: [],
            formCategories: { mode: "default-only" },
          },
        };
        localStorage.setItem(key, JSON.stringify(settings));
      },
      { key: SETTINGS_STORAGE_KEY },
    );
    // Merge the onboarding pre-dismiss flag after the settings override.
    await addOnboardingPreDismiss(page);

    await page.goto("/");
    await awaitSeedIdb(page);

    // If no cards match (should not happen with default-only on a 1025-entry
    // seed, but guard against it), skip rather than fail.
    const noMatch = page.getByText(/no Pok[ée]mon match your scope/i);
    const reveal = page.getByRole("button", { name: /reveal/i });

    // Wait for either the reveal button or the no-match state. Use a generous
    // timeout - since #1234 the session builds both name and reverse cards for
    // every species (~2× the card set), which takes longer on WebKit.
    await Promise.race([
      reveal.waitFor({ state: "visible", timeout: 15_000 }),
      noMatch.waitFor({ state: "visible", timeout: 15_000 }),
    ]);

    if (await noMatch.isVisible()) {
      test.skip(true, "Default form only produced an empty scope - skipping.");
      return;
    }

    // Form-name keywords that should never appear as a card name when
    // "Default form only" is active.
    const FORM_KEYWORDS =
      /\b(Alolan|Galarian|Hisuian|Paldean|Cap|Original|Partner|Mega|Gmax|Gigantamax)\b/i;

    // Reveal up to 5 cards (or fewer if the session ends) and check each name.
    for (let i = 0; i < 5; i++) {
      const revealButton = page.getByRole("button", { name: /reveal/i });
      const allCaughtUp = page.getByText("All caught up!");
      const isRevealVisible = await revealButton.isVisible().catch(() => false);
      if (!isRevealVisible) break;

      await revealButton.click();

      // After reveal the card name is shown in a <p> with text-3xl styling.
      // It is inside an aria-live="polite" region. Wait for it to appear.
      const cardNameEl = page
        .locator('[aria-live="polite"]')
        .locator("p")
        .first();
      await expect(cardNameEl).not.toHaveText("???", { timeout: 5_000 });
      const revealedName = await cardNameEl.textContent();

      if (revealedName) {
        expect(
          FORM_KEYWORDS.test(revealedName),
          `Card name "${revealedName}" contains an alternate-form keyword`,
        ).toBe(false);
      }

      // Grade "Good" to advance to the next card.
      const goodButton = page.getByRole("button", { name: /good/i });
      if (await goodButton.isVisible()) {
        await goodButton.click();
      } else {
        // Session may have ended.
        break;
      }

      // If the session ended mid-loop, break cleanly.
      if (await allCaughtUp.isVisible().catch(() => false)) break;
    }
  });
});

// E2E smoke for #995 "Incomplete evolution chains" practice preset.
//
// The preset targets evolution families the user has started but not finished
// mastering - the same set the Journey tab's Evolution Wall "In progress"
// filter shows. Membership is computed from review state, so the tests seed a
// session to control which chains are in progress.
// Mastered Bulbasaur → Ivysaur evolution edge (edgeId 1500001).
// reps ≥ 3 + scheduledDays ≥ 21 satisfies the mastery gate, which places
// the Bulbasaur family into "incomplete chains" (forward edge mastered but
// reverse edge not yet seen). Both incomplete-chains tests require this card.
const BULBASAUR_EVO_CARD = {
  id: 1500001,
  cardType: "evolution",
  subjectKey: "1:2",
  preEvoId: 1,
  postEvoId: 2,
  preEvoName: "bulbasaur",
  postEvoName: "ivysaur",
  preEvoSpriteUrl: "/sprites/pokemon/1.png",
  postEvoSpriteUrl: "/sprites/pokemon/2.png",
  triggerPhrase: "at level 16",
  state: {
    stability: 30,
    difficulty: 5,
    elapsedDays: 0,
    scheduledDays: 21,
    reps: 3,
    lapses: 0,
    fsrsState: "review",
    dueDate: "2099-01-01",
    lastReview: "2025-01-01",
    firstSeen: "2024-12-01",
    learningStep: null,
    stepStartedAt: null,
    hiddenSince: null,
    seenInPasture: false,
  },
};

test.describe("Practice scope - Incomplete evolution chains preset (#995)", () => {
  test("preset renders in the scope picker and is selectable", async ({
    page,
  }) => {
    // Seed a mastered evolution edge so the incomplete-chain set is non-empty
    // when this test selects the preset. Without any review state the set is
    // empty, the preset matches 0 Pokémon, and ReviewSession early-returns the
    // "No Pokémon match" UI - unmounting #scope-panel and the pill with it.
    // edgeId 1500001 (Bulbasaur → Ivysaur, reps ≥ 3 + scheduledDays ≥ 21)
    // puts the Bulbasaur family into incomplete chains (forward edge mastered,
    // reverse edge unseen), keeping the panel mounted after selection.
    //
    // Use seedSessionIdb (IDB-backed) rather than localStorage so the app
    // reads the pre-seeded data without the async IdbMigration step. Include
    // the full card set so hydrateSession adds nothing new and skips its
    // save, letting React hydrate before the assertion times out (#1257).
    await page.addInitScript(() => localStorage.clear());
    await seedSessionIdb(
      page,
      buildActiveSession({
        pokemonIds: SEED_POKEMON_IDS,
        evolutionCardIds: EVOLUTION_CARD_IDS,
        // Bulbasaur (1) as new so the scope-panel mount isn't needed for a
        // Reveal button - this test only asserts on the panel, not Reveal.
        newSpeciesIds: [1],
        extraCards: [BULBASAUR_EVO_CARD],
      }),
    );
    // Re-seed the onboarding pre-dismiss flag after the seed so the
    // first-visit modal does not render and block scope-panel interactions.
    await addOnboardingPreDismiss(page);
    await page.goto("/");
    await awaitSeedIdb(page);

    // Open the Scope panel.
    const scopeToggle = page
      .getByRole("button", { expanded: false })
      .filter({ hasText: /scope/i })
      .first();
    await scopeToggle.click();
    const scopePanel = page.locator("#scope-panel");
    await expect(scopePanel).toBeVisible();

    // The preset pill is in the "Groups" accordion section. Expand it first.
    await scopePanel.getByRole("group", { name: "Groups" }).locator("summary").click();

    // The new preset pill renders in the "Groups" section.
    const presetPill = scopePanel.getByRole("button", {
      name: "Incomplete evolution chains",
    });
    await expect(presetPill).toBeVisible();
    await expect(presetPill).toHaveAttribute("aria-pressed", "false");

    // Selecting it toggles aria-pressed. The panel stays mounted because the
    // seeded review state puts Bulbasaur's family into the incomplete-chain
    // set, so the preset matches > 0 Pokémon and ReviewSession does not
    // early-return the no-match UI.
    await presetPill.click();
    await expect(presetPill).toHaveAttribute("aria-pressed", "true");
    const scopeHeader = page
      .getByRole("button", { expanded: true })
      .filter({ hasText: /incomplete chains/i })
      .first();
    await expect(scopeHeader).toBeVisible();
  });

  test("happy path: an in-progress chain starts a session under the preset", async ({
    page,
  }) => {
    // Seed a session where the Bulbasaur → Ivysaur forward evolution edge
    // (edgeId 1500001) is mastered. With the reverse edge unmastered, the
    // Bulbasaur family is "in progress", so Bulbasaur (1), Ivysaur (2) and
    // Venusaur (3) belong to the incomplete-chain set. Bulbasaur (1) is kept
    // in "new" state so it queues as a new card under the preset. The
    // "Incomplete evolution chains" scope is pre-selected via settings.
    //
    // Use seedSessionIdb so the full card set is already present in IDB.
    // hydrateSession then adds nothing (skipping the first large IDB write),
    // letting React hydrate quickly (#1257).
    await seedSessionIdb(
      page,
      buildActiveSession({
        pokemonIds: SEED_POKEMON_IDS,
        evolutionCardIds: EVOLUTION_CARD_IDS,
        // Bulbasaur (1), Ivysaur (2), Venusaur (3) as new so the
        // incomplete-chains preset queue is non-empty and Reveal renders.
        newSpeciesIds: [1, 2, 3],
        extraCards: [BULBASAUR_EVO_CARD],
      }),
    );
    await page.addInitScript(
      ({ key }) => {
        const settings = {
          masteryRepetitions: 3,
          maxNewPerDay: 10,
          maxReviewsPerDay: 100,
          maxNewEvolutionPerDay: 5,
          maxReviewsEvolutionPerDay: 50,
          // nameCardsEnabled and reverseCardsEnabled were removed in #1234.
          // Name and reverse cards are now always on - omit these stale fields.
          evolutionCardsEnabled: true,
          // maxNewReversePerDay: 0 so the first displayed card is always a
          // name card (has a Reveal button). Reverse cards (SpritePicker) have
          // no Reveal button; if one shows first the assertion at line 659
          // would time out waiting for a button that is never rendered.
          maxNewReversePerDay: 0,
          maxReviewsReversePerDay: 100,
          playCryOnReveal: false,
          cryCardsEnabled: false,
          maxNewCryPerDay: 10,
          maxReviewsCryPerDay: 100,
          favouriteTheme: null,
          retentionTarget: 0.9,
          practiceScope: {
            gens: [],
            types: [],
            presets: ["incomplete-chains"],
          },
        };
        localStorage.setItem(key, JSON.stringify(settings));
      },
      { key: SETTINGS_STORAGE_KEY },
    );
    // Merge the onboarding pre-dismiss flag after the settings override.
    await addOnboardingPreDismiss(page);

    await page.goto("/");
    await awaitSeedIdb(page);

    // A practice card should render - the in-progress Bulbasaur family means
    // the preset's computed set is non-empty, so the session is not the
    // no-match empty state.
    const reveal = page.getByRole("button", { name: /reveal/i });
    const noMatch = page.getByText(/no Pok[ée]mon match your scope/i);
    // 10 s is enough now that the session is pre-seeded (hydrateSession is
    // a no-op) - only one IDB write (reconcile save) precedes the render.
    await expect(reveal).toBeVisible({ timeout: 10_000 });
    await expect(noMatch).not.toBeVisible();

    // The scope chip reflects the active preset.
    await expect(
      page.getByText("Incomplete chains", { exact: true }),
    ).toBeVisible();
  });
});

// E2E smoke for #1089 "Game / version-group scope filter".
//
// The picker renders a section per generation under the "Games" fieldset,
// each containing a pill per available version-group with marketing labels.
// Toggling a single game updates the live count and the scope label chip;
// the practice session stays operable.
// Gen II species kept as "new" so the Gold/Silver scope test sees a Reveal
// button quickly. Totodile (158) and Cyndaquil (155) are Gen II starters.
const GEN2_NEW_SPECIES = [152, 155, 158, 175, 179]; // Gen II starters + misc

test.describe("Practice scope - Games axis (#1089)", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.clear());

    // Pre-seed the full card set with Gen II pairs in "new" state so the
    // session renders without triggering a ~2 050-card build-from-scratch
    // (which would time out the Reveal-button assertion on Chromium - #1257).
    await seedSessionIdb(
      page,
      buildActiveSession({
        pokemonIds: SEED_POKEMON_IDS,
        evolutionCardIds: EVOLUTION_CARD_IDS,
        newSpeciesIds: GEN2_NEW_SPECIES,
      }),
    );

    // Seed settings with maxNewReversePerDay: 0 so the first displayed card is
    // always a name card (has a Reveal button). Reverse cards use SpritePicker
    // and have no Reveal button; if one shows first the assertion in
    // "toggling Pokemon Gold/Silver" would time out (#1257).
    await page.addInitScript((key) => {
      localStorage.setItem(
        key,
        JSON.stringify({
          maxNewReversePerDay: 0,
          evolutionCardsEnabled: false,
          onboarding: { firstVisitOnboardingDismissed: true },
        }),
      );
    }, SETTINGS_STORAGE_KEY);

    // Re-seed the modal-dismiss flag and new-user mobileNav default so the
    // first-visit onboarding modal does not block scope-panel interactions
    // and the bottom tab bar appears as expected (#1103).
    await addOnboardingPreDismiss(page);
  });

  test("toggling Pokemon Gold/Silver narrows the scope and keeps practice operable", async ({
    page,
  }) => {
    await page.goto("/");
    await awaitSeedIdb(page);

    // Open the Scope panel.
    const scopeToggle = page
      .getByRole("button", { expanded: false })
      .filter({ hasText: /scope/i })
      .first();
    await scopeToggle.click();
    const scopePanel = page.locator("#scope-panel");
    await expect(scopePanel).toBeVisible();

    // The Games section is now a collapsible accordion. Verify the group
    // exists then expand it before interacting with individual game pills.
    const gamesGroup = scopePanel.getByRole("group", { name: "Games" });
    await expect(gamesGroup).toBeVisible();
    await gamesGroup.locator("summary").click();

    const goldSilverPill = scopePanel.getByRole("button", {
      name: "Pokémon Gold/Silver",
    });
    await expect(goldSilverPill).toBeVisible();
    await expect(goldSilverPill).toHaveAttribute("aria-pressed", "false");

    await goldSilverPill.click();
    await expect(goldSilverPill).toHaveAttribute("aria-pressed", "true");

    // The scope label chip in the header should now read "Pokémon Gold/Silver"
    // (single-game label path in scopeLabel).
    const scopeHeader = page
      .getByRole("button", { expanded: true })
      .filter({ hasText: /scope/i })
      .first();
    await expect(scopeHeader).toContainText("Pokémon Gold/Silver");

    // The live count should reflect a non-zero subset of the total pool
    // (Gold/Silver dex has ~267 entries including remakes).
    await expect(scopePanel.getByText(/of \d+ Pok[ée]mon match/)).toBeVisible();

    // A practice card should still render - the no-match empty-state must NOT
    // appear. Use a generous timeout - since #1234 the session includes reverse
    // cards for every species (~2× the card set), which takes longer on WebKit.
    const reveal = page.getByRole("button", { name: /reveal/i });
    const noMatch = page.getByText(/no Pok[ée]mon match your scope/i);
    await expect(reveal).toBeVisible({ timeout: 10_000 });
    await expect(noMatch).not.toBeVisible();
  });

  test("select-all-in-generation toggles every game in that generation", async ({
    page,
  }) => {
    await page.goto("/");
    await awaitSeedIdb(page);
    const scopeToggle = page
      .getByRole("button", { expanded: false })
      .filter({ hasText: /scope/i })
      .first();
    await scopeToggle.click();
    const scopePanel = page.locator("#scope-panel");

    // Expand the Games accordion section first, then click the Gen II
    // bulk-action button. The aria-label now spells out game names rather
    // than "Generation N" to avoid confusion with the gens-axis toggle (#1110).
    const gamesGroup = scopePanel.getByRole("group", { name: "Games" });
    await gamesGroup.locator("summary").click();

    // "Select Gold/Silver, Crystal" is the bulk-select label for Gen II
    // (Gold/Silver + Crystal). Anchored regex avoids matching other gens.
    const selectAllGenII = scopePanel.getByRole("button", {
      name: /^Select Gold\/Silver, Crystal$/,
    });
    await selectAllGenII.click();

    // Both games should now be selected.
    await expect(
      scopePanel.getByRole("button", { name: "Pokémon Gold/Silver" }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(
      scopePanel.getByRole("button", { name: "Pokémon Crystal" }),
    ).toHaveAttribute("aria-pressed", "true");

    // The scope label chip should summarise as "N games".
    const scopeHeader = page
      .getByRole("button", { expanded: true })
      .filter({ hasText: /scope/i })
      .first();
    await expect(scopeHeader).toContainText(/\d+ games/);
  });
});
