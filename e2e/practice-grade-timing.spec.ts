/**
 * E2E timing assertion for grade→next-card visible swap (#1191).
 *
 * PRs #1194 and #1195 moved the visible card swap (setCards, setRevealed) to
 * fire *before* persistence awaits, capped the decode-ahead at 150 ms, and
 * introduced the `waitForAudioOnGrade` setting. The unit-test suite asserts
 * the ordering is correct, but no test measures the actual wall-clock swap
 * time. This spec locks in the behaviour at the e2e level.
 *
 * Design choices:
 *   - chromium only: mobile-safari has too much CI variance for sub-second
 *     wall-clock assertions. One engine is sufficient to catch a regression
 *     where the reorder is undone.
 *   - 250 ms median / 600 ms max bars: empirically tuned from observed CI
 *     samples (median ~124 ms, max ~280 ms on shared GitHub-hosted chromium
 *     runners). ~2x headroom catches a 2x regression (e.g. a partial undo of
 *     the reorder that re-adds 100-200 ms to the critical path) while
 *     absorbing cold-cache and GC variance. The issue's <100 ms target is the
 *     aspirational product goal; the CI bars are the regression guard.
 *   - Median over 5 samples: resistant to single GC-pause outliers. A max
 *     guard catches a single pathological outlier without tightening the
 *     median bar.
 *   - Timing inside page.evaluate: avoids IPC overhead (50-200 ms per round
 *     trip) that would otherwise inflate every measurement.
 */
import { test, expect } from "@playwright/test";
import {
  seedSessionIdb,
  awaitSeedIdb,
} from "./helpers/seedIdb";
import {
  buildCompletedSession,
  SEED_POKEMON_IDS,
  EVOLUTION_CARD_IDS,
} from "./helpers/completedSession";

// ---------------------------------------------------------------------------
// Session fixture: all known cards future-due so hydrateSession adds nothing,
// then override six name cards (ids 1–6) to be past-due review cards. Five
// are graded in the measurement loop; the sixth stays on the queue so the
// fifth grade reveals the next card rather than ending the session.
// ---------------------------------------------------------------------------

const DUE_CARD_IDS = [1, 2, 3, 4, 5, 6];

const REVIEW_DUE_STATE = {
  stability: 10,
  difficulty: 5,
  elapsedDays: 10,
  scheduledDays: 10,
  reps: 3,
  lapses: 0,
  fsrsState: "review",
  dueDate: "2026-01-01",
  lastReview: "2026-04-01",
  firstSeen: "2026-03-01",
  learningStep: null,
  stepStartedAt: null,
  hiddenSince: null,
  seenInPasture: false,
} as const;

const baseSession = buildCompletedSession({
  pokemonIds: SEED_POKEMON_IDS,
  evolutionCardIds: EVOLUTION_CARD_IDS,
});

/** Session with six past-due name cards; five are graded in the loop, the sixth prevents session-end on the last grade. */
const SESSION_WITH_SIX_DUE_NAME_CARDS = {
  ...baseSession,
  cards: (baseSession.cards as Array<{ id: number; [key: string]: unknown }>).map(
    (c) =>
      DUE_CARD_IDS.includes(c.id)
        ? { ...c, state: { ...REVIEW_DUE_STATE } }
        : c,
  ),
  limits: {
    // Allow up to 100 reviews per day across name cards; disable other types
    // so only name cards enter the session. This prevents evolution/reverse
    // cards from appearing mid-measurement and changing the swap path.
    name: { maxNewPerDay: 0, maxReviewsPerDay: 100 },
    evolution: { maxNewPerDay: 0, maxReviewsPerDay: 0 },
    reverse: { maxNewPerDay: 0, maxReviewsPerDay: 0 },
    cry: { maxNewPerDay: 0, maxReviewsPerDay: 0 },
  },
};

// ---------------------------------------------------------------------------
// Settings written to localStorage before the page loads:
//
//   waitForAudioOnGrade: false  — opt into the fast swap path (#1191)
//   playCryOnReveal: false      — no audio queued; nothing to wait for
//   speakNameOnReveal: false
//   playCryOnAnswer: false
//   speakNameOnAnswer: false
//   nameCardsEnabled: true      — keep name cards explicitly on
//   evolutionCardsEnabled: false
//   reverseCardsEnabled: false
//   cryCardsEnabled: false
//   maxNewPerDay: 0             — no new cards introduced mid-session
//   maxReviewsPerDay: 100       — high daily cap so session never stalls
//   mobileNav: "bottom"         — avoids the hamburger-nav migration default
// ---------------------------------------------------------------------------
const TIMING_SETTINGS = {
  waitForAudioOnGrade: false,
  playCryOnReveal: false,
  speakNameOnReveal: false,
  playCryOnAnswer: false,
  speakNameOnAnswer: false,
  nameCardsEnabled: true,
  evolutionCardsEnabled: false,
  reverseCardsEnabled: false,
  cryCardsEnabled: false,
  maxNewPerDay: 0,
  maxReviewsPerDay: 100,
  mobileNav: "bottom",
  onboarding: { firstVisitOnboardingDismissed: true },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Compute the median of a sorted (or unsorted) array of numbers. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

// ---------------------------------------------------------------------------
// Spec
// ---------------------------------------------------------------------------

test.describe("Grade→next-card swap timing (#1191)", () => {
  // Chromium only — mobile-safari CI variance is too high for sub-second
  // assertions. This mirrors the pattern in keyboard-review.spec.ts.
  test.skip(({ browserName }) => browserName !== "chromium", "chromium only");

  test.beforeEach(async ({ page }) => {
    // Register settings before the session seed so the onboarding flag
    // lands in the same localStorage key as the rest of the settings.
    await page.addInitScript((settings: Record<string, unknown>) => {
      localStorage.setItem(
        "poke-memory:settings:v1",
        JSON.stringify(settings),
      );
    }, TIMING_SETTINGS as unknown as Record<string, unknown>);

    // Seed the session AFTER settings so IdbMigration.tsx skips the
    // localStorage read and never overwrites our IDB payload.
    await seedSessionIdb(page, SESSION_WITH_SIX_DUE_NAME_CARDS);
  });

  test("median grade→next-card swap time is under 250 ms across five review cards", async ({
    page,
  }) => {
    await page.goto("/");
    await awaitSeedIdb(page);

    // Wait for the first card to be ready — the Reveal button is the canonical
    // "session active" indicator.
    const reveal = page.getByRole("button", { name: "Reveal" });
    await expect(reveal).toBeVisible({ timeout: 15_000 });

    const gradeGroup = page.getByRole("group", { name: "Grade your answer" });
    const samples: number[] = [];

    for (let i = 0; i < 5; i++) {
      // Reveal the current card.
      await expect(reveal).toBeVisible({ timeout: 10_000 });
      await reveal.click();
      await expect(gradeGroup).toBeVisible({ timeout: 5_000 });

      // Measure the time from clicking "Good" to the Reveal button
      // reappearing. Both the click and the polling loop run inside the
      // page context so there is no IPC round-trip inflating the numbers.
      const swapMs = await page.evaluate(async () => {
        // Find the "Good" button inside the grade group. Because the
        // evaluation runs in the page context we query the DOM directly.
        const gradeGroupEl = document.querySelector(
          '[role="group"][aria-label="Grade your answer"]',
        );
        if (!gradeGroupEl) throw new Error("Grade group not found in page");

        const goodBtn = Array.from(
          gradeGroupEl.querySelectorAll("button"),
        ).find((b) => b.textContent?.trim().startsWith("Good"));
        if (!goodBtn) throw new Error('"Good" button not found in grade group');

        const t0 = performance.now();
        (goodBtn as HTMLButtonElement).click();

        // Poll every ~16 ms (one animation frame) for the Reveal button to
        // reappear. The Reveal button is the authoritative signal that the
        // visible card swap has committed and the new card is on screen.
        await new Promise<void>((resolve, reject) => {
          const deadline = performance.now() + 5_000; // 5 s safety net
          function check() {
            // The Reveal button renders as a plain <button> with text "Reveal"
            // (no accessible group above it at this point). Detect it by text
            // content inside the main document.
            const revealBtn = Array.from(document.querySelectorAll("button")).find(
              (b) =>
                b.textContent?.trim() === "Reveal" &&
                !(b as HTMLButtonElement).disabled,
            );
            if (revealBtn) {
              resolve();
              return;
            }
            if (performance.now() > deadline) {
              reject(new Error("Timed out waiting for Reveal button after grade"));
              return;
            }
            // ~16 ms polling — one animation frame without the overhead of
            // requestAnimationFrame, which is throttled in background tabs.
            setTimeout(check, 16);
          }
          check(); // immediate pre-check before the first polling interval
        });

        return performance.now() - t0;
      });

      samples.push(swapMs);
    }

    const med = median(samples);
    const max = Math.max(...samples);

    // Log all samples so a CI failure is debuggable from the test output.
    console.log(
      `[grade-timing] samples: [${samples.map((s) => s.toFixed(1)).join(", ")}] ms` +
        ` | median: ${med.toFixed(1)} ms` +
        ` | max: ${max.toFixed(1)} ms`,
    );

    // Median guard: catches a regression where the reorder is undone and the
    // swap reverts to the slow persistence-first path (typically 300-800 ms
    // extra per grade on a shared CI runner). 250 ms is ~2x the observed
    // CI median (124 ms) — tight enough to catch a 2x regression, loose
    // enough to absorb runner-to-runner variance.
    expect(
      med,
      `Median swap time (${med.toFixed(0)} ms) exceeded 250 ms threshold. ` +
        `All samples: [${samples.map((s) => s.toFixed(0)).join(", ")}] ms`,
    ).toBeLessThan(250);

    // Max guard: catches a single pathological outlier (e.g. the reorder
    // regressed only for a specific card type or grade path). 600 ms is ~2x
    // the observed CI max (280 ms) — enough headroom for cold-cache decode.
    expect(
      max,
      `Max swap time (${max.toFixed(0)} ms) exceeded 600 ms threshold. ` +
        `All samples: [${samples.map((s) => s.toFixed(0)).join(", ")}] ms`,
    ).toBeLessThan(600);
  });
});
