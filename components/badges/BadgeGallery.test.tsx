import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { BadgeGallery } from "./BadgeGallery";
import type { BadgeDefinition } from "@/lib/badges/catalog";

// Minimal stub badges so the test is independent of the real catalog size.
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
