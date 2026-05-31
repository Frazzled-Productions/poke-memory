import { describe, it, expect } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderWithIntl as render } from "@/components/test-utils/renderWithIntl";
import { BadgeGallery } from "./BadgeGallery";
import type { BadgeDefinition } from "@/lib/badges/catalog";

// Minimal stub badges so the accordion tests are independent of the real catalog size.
const BOULDER: BadgeDefinition = {
  id: "boulder-badge",
  name: "Boulder Badge",
  description: "You've mastered Brock's roster.",
  lockedHint: "A Kanto gym leader's rocky roster…",
  criterion: { kind: "all-mastered", speciesIds: [74, 95] },
};

const CASCADE: BadgeDefinition = {
  id: "cascade-badge",
  name: "Cascade Badge",
  description: "You've mastered Misty's roster.",
  lockedHint: "A Cerulean gym leader favours the sea…",
  criterion: { kind: "all-mastered", speciesIds: [120, 121] },
};

describe("BadgeGallery proximity hint", () => {
  it("renders no hint when masteredSpeciesIds is not provided", () => {
    render(<BadgeGallery earnedBadges={[]} />);
    expect(screen.queryByTestId("next-badge-hint")).not.toBeInTheDocument();
  });

  it("renders no hint when forceAllMastered is true", () => {
    render(
      <BadgeGallery
        earnedBadges={[]}
        forceAllMastered
        masteredSpeciesIds={new Set()}
      />,
    );
    expect(screen.queryByTestId("next-badge-hint")).not.toBeInTheDocument();
  });

  it("shows the hint with the nearest unearned badge", () => {
    // Boulder Badge requires species 74 and 95. Mastering 74 leaves 1 remaining,
    // which is fewer than any other unearned badge — so Boulder Badge is the
    // nearest target.
    render(
      <BadgeGallery
        earnedBadges={[]}
        masteredSpeciesIds={new Set([74])}
      />,
    );
    const hint = screen.getByTestId("next-badge-hint");
    expect(hint).toBeInTheDocument();
    expect(hint).toHaveTextContent("Next badge:");
    expect(hint).toHaveTextContent("Boulder Badge");
    expect(hint).toHaveTextContent("1 more Pokémon to master");
  });

  it("uses singular phrasing for 1 remaining", () => {
    // Master species 74 — Boulder Badge needs only 95 still remaining.
    render(
      <BadgeGallery
        earnedBadges={[]}
        masteredSpeciesIds={new Set([74])}
      />,
    );
    expect(screen.getByTestId("next-badge-hint")).toHaveTextContent(
      "1 more Pokémon to master",
    );
  });

  it("uses plural phrasing for 2+ remaining", () => {
    // Empty mastered set — Boulder Badge needs 2 species, which is the minimum
    // across all real-catalog badges with size 2.
    render(
      <BadgeGallery
        earnedBadges={[]}
        masteredSpeciesIds={new Set()}
      />,
    );
    expect(screen.getByTestId("next-badge-hint")).toHaveTextContent(
      "2 more Pokémon to master",
    );
  });

  it("skips badges with 0 remaining (about to be awarded by the badge check)", () => {
    // Boulder Badge has both species mastered but is not in earnedBadges yet.
    // findNextBadge skips 0-remaining badges, so the hint must not show Boulder Badge.
    render(
      <BadgeGallery
        earnedBadges={[]}
        masteredSpeciesIds={new Set([74, 95])}
      />,
    );
    const hint = screen.getByTestId("next-badge-hint");
    expect(hint).not.toHaveTextContent("Boulder Badge");
  });

  it("renders no hint when forceAllMastered suppresses it even with a non-empty mastered set", () => {
    render(
      <BadgeGallery
        earnedBadges={[]}
        forceAllMastered
        masteredSpeciesIds={new Set([1, 2, 3])}
      />,
    );
    expect(screen.queryByTestId("next-badge-hint")).not.toBeInTheDocument();
  });
});

describe("BadgeGallery accordion", () => {
  it("renders the section heading", () => {
    render(<BadgeGallery earnedBadges={[]} />);
    expect(
      screen.getByRole("heading", { level: 2, name: "Gym badges" }),
    ).toBeInTheDocument();
  });

  it("shows no-badge message when no badges are earned", () => {
    render(<BadgeGallery earnedBadges={[]} />);
    expect(screen.getByText(/No badges earned yet/i)).toBeInTheDocument();
  });

  it("shows earned badge tiles immediately", () => {
    render(<BadgeGallery earnedBadges={[BOULDER]} />);
    expect(
      screen.getByRole("listitem", { name: /Boulder Badge, earned/i }),
    ).toBeInTheDocument();
  });

  it("hides locked badge tiles by default", () => {
    render(<BadgeGallery earnedBadges={[BOULDER]} />);
    // Cascade is not earned — its tile should not be in the document yet.
    expect(
      screen.queryByRole("listitem", { name: /Cascade Badge \(locked\)/i }),
    ).not.toBeInTheDocument();
  });

  it("shows the toggle button when there are locked badges", () => {
    render(<BadgeGallery earnedBadges={[BOULDER]} />);
    expect(
      screen.getByRole("button", { name: /View all badges/i }),
    ).toBeInTheDocument();
  });

  it("toggle button starts collapsed (aria-expanded=false)", () => {
    render(<BadgeGallery earnedBadges={[BOULDER]} />);
    const toggle = screen.getByRole("button", { name: /View all badges/i });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
  });

  it("reveals locked badges after clicking the toggle", () => {
    render(<BadgeGallery earnedBadges={[BOULDER]} />);
    const toggle = screen.getByRole("button", { name: /View all badges/i });
    fireEvent.click(toggle);
    // At least one locked tile should now be visible.
    expect(
      screen.getByRole("listitem", { name: /Cascade Badge \(locked\)/i }),
    ).toBeInTheDocument();
  });

  it("toggle becomes aria-expanded=true after clicking", () => {
    render(<BadgeGallery earnedBadges={[BOULDER]} />);
    const toggle = screen.getByRole("button", { name: /View all badges/i });
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
  });

  it("collapses locked badges again when toggle is clicked a second time", () => {
    render(<BadgeGallery earnedBadges={[BOULDER]} />);
    const toggle = screen.getByRole("button", { name: /View all badges/i });
    fireEvent.click(toggle);
    fireEvent.click(toggle);
    expect(
      screen.queryByRole("listitem", { name: /Cascade Badge \(locked\)/i }),
    ).not.toBeInTheDocument();
    expect(toggle).toHaveAttribute("aria-expanded", "false");
  });

  it("does not show the toggle when forceAllMastered is true", () => {
    render(<BadgeGallery earnedBadges={[BOULDER, CASCADE]} forceAllMastered />);
    expect(
      screen.queryByRole("button", { name: /View all badges/i }),
    ).not.toBeInTheDocument();
  });

  it("renders all badges as earned when forceAllMastered is true", () => {
    render(<BadgeGallery earnedBadges={[]} forceAllMastered />);
    // Every catalog badge should appear as earned. Check Boulder Badge.
    expect(
      screen.getByRole("listitem", { name: /Boulder Badge, earned/i }),
    ).toBeInTheDocument();
  });
});
