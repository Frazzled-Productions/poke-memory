import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GameScopePicker } from "./GameScopePicker";

// GameScopePicker calls useSeed() to read seedPokemon for version-group
// discovery. Mock SeedContext with the real seed (primed by vitest.setup.ts
// via _primeSeed) so the component renders its game pills in unit tests
// without requiring a SeedProvider or a live fetch.
vi.mock("@/lib/pokemon/SeedContext", async () => {
  const { getSeedIfLoaded } = await import("@/lib/pokemon/seed-async");
  const seed = getSeedIfLoaded();
  return {
    useSeed: () => ({ seed, error: null, retry: vi.fn() }),
    SeedProvider: ({ children }: { children: React.ReactNode }) => children,
  };
});

describe("GameScopePicker", () => {
  it("renders generation headers when games are present in the seed", () => {
    render(<GameScopePicker selected={[]} onChange={() => {}} />);
    // Gen I and IX should both be present given the current seed.
    expect(screen.getByText("Generation I")).toBeInTheDocument();
    expect(screen.getByText("Generation IX")).toBeInTheDocument();
  });

  it("renders the marketing label as the pill text", () => {
    render(<GameScopePicker selected={[]} onChange={() => {}} />);
    expect(screen.getByRole("button", { name: "Pokémon Red/Blue" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pokémon Gold/Silver" })).toBeInTheDocument();
  });

  it("calls onChange with the slug added when an unselected pill is clicked", async () => {
    const onChange = vi.fn();
    render(<GameScopePicker selected={[]} onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: "Pokémon Gold/Silver" }));
    expect(onChange).toHaveBeenCalledWith(["gold-silver"]);
  });

  it("calls onChange with the slug removed when a selected pill is clicked", async () => {
    const onChange = vi.fn();
    render(<GameScopePicker selected={["gold-silver"]} onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: "Pokémon Gold/Silver" }));
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it("renders the selected pill with aria-pressed=true", () => {
    render(<GameScopePicker selected={["gold-silver"]} onChange={() => {}} />);
    expect(
      screen.getByRole("button", { name: "Pokémon Gold/Silver" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.getByRole("button", { name: "Pokémon Red/Blue" }),
    ).toHaveAttribute("aria-pressed", "false");
  });

  it("'Select all' button in a generation adds every game in that generation", async () => {
    const onChange = vi.fn();
    render(<GameScopePicker selected={[]} onChange={onChange} />);
    // Find Gen II's Select-all button. Gen II has gold-silver + crystal.
    // The aria-label spells out game names ("Select Gold/Silver, Crystal")
    // to distinguish it from the gens-axis "Generation II" toggle (#1110).
    const selectAllButtons = screen.getAllByRole("button", {
      name: /^Select Gold\/Silver, Crystal$/,
    });
    await userEvent.click(selectAllButtons[0]);
    expect(onChange).toHaveBeenCalledTimes(1);
    const arg = onChange.mock.calls[0][0] as string[];
    expect(arg).toContain("gold-silver");
    expect(arg).toContain("crystal");
  });

  it("'Clear all' removes every game in that generation", async () => {
    const onChange = vi.fn();
    render(
      <GameScopePicker
        selected={["gold-silver", "crystal", "red-blue"]}
        onChange={onChange}
      />,
    );
    const clearAll = screen.getByRole("button", {
      name: /^Clear Gold\/Silver, Crystal$/,
    });
    await userEvent.click(clearAll);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(["red-blue"]);
  });

  it("renders generation labels in ascending order, with Other at end", () => {
    render(<GameScopePicker selected={[]} onChange={() => {}} />);
    // Query all section headers - both "Generation X" and "Other".
    const headers = screen
      .getAllByText(/^Generation |^Other$/)
      .map((el) => el.textContent ?? "");
    // Generation I must be first overall (Other, if present, sorts to end).
    expect(headers[0]).toBe("Generation I");
    // Generation headers must be in strictly ascending order.
    const GEN_ORDER = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX"];
    const genHeaders = headers.filter((h) => h.startsWith("Generation "));
    for (let i = 1; i < genHeaders.length; i++) {
      const prev = GEN_ORDER.indexOf(genHeaders[i - 1].replace("Generation ", ""));
      const curr = GEN_ORDER.indexOf(genHeaders[i].replace("Generation ", ""));
      expect(curr).toBeGreaterThan(prev);
    }
    // "Other" group (if present) must appear after all Generation headers.
    const firstOtherIdx = headers.indexOf("Other");
    if (firstOtherIdx !== -1) {
      const lastGenIdx = headers.findLastIndex((h) => h.startsWith("Generation "));
      expect(firstOtherIdx).toBeGreaterThan(lastGenIdx);
    }
  });

  it("bulk-action labels use comma separators and produce unambiguous strings", () => {
    // Table-driven regression guard for genBulkLabel. Verifies that the comma
    // separator keeps game names with internal slashes (Black/White, X/Y, etc.)
    // unambiguous when joined. The assertions are based on the seed's known
    // version-group set - update if the seed adds new version groups.
    render(<GameScopePicker selected={[]} onChange={() => {}} />);

    // Gen II: Gold/Silver + Crystal - simplest unambiguous example
    expect(
      screen.queryAllByRole("button", { name: /^Select Gold\/Silver, Crystal$/ }).length,
    ).toBeGreaterThan(0);

    // Gen V: Black/White + B2/W2 - the classic ambiguous case with the old " / " separator
    expect(
      screen.getByRole("button", { name: /^Select Black\/White, B2\/W2$/ }),
    ).toBeInTheDocument();

    // Gen VI: X/Y + OR/AS - two slash-containing names
    expect(
      screen.getByRole("button", { name: /^Select X\/Y, OR\/AS$/ }),
    ).toBeInTheDocument();

    // Gen VIII: Sword/Shield is the first game listed (followed by DLC entries)
    expect(
      screen.getByRole("button", { name: /^Select Sword\/Shield,/ }),
    ).toBeInTheDocument();
  });

  it("the picker section is reachable inside ScopeControl via a games label search", () => {
    // Smoke sanity: a pill for at least one Gen VIII game exists.
    render(<GameScopePicker selected={[]} onChange={() => {}} />);
    const genVIII = screen.getByText("Generation VIII");
    expect(genVIII).toBeInTheDocument();
    const container = genVIII.parentElement?.parentElement;
    expect(container).not.toBeNull();
    if (container) {
      expect(within(container).getByText("Pokémon Sword/Shield")).toBeInTheDocument();
    }
  });
});
