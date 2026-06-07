/**
 * Component tests for CloseToMastery (#1312, extended #1766).
 *
 * Covers:
 *   1. Empty-state message when entries is empty.
 *   2. Populated list - heading, subtitle count, sprite, name, both-leg rows.
 *   3. Name leg always renders as "Mastered" (it is the filter criterion).
 *   4. Reverse leg shows the progress bar and days-remaining badge.
 *   5. Entry where reverse card is not yet started (reverseIntroduced = false).
 *   6. Entry where reverse card is ready (daysRemaining = 0).
 *   7. Truncation - shows at most 10 entries with a footer for the overflow.
 *   8. Exactly 10 entries - no footer.
 *   9. Locale coverage (en / ja / zh-Hans / zh-Hant) for both-leg labels.
 *
 * Lives in components/ so the jsdom vitest project picks it up.
 */

import { screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import {
  renderWithIntl,
  renderJa,
  renderZhHans,
  renderZhHant,
} from "@/components/test-utils/renderWithIntl";
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
// Tests - empty state
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

// ---------------------------------------------------------------------------
// Tests - populated list (both legs per row)
// ---------------------------------------------------------------------------

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
    const imgs = container.querySelectorAll("img");
    const srcs = Array.from(imgs).map((img) => img.getAttribute("src"));
    expect(srcs).toContain("/sprites/pokemon/1.png");
    expect(srcs).toContain("/sprites/pokemon/4.png");
  });

  // ── Both-leg display ────────────────────────────────────────────────────

  it("renders 'Name card' leg label for each entry", () => {
    renderWithIntl(<CloseToMastery entries={entries} />);
    const nameLabels = screen.getAllByText("Name card");
    // Two entries - two name-card leg labels.
    expect(nameLabels).toHaveLength(2);
  });

  it("renders 'Reverse card' leg label for each entry", () => {
    renderWithIntl(<CloseToMastery entries={entries} />);
    const reverseLabels = screen.getAllByText("Reverse card");
    expect(reverseLabels).toHaveLength(2);
  });

  it("name leg shows 'Mastered' label (always mastered in this list)", () => {
    renderWithIntl(<CloseToMastery entries={entries} />);
    // Two entries - two Mastered labels on the name leg meters.
    const masteredLabels = screen.getAllByText("Mastered");
    expect(masteredLabels.length).toBeGreaterThanOrEqual(2);
  });

  it("name leg meter is at 100% (aria-valuenow === MASTERY_STABILITY_DAYS)", () => {
    const { container } = renderWithIntl(<CloseToMastery entries={entries} />);
    // Each entry has two role=meter elements: name (always full) and reverse (progress).
    // Name meters: aria-valuenow === aria-valuemax === 21.
    const meters = container.querySelectorAll('[role="meter"]');
    const fullMeters = Array.from(meters).filter(
      (m) =>
        m.getAttribute("aria-valuenow") === "21" &&
        m.getAttribute("aria-valuemax") === "21",
    );
    expect(fullMeters.length).toBeGreaterThanOrEqual(2);
  });

  it("renders reverse-leg progress labels for introduced entries", () => {
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
    // Bulbasaur: 21 - 18 = 3 days remaining
    // Charmander: 21 - 7 = 14 days remaining
    expect(screen.getByLabelText("3 more days needed")).toBeInTheDocument();
    expect(screen.getByLabelText("14 more days needed")).toBeInTheDocument();
  });

  it("does not show the overflow footer when entries <= 10", () => {
    renderWithIntl(<CloseToMastery entries={entries} />);
    expect(screen.queryByText(/Showing 10 of/i)).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Tests - not-yet-started reverse entry (reverseIntroduced = false)
// ---------------------------------------------------------------------------

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
    expect(screen.queryByLabelText(/more days needed/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Ready for mastery")).not.toBeInTheDocument();
  });

  it("name leg still shows Mastered even when reverse not started", () => {
    renderWithIntl(<CloseToMastery entries={[entry]} />);
    expect(screen.getByText("Mastered")).toBeInTheDocument();
  });

  it("both 'Name card' and 'Reverse card' labels appear", () => {
    renderWithIntl(<CloseToMastery entries={[entry]} />);
    expect(screen.getByText("Name card")).toBeInTheDocument();
    expect(screen.getByText("Reverse card")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Tests - ready-for-mastery entry (daysRemaining = 0)
// ---------------------------------------------------------------------------

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

  it("name leg shows Mastered alongside the ready reverse", () => {
    renderWithIntl(<CloseToMastery entries={[entry]} />);
    expect(screen.getByText("Mastered")).toBeInTheDocument();
    expect(screen.getByText("Name card")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Tests - truncation (more than 10 entries)
// ---------------------------------------------------------------------------

describe("CloseToMastery - truncation (more than 10 entries)", () => {
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

// ---------------------------------------------------------------------------
// Tests - exactly 10 entries (no footer)
// ---------------------------------------------------------------------------

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
// Locale coverage - all four locales for both-leg labels (#1393/#1766)
// ---------------------------------------------------------------------------

describe("CloseToMastery - locale coverage (i18n #1393/#1766)", () => {
  const entry = makeEntry(1, "Bulbasaur", {
    reverseStability: 10,
    reverseScheduledDays: 10,
    reverseReps: 2,
    reverseIntroduced: true,
  });

  // ── Japanese (ja) ──────────────────────────────────────────────────────

  it("renders the Japanese heading in ja locale", () => {
    renderJa(<CloseToMastery entries={[]} />);
    // ja journey.closeToMasteryWidget.heading = "習得間近"
    expect(screen.getByRole("heading", { name: "習得間近" })).toBeInTheDocument();
  });

  it("renders Japanese empty-state message in ja locale", () => {
    renderJa(<CloseToMastery entries={[]} />);
    // ja journey.closeToMasteryWidget.emptyState = "今は埋めるギャップがありません..."
    expect(screen.getByText(/今は埋めるギャップがありません/i)).toBeInTheDocument();
  });

  it("renders Japanese 'Name card' leg label in ja locale", () => {
    renderJa(<CloseToMastery entries={[entry]} />);
    // ja stats.legStatus.nameDirection = "名前カード"
    expect(screen.getByText("名前カード")).toBeInTheDocument();
  });

  it("renders Japanese 'Reverse card' leg label in ja locale", () => {
    renderJa(<CloseToMastery entries={[entry]} />);
    // ja stats.legStatus.reverseDirection = "逆引きカード"
    expect(screen.getByText("逆引きカード")).toBeInTheDocument();
  });

  it("renders Japanese 'Mastered' label on the name leg in ja locale", () => {
    renderJa(<CloseToMastery entries={[entry]} />);
    // ja journey.masteryMastered = "習得済み"
    expect(screen.getByText("習得済み")).toBeInTheDocument();
  });

  it("renders Japanese list aria-label in ja locale when populated", () => {
    const { container } = renderJa(<CloseToMastery entries={[entry]} />);
    // ja journey.closeToMasteryWidget.listAriaLabel = "習得間近の種族"
    expect(
      container.querySelector('[aria-label="習得間近の種族"]'),
    ).toBeInTheDocument();
  });

  it("renders Japanese 'not started' text in ja locale", () => {
    const notStartedEntry = makeEntry(7, "Squirtle", {
      reverseStability: 0,
      reverseReps: 0,
      reverseIntroduced: false,
    });
    renderJa(<CloseToMastery entries={[notStartedEntry]} />);
    // ja journey.closeToMasteryWidget.notStarted = "未開始"
    expect(screen.getByText("未開始")).toBeInTheDocument();
  });

  it("renders the Japanese speciesToGo text", () => {
    const twoEntries = [entry, { ...entry, speciesId: 2, englishName: "Ivysaur" }];
    renderJa(<CloseToMastery entries={twoEntries} />);
    // ja journey.closeToMasteryWidget.speciesToGo contains "種族残り"
    expect(screen.getByText(/種族残り/)).toBeInTheDocument();
  });

  // ── Simplified Chinese (zh-Hans) ───────────────────────────────────────

  it("renders Simplified Chinese heading in zh-Hans locale", () => {
    renderZhHans(<CloseToMastery entries={[]} />);
    // zh-Hans journey.closeToMasteryWidget.heading = "即将掌握"
    expect(screen.getByRole("heading", { name: "即将掌握" })).toBeInTheDocument();
  });

  it("renders Simplified Chinese 'Name card' label in zh-Hans locale", () => {
    renderZhHans(<CloseToMastery entries={[entry]} />);
    // zh-Hans stats.legStatus.nameDirection = "名称卡"
    expect(screen.getByText("名称卡")).toBeInTheDocument();
  });

  it("renders Simplified Chinese 'Reverse card' label in zh-Hans locale", () => {
    renderZhHans(<CloseToMastery entries={[entry]} />);
    // zh-Hans stats.legStatus.reverseDirection = "反向卡"
    expect(screen.getByText("反向卡")).toBeInTheDocument();
  });

  it("renders Simplified Chinese 'Mastered' label on the name leg in zh-Hans locale", () => {
    renderZhHans(<CloseToMastery entries={[entry]} />);
    // zh-Hans journey.masteryMastered = "已掌握"
    expect(screen.getByText("已掌握")).toBeInTheDocument();
  });

  // ── Traditional Chinese (zh-Hant) ─────────────────────────────────────

  it("renders Traditional Chinese heading in zh-Hant locale", () => {
    renderZhHant(<CloseToMastery entries={[]} />);
    // zh-Hant journey.closeToMasteryWidget.heading = "即將掌握"
    expect(screen.getByRole("heading", { name: "即將掌握" })).toBeInTheDocument();
  });

  it("renders Traditional Chinese 'Name card' label in zh-Hant locale", () => {
    renderZhHant(<CloseToMastery entries={[entry]} />);
    // zh-Hant stats.legStatus.nameDirection = "名稱卡"
    expect(screen.getByText("名稱卡")).toBeInTheDocument();
  });

  it("renders Traditional Chinese 'Reverse card' label in zh-Hant locale", () => {
    renderZhHant(<CloseToMastery entries={[entry]} />);
    // zh-Hant stats.legStatus.reverseDirection = "反向卡"
    expect(screen.getByText("反向卡")).toBeInTheDocument();
  });

  it("renders Traditional Chinese 'Mastered' label on the name leg in zh-Hant locale", () => {
    renderZhHant(<CloseToMastery entries={[entry]} />);
    // zh-Hant journey.masteryMastered = "已掌握"
    expect(screen.getByText("已掌握")).toBeInTheDocument();
  });

  // ── English (baseline) ─────────────────────────────────────────────────

  it("renders English leg labels in en locale", () => {
    renderWithIntl(<CloseToMastery entries={[entry]} />);
    expect(screen.getByText("Name card")).toBeInTheDocument();
    expect(screen.getByText("Reverse card")).toBeInTheDocument();
    expect(screen.getByText("Mastered")).toBeInTheDocument();
  });
});
