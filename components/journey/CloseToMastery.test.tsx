/**
 * Component tests for CloseToMastery (issue #1312).
 *
 * Covers:
 *   1. Empty-state message when entries is empty.
 *   2. Populated list — heading, subtitle count, sprite, name, interval bar, days-remaining badge.
 *   3. Entry where reverse card is not yet started (reverseIntroduced = false).
 *   4. Entry where reverse card is ready (daysRemaining = 0).
 *   5. Truncation — shows at most 10 entries with a footer for the overflow.
 *   6. Exactly 10 entries — no footer.
 *
 * Lives in components/ so the jsdom vitest project picks it up.
 */

import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { CloseToMastery } from "./CloseToMastery";
import type { CloseToMasteryEntry } from "@/lib/journey/closeToMastery";

// ---------------------------------------------------------------------------
// Mock next/image — no HTTP server needed in jsdom.
// ---------------------------------------------------------------------------

vi.mock("next/image", () => ({
  default: (props: React.ImgHTMLAttributes<HTMLImageElement>) => (
    // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
    <img {...props} />
  ),
}));

// ---------------------------------------------------------------------------
// Mock useLocalePokemonName — returns the englishName synchronously so tests
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
    reverseScheduledDays: overrides.reverseScheduledDays ?? 10,
    reverseReps: overrides.reverseReps ?? 2,
    reverseIntroduced: overrides.reverseIntroduced ?? true,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("CloseToMastery — empty state", () => {
  it("shows the section heading", () => {
    render(<CloseToMastery entries={[]} />);
    expect(
      screen.getByRole("heading", { name: "Close to mastery" }),
    ).toBeInTheDocument();
  });

  it("shows the empty-state message", () => {
    render(<CloseToMastery entries={[]} />);
    expect(
      screen.getByText(/No gap to close right now/i),
    ).toBeInTheDocument();
  });

  it("does not render the subtitle count paragraph", () => {
    render(<CloseToMastery entries={[]} />);
    expect(screen.queryByText(/species to go/i)).not.toBeInTheDocument();
  });

  it("does not render the species list", () => {
    render(<CloseToMastery entries={[]} />);
    expect(
      screen.queryByRole("list", { name: "Species close to mastery" }),
    ).not.toBeInTheDocument();
  });
});

describe("CloseToMastery — populated list", () => {
  const entries = [
    makeEntry(1, "Bulbasaur", { reverseScheduledDays: 18, reverseReps: 5 }),
    makeEntry(4, "Charmander", { reverseScheduledDays: 7, reverseReps: 2 }),
  ];

  it("shows the section heading", () => {
    render(<CloseToMastery entries={entries} />);
    expect(
      screen.getByRole("heading", { name: "Close to mastery" }),
    ).toBeInTheDocument();
  });

  it("shows the subtitle with the species count", () => {
    render(<CloseToMastery entries={entries} />);
    // The subtitle contains the entry count as a number
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText(/species to go/i)).toBeInTheDocument();
  });

  it("renders the accessible list", () => {
    render(<CloseToMastery entries={entries} />);
    expect(
      screen.getByRole("list", { name: "Species close to mastery" }),
    ).toBeInTheDocument();
  });

  it("renders a list item for each entry", () => {
    render(<CloseToMastery entries={entries} />);
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);
  });

  it("renders each entry's English name", () => {
    render(<CloseToMastery entries={entries} />);
    expect(screen.getByText("Bulbasaur")).toBeInTheDocument();
    expect(screen.getByText("Charmander")).toBeInTheDocument();
  });

  it("renders each entry's sprite image (decorative, empty alt)", () => {
    const { container } = render(<CloseToMastery entries={entries} />);
    // The sprite images have alt="" and are wrapped in aria-hidden="true" divs
    // so they get the "presentation" role in the accessibility tree. Query by
    // the img element directly.
    const imgs = container.querySelectorAll("img");
    const srcs = Array.from(imgs).map((img) => img.getAttribute("src"));
    expect(srcs).toContain("/sprites/pokemon/1.png");
    expect(srcs).toContain("/sprites/pokemon/4.png");
  });

  it("renders interval progress labels for introduced entries", () => {
    render(<CloseToMastery entries={entries} />);
    // aria-label: "18 / 21 day interval" and "7 / 21 day interval"
    expect(
      screen.getByLabelText("18 / 21 day interval"),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText("7 / 21 day interval"),
    ).toBeInTheDocument();
  });

  it("renders the days-remaining badge for introduced entries", () => {
    render(<CloseToMastery entries={entries} />);
    // Bulbasaur: 21 - 18 = 3 days remaining → "-3d"
    // Charmander: 21 - 7 = 14 days remaining → "-14d"
    expect(screen.getByLabelText("3 more days needed")).toBeInTheDocument();
    expect(screen.getByLabelText("14 more days needed")).toBeInTheDocument();
  });

  it("does not show the overflow footer when entries <= 10", () => {
    render(<CloseToMastery entries={entries} />);
    expect(screen.queryByText(/Showing 10 of/i)).not.toBeInTheDocument();
  });
});

describe("CloseToMastery — not-yet-started entry (reverseIntroduced = false)", () => {
  const entry = makeEntry(7, "Squirtle", {
    reverseScheduledDays: 0,
    reverseReps: 0,
    reverseIntroduced: false,
  });

  it("shows the 'not started' label for an unintroduced reverse card", () => {
    render(<CloseToMastery entries={[entry]} />);
    expect(screen.getByLabelText("Not yet started")).toBeInTheDocument();
  });

  it("shows 'not started' text in the interval column", () => {
    render(<CloseToMastery entries={[entry]} />);
    expect(screen.getByText("not started")).toBeInTheDocument();
  });

  it("does not render a days-remaining badge for an unintroduced entry", () => {
    render(<CloseToMastery entries={[entry]} />);
    // The badge only renders when reverseIntroduced is true.
    expect(screen.queryByLabelText(/more days needed/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Ready for mastery")).not.toBeInTheDocument();
  });
});

describe("CloseToMastery — ready-for-mastery entry (daysRemaining = 0)", () => {
  // scheduledDays >= MASTERY_INTERVAL_DAYS (21) means daysRemaining = 0.
  const entry = makeEntry(25, "Pikachu", {
    reverseScheduledDays: 21,
    reverseReps: 4,
    reverseIntroduced: true,
  });

  it("shows the 'Ready for mastery' label", () => {
    render(<CloseToMastery entries={[entry]} />);
    expect(screen.getByLabelText("Ready for mastery")).toBeInTheDocument();
  });

  it("renders 'Ready' text in the badge", () => {
    render(<CloseToMastery entries={[entry]} />);
    expect(screen.getByText("Ready")).toBeInTheDocument();
  });
});

describe("CloseToMastery — truncation (more than 10 entries)", () => {
  // Build 12 entries — only 10 should be displayed with a footer.
  const manyEntries: CloseToMasteryEntry[] = Array.from(
    { length: 12 },
    (_, i) =>
      makeEntry(i + 1, `Pokemon${i + 1}`, {
        reverseScheduledDays: 10 - (i % 10),
      }),
  );

  it("renders exactly 10 list items when 12 entries are provided", () => {
    render(<CloseToMastery entries={manyEntries} />);
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(10);
  });

  it("shows the overflow footer citing the total count", () => {
    render(<CloseToMastery entries={manyEntries} />);
    expect(screen.getByText(/Showing 10 of 12/i)).toBeInTheDocument();
  });

  it("footer mentions practising reverse cards", () => {
    render(<CloseToMastery entries={manyEntries} />);
    expect(screen.getByText(/practise reverse cards/i)).toBeInTheDocument();
  });
});

describe("CloseToMastery — exactly 10 entries (no footer)", () => {
  const tenEntries: CloseToMasteryEntry[] = Array.from(
    { length: 10 },
    (_, i) =>
      makeEntry(i + 1, `Pokemon${i + 1}`, { reverseScheduledDays: 5 }),
  );

  it("renders all 10 list items", () => {
    render(<CloseToMastery entries={tenEntries} />);
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(10);
  });

  it("does not show the overflow footer for exactly 10 entries", () => {
    render(<CloseToMastery entries={tenEntries} />);
    expect(screen.queryByText(/Showing 10 of/i)).not.toBeInTheDocument();
  });
});
