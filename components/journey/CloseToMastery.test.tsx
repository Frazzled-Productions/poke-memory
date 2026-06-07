/**
 * Component tests for CloseToMastery (issue #1312).
 *
 * Covers:
 *   1. Empty-state message when entries is empty.
 *   2. Populated list - heading, subtitle count, sprite, name, interval bar, days-remaining badge.
 *   3. Entry where reverse card is not yet started (reverseIntroduced = false).
 *   4. Entry where reverse card is ready (daysRemaining = 0).
 *   5. Truncation - shows at most 10 entries with a footer for the overflow.
 *   6. Exactly 10 entries - no footer.
 *
 * Lives in components/ so the jsdom vitest project picks it up.
 */

import { screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { renderWithIntl, renderJa } from "@/components/test-utils/renderWithIntl";
import { CloseToMastery } from "./CloseToMastery";
import type { CloseToMasteryEntry } from "@/lib/journey/closeToMastery";

// ---------------------------------------------------------------------------
// Mock next/image - no HTTP server needed in jsdom.
// ---------------------------------------------------------------------------

vi.mock("next/image", () => ({
  default: (props: React.ImgHTMLAttributes<HTMLImageElement>) => (
    // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
    <img {...props} />
  ),
}));

// ---------------------------------------------------------------------------
// Mock useLocalePokemonName - returns the englishName synchronously so tests
// are deterministic without the locale-sidecar async fetch.
// ---------------------------------------------------------------------------

vi.mock("@/lib/i18n/useLocalePokemonName", () => ({
  useLocalePokemonName: (_speciesId: number, englishName: string) => ({
    name: englishName,
    transliteration: null,
  }),
}));

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function makeEntry(
  speciesId: number,
  name: string,
  overrides: Partial<Omit<CloseToMasteryEntry, "speciesId" | "englishName">> = {},
): CloseToMasteryEntry {
  return {
    speciesId,
    englishName: name,
    spriteUrl: `/sprites/pokemon/${speciesId}.png`,
    reverseStability: overrides.reverseStability ?? 10,
    reverseScheduledDays: overrides.reverseScheduledDays ?? 10,
    reverseReps: overrides.reverseReps ?? 2,
    reverseIntroduced: overrides.reverseIntroduced ?? true,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("CloseToMastery - empty state", () => {
  it("shows the section heading", () => {
    renderWithIntl(<CloseToMastery entries={[]} />);
    expect(
      screen.getByRole("heading", { name: "Close to mastery" }),
    ).toBeInTheDocument();
  });

  it("shows the empty-state message", () => {
    renderWithIntl(<CloseToMastery entries={[]} />);
    expect(
      screen.getByText(/No gap to close right now/i),
    ).toBeInTheDocument();
  });

  it("does not render the subtitle count paragraph", () => {
    renderWithIntl(<CloseToMastery entries={[]} />);
    expect(screen.queryByText(/species to go/i)).not.toBeInTheDocument();
  });

  it("does not render the species list", () => {
    renderWithIntl(<CloseToMastery entries={[]} />);
    expect(
      screen.queryByRole("list", { name: "Species close to mastery" }),
    ).not.toBeInTheDocument();
  });
});

describe("CloseToMastery - populated list", () => {
  const entries = [
    makeEntry(1, "Bulbasaur", { reverseStability: 18, reverseScheduledDays: 18, reverseReps: 5 }),
    makeEntry(4, "Charmander", { reverseStability: 7, reverseScheduledDays: 7, reverseReps: 2 }),
  ];

  it("shows the section heading", () => {
    renderWithIntl(<CloseToMastery entries={entries} />);
    expect(
      screen.getByRole("heading", { name: "Close to mastery" }),
    ).toBeInTheDocument();
  });

  it("shows the subtitle with the species count", () => {
    renderWithIntl(<CloseToMastery entries={entries} />);
    // The count is now rendered inline via t.rich - query for it via the paragraph text.
    // "Name known, reverse card still to learn: 2 species to go." is the full text.
    expect(screen.getByText(/species to go/i)).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("renders the accessible list", () => {
    renderWithIntl(<CloseToMastery entries={entries} />);
    expect(
      screen.getByRole("list", { name: "Species close to mastery" }),
    ).toBeInTheDocument();
  });

  it("renders a list item for each entry", () => {
    renderWithIntl(<CloseToMastery entries={entries} />);
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);
  });

  it("renders each entry's English name", () => {
    renderWithIntl(<CloseToMastery entries={entries} />);
    expect(screen.getByText("Bulbasaur")).toBeInTheDocument();
    expect(screen.getByText("Charmander")).toBeInTheDocument();
  });

  it("renders each entry's sprite image (decorative, empty alt)", () => {
    const { container } = renderWithIntl(<CloseToMastery entries={entries} />);
    // The sprite images have alt="" and are wrapped in aria-hidden="true" divs
    // so they get the "presentation" role in the accessibility tree. Query by
    // the img element directly.
    const imgs = container.querySelectorAll("img");
    const srcs = Array.from(imgs).map((img) => img.getAttribute("src"));
    expect(srcs).toContain("/sprites/pokemon/1.png");
    expect(srcs).toContain("/sprites/pokemon/4.png");
  });

  it("renders interval progress labels for introduced entries", () => {
    renderWithIntl(<CloseToMastery entries={entries} />);
    // aria-label: "18 / 21 day interval" and "7 / 21 day interval"
    expect(
      screen.getByLabelText("18 / 21 day interval"),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText("7 / 21 day interval"),
    ).toBeInTheDocument();
  });

  it("renders the days-remaining badge for introduced entries", () => {
    renderWithIntl(<CloseToMastery entries={entries} />);
    // Bulbasaur: 21 - 18 = 3 days remaining → "-3d"
    // Charmander: 21 - 7 = 14 days remaining → "-14d"
    expect(screen.getByLabelText("3 more days needed")).toBeInTheDocument();
    expect(screen.getByLabelText("14 more days needed")).toBeInTheDocument();
  });

  it("does not show the overflow footer when entries <= 10", () => {
    renderWithIntl(<CloseToMastery entries={entries} />);
    expect(screen.queryByText(/Showing 10 of/i)).not.toBeInTheDocument();
  });
});

describe("CloseToMastery - not-yet-started entry (reverseIntroduced = false)", () => {
  const entry = makeEntry(7, "Squirtle", {
    reverseStability: 0,
    reverseScheduledDays: 0,
    reverseReps: 0,
    reverseIntroduced: false,
  });

  it("shows the 'not started' label for an unintroduced reverse card", () => {
    renderWithIntl(<CloseToMastery entries={[entry]} />);
    expect(screen.getByLabelText("Not yet started")).toBeInTheDocument();
  });

  it("shows 'not started' text in the interval column", () => {
    renderWithIntl(<CloseToMastery entries={[entry]} />);
    expect(screen.getByText("not started")).toBeInTheDocument();
  });

  it("does not render a days-remaining badge for an unintroduced entry", () => {
    renderWithIntl(<CloseToMastery entries={[entry]} />);
    // The badge only renders when reverseIntroduced is true.
    expect(screen.queryByLabelText(/more days needed/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Ready for mastery")).not.toBeInTheDocument();
  });
});

describe("CloseToMastery - ready-for-mastery entry (daysRemaining = 0)", () => {
  // reverseStability >= MASTERY_STABILITY_DAYS (21) means daysRemaining = 0.
  const entry = makeEntry(25, "Pikachu", {
    reverseStability: 21,
    reverseScheduledDays: 21,
    reverseReps: 4,
    reverseIntroduced: true,
  });

  it("shows the 'Ready for mastery' label", () => {
    renderWithIntl(<CloseToMastery entries={[entry]} />);
    expect(screen.getByLabelText("Ready for mastery")).toBeInTheDocument();
  });

  it("renders 'Ready' text in the badge", () => {
    renderWithIntl(<CloseToMastery entries={[entry]} />);
    expect(screen.getByText("Ready")).toBeInTheDocument();
  });
});

describe("CloseToMastery - truncation (more than 10 entries)", () => {
  // Build 12 entries - only 10 should be displayed with a footer.
  const manyEntries: CloseToMasteryEntry[] = Array.from(
    { length: 12 },
    (_, i) =>
      makeEntry(i + 1, `Pokemon${i + 1}`, {
        reverseScheduledDays: 10 - (i % 10),
      }),
  );

  it("renders exactly 10 list items when 12 entries are provided", () => {
    renderWithIntl(<CloseToMastery entries={manyEntries} />);
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(10);
  });

  it("shows the overflow footer citing the total count", () => {
    renderWithIntl(<CloseToMastery entries={manyEntries} />);
    expect(screen.getByText(/Showing 10 of 12/i)).toBeInTheDocument();
  });

  it("footer mentions practising reverse cards", () => {
    renderWithIntl(<CloseToMastery entries={manyEntries} />);
    expect(screen.getByText(/practise reverse cards/i)).toBeInTheDocument();
  });
});

describe("CloseToMastery - exactly 10 entries (no footer)", () => {
  const tenEntries: CloseToMasteryEntry[] = Array.from(
    { length: 10 },
    (_, i) =>
      makeEntry(i + 1, `Pokemon${i + 1}`, { reverseScheduledDays: 5 }),
  );

  it("renders all 10 list items", () => {
    renderWithIntl(<CloseToMastery entries={tenEntries} />);
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(10);
  });

  it("does not show the overflow footer for exactly 10 entries", () => {
    renderWithIntl(<CloseToMastery entries={tenEntries} />);
    expect(screen.queryByText(/Showing 10 of/i)).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Locale coverage (mandatory per AGENTS.md - #1393)
// ---------------------------------------------------------------------------

describe("CloseToMastery - locale coverage (i18n #1393)", () => {
  const entry = {
    speciesId: 1,
    englishName: "Bulbasaur",
    spriteUrl: "/sprites/pokemon/1.png",
    reverseStability: 10,
    reverseScheduledDays: 10,
    reverseReps: 2,
    reverseIntroduced: true,
  };

  it("renders the Japanese heading in ja locale", () => {
    renderJa(<CloseToMastery entries={[]} />);
    // ja journey.closeToMasteryWidget.heading = "習得間近"
    expect(screen.getByRole("heading", { name: "習得間近" })).toBeInTheDocument();
  });

  it("renders the Japanese empty-state message in ja locale", () => {
    renderJa(<CloseToMastery entries={[]} />);
    // ja journey.closeToMasteryWidget.emptyState = "今は埋めるギャップがありません。すばらしい！"
    expect(screen.getByText(/今は埋めるギャップがありません/i)).toBeInTheDocument();
  });

  it("renders the Japanese list aria-label in ja locale when populated", () => {
    const { container } = renderJa(<CloseToMastery entries={[entry]} />);
    // ja journey.closeToMasteryWidget.listAriaLabel = "習得間近の種族"
    expect(
      container.querySelector('[aria-label="習得間近の種族"]'),
    ).toBeInTheDocument();
  });

  it("renders the Japanese not-started text in ja locale", () => {
    renderJa(
      <CloseToMastery
        entries={[{ ...entry, reverseScheduledDays: 0, reverseReps: 0, reverseIntroduced: false }]}
      />,
    );
    // ja journey.closeToMasteryWidget.notStarted = "未開始"
    expect(screen.getByText("未開始")).toBeInTheDocument();
  });

  it("renders the Japanese speciesToGo text with count appearing exactly once", () => {
    const twoEntries = [entry, { ...entry, speciesId: 2, englishName: "Ivysaur" }];
    renderJa(<CloseToMastery entries={twoEntries} />);
    // ja journey.closeToMasteryWidget.speciesToGo = "2 種族残り。" (count rendered once via t.rich)
    expect(screen.getByText(/種族残り/)).toBeInTheDocument();
    // The count "2" appears in the subtitle span exactly once (not doubled).
    const countEls = screen.getAllByText("2");
    // Only one "2" in the subtitle (the em-wrapped count from t.rich).
    // There may be an additional "2" from the interval progress label - filter to the subtitle paragraph.
    const subtitlePara = screen.getByText(/種族残り/).closest("p");
    expect(subtitlePara?.querySelectorAll("span")).toHaveLength(1);
  });
});
