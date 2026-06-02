import { describe, it, expect } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderWithIntl, renderJa, renderZhHans, renderZhHant } from "@/components/test-utils/renderWithIntl";
import { GameBreakdown } from "@/components/stats/GameBreakdown";
import type { GameStats } from "@/lib/stats/per-game";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const RED_BLUE: GameStats = { slug: "red-blue", total: 151, introduced: 50, mastered: 10 };
const GOLD_SILVER: GameStats = { slug: "gold-silver", total: 100, introduced: 0, mastered: 0 };
const X_Y: GameStats = { slug: "x-y", total: 72, introduced: 72, mastered: 72 };

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GameBreakdown", () => {
  it("renders the section heading", () => {
    renderWithIntl(<GameBreakdown perGame={[RED_BLUE]} />);
    expect(screen.getByRole("heading", { level: 2, name: "By game" })).toBeInTheDocument();
  });

  it("shows an empty state when perGame is empty", () => {
    renderWithIntl(<GameBreakdown perGame={[]} />);
    expect(screen.getByText(/No game data available/)).toBeInTheDocument();
  });

  it("renders one accordion button per generation group", () => {
    // red-blue is Gen I, gold-silver is Gen II, x-y is Gen VI.
    renderWithIntl(<GameBreakdown perGame={[RED_BLUE, GOLD_SILVER, X_Y]} />);
    // Three separate generations → three accordion buttons.
    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(3);
  });

  it("shows the generation label in each accordion header", () => {
    renderWithIntl(<GameBreakdown perGame={[RED_BLUE]} />);
    expect(screen.getByText("Generation I")).toBeInTheDocument();
  });

  it("shows game count and species mastered summary in the accordion header", () => {
    renderWithIntl(<GameBreakdown perGame={[RED_BLUE]} />);
    // "1 game · 10/151 species mastered"
    expect(screen.getByText(/1 game/)).toBeInTheDocument();
    expect(screen.getByText(/10\/151 species mastered/)).toBeInTheDocument();
  });

  it("game rows are hidden until the accordion is expanded", () => {
    renderWithIntl(<GameBreakdown perGame={[RED_BLUE]} />);
    // Game name should NOT be visible yet.
    expect(screen.queryByText("Pokémon Red/Blue")).not.toBeInTheDocument();
  });

  it("expands to show game rows when the accordion button is clicked", () => {
    renderWithIntl(<GameBreakdown perGame={[RED_BLUE]} />);
    const button = screen.getByRole("button", { name: /Generation I/i });
    fireEvent.click(button);
    expect(screen.getByText("Pokémon Red/Blue")).toBeInTheDocument();
  });

  it("shows mastered/total count in the expanded row", () => {
    renderWithIntl(<GameBreakdown perGame={[RED_BLUE]} />);
    const button = screen.getByRole("button", { name: /Generation I/i });
    fireEvent.click(button);
    expect(screen.getByText("10/151")).toBeInTheDocument();
  });

  it("collapses the accordion when clicked a second time", () => {
    renderWithIntl(<GameBreakdown perGame={[RED_BLUE]} />);
    const button = screen.getByRole("button", { name: /Generation I/i });
    fireEvent.click(button);
    expect(screen.getByText("Pokémon Red/Blue")).toBeInTheDocument();
    fireEvent.click(button);
    expect(screen.queryByText("Pokémon Red/Blue")).not.toBeInTheDocument();
  });

  it("sets aria-expanded correctly on the accordion button", () => {
    renderWithIntl(<GameBreakdown perGame={[RED_BLUE]} />);
    const button = screen.getByRole("button", { name: /Generation I/i });
    expect(button).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
  });

  it("multiple games in the same generation appear under one accordion", () => {
    const YELLOW: GameStats = { slug: "yellow", total: 151, introduced: 0, mastered: 0 };
    renderWithIntl(<GameBreakdown perGame={[RED_BLUE, YELLOW]} />);
    // Both are Gen I — only one accordion button.
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(screen.getByText(/2 games/)).toBeInTheDocument();
    // Expand and confirm both games appear.
    const button = screen.getByRole("button", { name: /Generation I/i });
    fireEvent.click(button);
    expect(screen.getByText("Pokémon Red/Blue")).toBeInTheDocument();
    expect(screen.getByText("Pokémon Yellow")).toBeInTheDocument();
  });

  it("100% mastered is displayed correctly as 100%", () => {
    renderWithIntl(<GameBreakdown perGame={[X_Y]} />);
    const button = screen.getByRole("button", { name: /Generation VI/i });
    fireEvent.click(button);
    expect(screen.getByText("72/72")).toBeInTheDocument();
    expect(screen.getByText("100%")).toBeInTheDocument();
  });

  it("0% mastered shows 0%", () => {
    renderWithIntl(<GameBreakdown perGame={[GOLD_SILVER]} />);
    const button = screen.getByRole("button", { name: /Generation II/i });
    fireEvent.click(button);
    expect(screen.getByText("0%")).toBeInTheDocument();
  });

  // Locale coverage (#1519): the typed GEN_KEY map must resolve in non-English
  // locales; confirms the key lookup works without an as-any cast.
  it("renders the section heading in Japanese", () => {
    renderJa(<GameBreakdown perGame={[RED_BLUE]} />);
    expect(
      screen.getByRole("heading", { level: 2, name: "ゲーム別" }),
    ).toBeInTheDocument();
  });

  it("renders the generation label using the typed key in Japanese", () => {
    renderJa(<GameBreakdown perGame={[RED_BLUE]} />);
    // gen1 key resolves to "第1世代" in Japanese.
    expect(screen.getByText("第1世代")).toBeInTheDocument();
  });

  it("renders the section heading in Simplified Chinese", () => {
    renderZhHans(<GameBreakdown perGame={[RED_BLUE]} />);
    expect(
      screen.getByRole("heading", { level: 2, name: "按游戏" }),
    ).toBeInTheDocument();
  });

  it("renders the generation label using the typed key in Simplified Chinese", () => {
    renderZhHans(<GameBreakdown perGame={[RED_BLUE]} />);
    // gen1 key resolves to "第一世代" in Simplified Chinese.
    expect(screen.getByText("第一世代")).toBeInTheDocument();
  });

  it("renders the section heading in Traditional Chinese", () => {
    renderZhHant(<GameBreakdown perGame={[RED_BLUE]} />);
    expect(
      screen.getByRole("heading", { level: 2, name: "按遊戲" }),
    ).toBeInTheDocument();
  });

  it("renders the generation label using the typed key in Traditional Chinese", () => {
    renderZhHant(<GameBreakdown perGame={[RED_BLUE]} />);
    // gen1 key resolves to "第一世代" in Traditional Chinese.
    expect(screen.getByText("第一世代")).toBeInTheDocument();
  });
});
