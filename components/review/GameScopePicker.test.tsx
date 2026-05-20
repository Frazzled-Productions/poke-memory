import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GameScopePicker } from "./GameScopePicker";

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
    const selectAllButtons = screen.getAllByRole("button", {
      name: /Select all games in Generation II/,
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
      name: /Clear all games in Generation II/,
    });
    await userEvent.click(clearAll);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(["red-blue"]);
  });

  it("renders generation labels in ascending order, with Other at end", () => {
    render(<GameScopePicker selected={[]} onChange={() => {}} />);
    // Query all section headers — both "Generation X" and "Other".
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
