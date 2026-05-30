/**
 * Locale tests for CollectionTimeline (#1393).
 *
 * Verifies that the strings wired in the i18n sweep localise correctly when
 * the app locale changes. Covers the empty state (no history) and the
 * populated "now" state, and exercises the Japanese locale for mandatory
 * non-English coverage.
 *
 * Lives in components/ so the jsdom vitest project picks it up.
 */

import { describe, it, expect } from "vitest";
import { renderWithIntl, renderJa, screen } from "@/components/test-utils/renderWithIntl";
import { CollectionTimeline } from "./CollectionTimeline";
import type { CollectionTimeline as CollectionTimelineData } from "@/lib/timeline/reconstruct";

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

const NOW_MS = Date.UTC(2026, 4, 30); // 2026-05-30

/** A timeline with no past or future data — triggers the empty state. */
const emptyTimeline: CollectionTimelineData = {
  past: [],
  future: [],
  nowMs: NOW_MS,
  totalSpecies: 100,
};

/** A minimal timeline with one past snapshot — shows the populated scrubber UI. */
const populatedTimeline: CollectionTimelineData = {
  past: [
    { atMs: NOW_MS - 7 * 86400_000, introduced: 10, mastered: 3 },
    { atMs: NOW_MS, introduced: 20, mastered: 8 },
  ],
  future: [],
  nowMs: NOW_MS,
  totalSpecies: 100,
};

// ---------------------------------------------------------------------------
// English baseline — empty state
// ---------------------------------------------------------------------------

describe("CollectionTimeline — empty state (English)", () => {
  it("renders the section heading", () => {
    renderWithIntl(<CollectionTimeline timeline={emptyTimeline} />);
    expect(
      screen.getByRole("heading", { name: "Collection timeline" }),
    ).toBeInTheDocument();
  });

  it("renders the empty-state 'no history' message", () => {
    renderWithIntl(<CollectionTimeline timeline={emptyTimeline} />);
    expect(screen.getByText(/no review history yet/i)).toBeInTheDocument();
  });

  it("does not render the scrubber input when empty", () => {
    renderWithIntl(<CollectionTimeline timeline={emptyTimeline} />);
    expect(screen.queryByRole("slider")).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// English baseline — populated state
// ---------------------------------------------------------------------------

describe("CollectionTimeline — populated state (English)", () => {
  it("renders the section heading", () => {
    renderWithIntl(<CollectionTimeline timeline={populatedTimeline} />);
    expect(
      screen.getByRole("heading", { name: "Collection timeline" }),
    ).toBeInTheDocument();
  });

  it("renders the direction pill with the 'Now' label at the centre position", () => {
    renderWithIntl(<CollectionTimeline timeline={populatedTimeline} />);
    const pill = screen.getByTestId("timeline-direction-pill");
    expect(pill).toHaveTextContent("Now");
  });

  it("renders the scrubber range input", () => {
    renderWithIntl(<CollectionTimeline timeline={populatedTimeline} />);
    expect(screen.getByRole("slider")).toBeInTheDocument();
  });

  it("renders the 'introduced' count pill label", () => {
    renderWithIntl(<CollectionTimeline timeline={populatedTimeline} />);
    // en journey.collectionTimelineWidget.introduced = "introduced"
    expect(screen.getByText("introduced")).toBeInTheDocument();
  });

  it("renders the 'mastered' count pill label", () => {
    renderWithIntl(<CollectionTimeline timeline={populatedTimeline} />);
    // en journey.collectionTimelineWidget.mastered = "mastered"
    expect(screen.getByText("mastered")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Japanese locale — mandatory non-English coverage (#1393)
// ---------------------------------------------------------------------------

describe("CollectionTimeline — Japanese locale (#1393)", () => {
  it("renders the Japanese heading in the empty state", () => {
    renderJa(<CollectionTimeline timeline={emptyTimeline} />);
    // ja journey.collectionTimelineWidget.heading = "コレクションタイムライン"
    expect(
      screen.getByRole("heading", { name: "コレクションタイムライン" }),
    ).toBeInTheDocument();
  });

  it("renders the Japanese no-history message in the empty state", () => {
    renderJa(<CollectionTimeline timeline={emptyTimeline} />);
    // ja journey.collectionTimelineWidget.noHistoryYet = "レビュー履歴がまだありません"
    expect(screen.getByText("レビュー履歴がまだありません")).toBeInTheDocument();
  });

  it("renders the Japanese direction pill label at centre position", () => {
    renderJa(<CollectionTimeline timeline={populatedTimeline} />);
    // ja journey.collectionTimelineWidget.directionNow = "現在"
    const pill = screen.getByTestId("timeline-direction-pill");
    expect(pill).toHaveTextContent("現在");
  });

  it("renders the Japanese 'Introduced' count pill label", () => {
    renderJa(<CollectionTimeline timeline={populatedTimeline} />);
    // ja journey.collectionTimelineWidget.introduced = "表示済み"
    expect(screen.getByText("表示済み")).toBeInTheDocument();
  });

  it("renders the Japanese 'Mastered' count pill label", () => {
    renderJa(<CollectionTimeline timeline={populatedTimeline} />);
    // ja journey.collectionTimelineWidget.mastered = "習得済み"
    expect(screen.getByText("習得済み")).toBeInTheDocument();
  });
});
