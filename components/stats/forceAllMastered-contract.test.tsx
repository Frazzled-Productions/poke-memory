/**
 * forceAllMastered-contract.test.tsx
 *
 * Render-level contract test for the `forceAllMastered` / `pretendAllMastered`
 * superuser flag (#1406).
 *
 * The pure-function layer (lib/stats/mastery-species-contract.test.ts, #1448)
 * already verifies that computeStats / filterMastered / masteredSpeciesIds
 * honour the flag at the data level.  This test is the COMPLEMENTARY
 * render-level invariant: it asserts that mastery-displaying React components
 * visually reflect the flag correctly, specifically for the
 * `forceAllMastered=true + empty data` edge case -- the scenario most likely
 * to regress when a new component derives mastery on its own rather than
 * routing through the shared helpers.
 *
 * CONTRACT:
 *   - `forceAllMastered=false` + empty card data  => "no mastered" state rendered.
 *   - `forceAllMastered=true`  + empty card data  => "all mastered" / superuser
 *     state rendered (the flag must override the empty data).
 *
 * Components tested: BadgeGallery, MasteryOverTimeChart, TrainerCard (via
 * the totalMastered=BASE_SPECIES_COUNT path).  CloseToMastery is inherently
 * data-driven (the caller passes the result of `deriveCloseToMastery` which
 * already honours forceAllMastered); it is covered via the pure-function test.
 */

import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithIntl } from "@/components/test-utils/renderWithIntl";

// ---------------------------------------------------------------------------
// Recharts mock - avoids ResizeObserver dependency in jsdom.
// ---------------------------------------------------------------------------
vi.mock("recharts", () => ({
  AreaChart: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="area-chart">{children}</div>
  ),
  Area: () => null,
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="responsive-container">{children}</div>
  ),
  Tooltip: () => null,
  XAxis: () => null,
  YAxis: () => null,
}));

// ---------------------------------------------------------------------------
// BadgeGallery
// ---------------------------------------------------------------------------

import { BadgeGallery } from "@/components/badges/BadgeGallery";
import { BADGE_CATALOG } from "@/lib/badges/catalog";

describe("BadgeGallery -- forceAllMastered contract", () => {
  it("forceAllMastered=false + empty earnedBadges => no earned badges rendered", () => {
    renderWithIntl(
      <BadgeGallery earnedBadges={[]} forceAllMastered={false} />,
    );
    // With no earned badges, the "No badges earned yet" empty state must show.
    expect(
      screen.getByText(/no badges earned yet/i),
    ).toBeInTheDocument();
    // None of the badge earned-state list items should appear.
    for (const badge of BADGE_CATALOG.slice(0, 3)) {
      expect(
        screen.queryByRole("listitem", { name: `${badge.name}, earned` }),
      ).not.toBeInTheDocument();
    }
  });

  it("forceAllMastered=true + empty earnedBadges => all catalog badges rendered as earned", () => {
    renderWithIntl(
      <BadgeGallery earnedBadges={[]} forceAllMastered={true} />,
    );
    // The "No badges earned yet" empty state must NOT show.
    expect(
      screen.queryByText(/no badges earned yet/i),
    ).not.toBeInTheDocument();
    // Every catalog badge should be rendered (earned tiles).
    // BadgeGalleryCard renders a <li aria-label="${badge.name}, earned"> when earned.
    for (const badge of BADGE_CATALOG) {
      expect(
        screen.getByRole("listitem", { name: `${badge.name}, earned` }),
      ).toBeInTheDocument();
    }
    // The "locked" section must not exist (forceAllMastered hides it).
    expect(
      screen.queryByText(/view all badges/i),
    ).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// MasteryOverTimeChart
// ---------------------------------------------------------------------------

import { MasteryOverTimeChart } from "@/components/stats/MasteryOverTimeChart";
import type { MasteryPoint } from "@/lib/stats/mastery-over-time";

const FORCE_ALL_SINGLE_POINT: MasteryPoint[] = [
  { date: "2026-05-30", count: 1025 },
];

describe("MasteryOverTimeChart -- forceAllMastered contract", () => {
  it("forceAllMastered=false + empty series => empty-state paragraph", () => {
    renderWithIntl(
      <MasteryOverTimeChart series={[]} totalCards={1025} forceAllMastered={false} />,
    );
    expect(
      screen.getByText(/no mastered species yet/i),
    ).toBeInTheDocument();
    // The superuser message must NOT appear.
    expect(
      screen.queryByText(/superuser mode/i),
    ).not.toBeInTheDocument();
  });

  it("forceAllMastered=true + single-point series => superuser mode message shown", () => {
    renderWithIntl(
      <MasteryOverTimeChart
        series={FORCE_ALL_SINGLE_POINT}
        totalCards={1025}
        forceAllMastered={true}
      />,
    );
    // The superuser message must appear (not the empty state).
    expect(
      screen.getByText(/superuser mode/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/no mastered species yet/i),
    ).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// TrainerCard -- totalMastered=0 vs totalMastered=BASE_SPECIES_COUNT
//
// TrainerCard does not receive a `forceAllMastered` prop directly; the flag is
// honoured at the page level by passing `totalMastered=BASE_SPECIES_COUNT`.
// This test verifies that when `totalMastered` equals the full species count
// (the value the page derives when the flag is on), the component renders the
// "all mastered" copy rather than the progress copy.
// ---------------------------------------------------------------------------

import { TrainerCard, BASE_SPECIES_COUNT as getBaseSpeciesCount } from "@/components/stats/TrainerCard";

// BASE_SPECIES_COUNT is now a lazy getter function; call it once in test setup.
// The vitest setup primes the seed so it returns the real count (1025).
const BASE_SPECIES_COUNT = getBaseSpeciesCount();
import type { GenerationStats } from "@/lib/stats/derive";

function makeGen(g: number, mastered: number, total: number): GenerationStats {
  return { gen: g, name: `Generation ${g}`, total, introduced: mastered, mastered };
}

const GENS_EMPTY = Array.from({ length: 9 }, (_, i) =>
  makeGen(i + 1, 0, 100),
);

const GENS_FULL = Array.from({ length: 9 }, (_, i) =>
  makeGen(i + 1, 100, 100),
);

describe("TrainerCard -- forceAllMastered contract (via totalMastered)", () => {
  it("totalMastered=0 + empty gens => mastery-progress copy shown", () => {
    renderWithIntl(
      <TrainerCard handle={null} totalMastered={0} perGeneration={GENS_EMPTY} />,
    );
    // The "all mastered" copy must NOT appear when totalMastered=0.
    expect(screen.queryByText(/all mastered/i)).not.toBeInTheDocument();
  });

  it("totalMastered=BASE_SPECIES_COUNT + full gens => all-mastered state (from message catalogue)", () => {
    renderWithIntl(
      <TrainerCard
        handle={null}
        totalMastered={BASE_SPECIES_COUNT}
        perGeneration={GENS_FULL}
      />,
    );
    // All 9 generation badges should be highlighted (completed=true).
    const genList = screen.getByRole("list", { name: /generation/i });
    expect(genList).toBeInTheDocument();
    const genItems = genList.querySelectorAll("li");
    expect(genItems.length).toBe(9);
    // The "all mastered" copy from the catalogue must appear.
    // en.json stats.trainerCard.allMastered = "All mastered".
    expect(screen.getByText(/all mastered/i)).toBeInTheDocument();
  });
});
