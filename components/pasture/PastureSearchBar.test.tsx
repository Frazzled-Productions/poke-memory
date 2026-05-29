/**
 * Component tests for PastureSearchBar.
 *
 * All renders use renderWithIntl (i18n wiring from #1369) so t() calls resolve
 * against the real en.json catalogue. A renderJa suite asserts that Japanese
 * chrome strings render correctly on this surface.
 */

import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import {
  renderWithIntl,
  renderJa,
  screen,
  within,
} from "@/components/test-utils/renderWithIntl";
import {
  PastureSearchBar,
  PASTURE_FILTERS_DEFAULT,
  type PastureFilters,
} from "@/components/pasture/PastureSearchBar";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function defaultFilters(overrides: Partial<PastureFilters> = {}): PastureFilters {
  return { ...PASTURE_FILTERS_DEFAULT, ...overrides };
}

function renderSearchBar(
  filters: PastureFilters = defaultFilters(),
  handlers: {
    onQueryChange?: (q: string) => void;
    onTypeToggle?: (t: string) => void;
    onGenChange?: (g: number | null) => void;
  } = {},
) {
  const onQueryChange = handlers.onQueryChange ?? vi.fn();
  const onTypeToggle = handlers.onTypeToggle ?? vi.fn();
  const onGenChange = handlers.onGenChange ?? vi.fn();

  renderWithIntl(
    <PastureSearchBar
      filters={filters}
      onQueryChange={onQueryChange}
      onTypeToggle={onTypeToggle}
      onGenChange={onGenChange}
    />,
  );

  return { onQueryChange, onTypeToggle, onGenChange };
}

// ---------------------------------------------------------------------------
// Search input
// ---------------------------------------------------------------------------

describe("PastureSearchBar — search input", () => {
  it("renders a labelled text input", () => {
    renderSearchBar();
    expect(
      screen.getByRole("textbox", { name: /Search Pokémon/i }),
    ).toBeInTheDocument();
  });

  it("reflects the current query value", () => {
    renderSearchBar(defaultFilters({ query: "Bulba" }));
    const input = screen.getByRole("textbox", { name: /Search Pokémon/i });
    expect(input).toHaveValue("Bulba");
  });

  it("calls onQueryChange when the user types", async () => {
    const user = userEvent.setup();
    const { onQueryChange } = renderSearchBar();
    const input = screen.getByRole("textbox", { name: /Search Pokémon/i });
    await user.type(input, "x");
    expect(onQueryChange).toHaveBeenCalledWith("x");
  });

  it("does not show a clear button when the query is empty", () => {
    renderSearchBar();
    expect(screen.queryByRole("button", { name: /Clear search/i })).toBeNull();
  });

  it("shows a clear button when the query is non-empty", () => {
    renderSearchBar(defaultFilters({ query: "Char" }));
    expect(
      screen.getByRole("button", { name: /Clear search/i }),
    ).toBeInTheDocument();
  });

  it("calls onQueryChange with empty string when clear button is clicked", async () => {
    const user = userEvent.setup();
    const { onQueryChange } = renderSearchBar(defaultFilters({ query: "Char" }));
    await user.click(screen.getByRole("button", { name: /Clear search/i }));
    expect(onQueryChange).toHaveBeenCalledWith("");
  });
});

// ---------------------------------------------------------------------------
// Type chips
// ---------------------------------------------------------------------------

describe("PastureSearchBar — type chips", () => {
  it("renders a 'Filter by type' group", () => {
    renderSearchBar();
    expect(
      screen.getByRole("group", { name: /Filter by type/i }),
    ).toBeInTheDocument();
  });

  it("renders a button for each Pokémon type", () => {
    renderSearchBar();
    // Spot-check a representative sample
    expect(screen.getByRole("button", { name: "Bug" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Fire" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Water" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Dragon" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ghost" })).toBeInTheDocument();
  });

  it("unselected type chip has aria-pressed=false", () => {
    renderSearchBar(defaultFilters({ types: [] }));
    const bugBtn = screen.getByRole("button", { name: "Bug" });
    expect(bugBtn).toHaveAttribute("aria-pressed", "false");
  });

  it("selected type chip has aria-pressed=true", () => {
    renderSearchBar(defaultFilters({ types: ["fire"] }));
    const fireBtn = screen.getByRole("button", { name: "Fire" });
    expect(fireBtn).toHaveAttribute("aria-pressed", "true");
  });

  it("clicking a type chip calls onTypeToggle with the type name", async () => {
    const user = userEvent.setup();
    const { onTypeToggle } = renderSearchBar();
    await user.click(screen.getByRole("button", { name: "Water" }));
    expect(onTypeToggle).toHaveBeenCalledWith("water");
  });

  it("clicking a selected chip also calls onTypeToggle (toggle off)", async () => {
    const user = userEvent.setup();
    const { onTypeToggle } = renderSearchBar(defaultFilters({ types: ["grass"] }));
    await user.click(screen.getByRole("button", { name: "Grass" }));
    expect(onTypeToggle).toHaveBeenCalledWith("grass");
  });

  it("only the selected type chip has aria-pressed=true when one is active", () => {
    renderSearchBar(defaultFilters({ types: ["ice"] }));
    const iceBtn = screen.getByRole("button", { name: "Ice" });
    const bugBtn = screen.getByRole("button", { name: "Bug" });
    expect(iceBtn).toHaveAttribute("aria-pressed", "true");
    expect(bugBtn).toHaveAttribute("aria-pressed", "false");
  });

  it("multiple selected types are each marked aria-pressed=true", () => {
    renderSearchBar(defaultFilters({ types: ["bug", "fire"] }));
    expect(screen.getByRole("button", { name: "Bug" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Fire" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Water" })).toHaveAttribute("aria-pressed", "false");
  });
});

// ---------------------------------------------------------------------------
// Generation pills
// ---------------------------------------------------------------------------

describe("PastureSearchBar — generation pills", () => {
  it("renders a 'Filter by generation' group", () => {
    renderSearchBar();
    expect(
      screen.getByRole("group", { name: /Filter by generation/i }),
    ).toBeInTheDocument();
  });

  it("renders an 'All' pill and pills for Gen I through Gen IX", () => {
    renderSearchBar();
    const genGroup = screen.getByRole("group", { name: /Filter by generation/i });
    const g = within(genGroup);
    expect(g.getByRole("button", { name: "All", })).toBeInTheDocument();
    expect(g.getByRole("button", { name: "Gen I", })).toBeInTheDocument();
    expect(g.getByRole("button", { name: "Gen II", })).toBeInTheDocument();
    expect(g.getByRole("button", { name: "Gen III", })).toBeInTheDocument();
    expect(g.getByRole("button", { name: "Gen IV", })).toBeInTheDocument();
    expect(g.getByRole("button", { name: "Gen V", })).toBeInTheDocument();
    expect(g.getByRole("button", { name: "Gen VI", })).toBeInTheDocument();
    expect(g.getByRole("button", { name: "Gen VII", })).toBeInTheDocument();
    expect(g.getByRole("button", { name: "Gen VIII", })).toBeInTheDocument();
    expect(g.getByRole("button", { name: "Gen IX", })).toBeInTheDocument();
  });

  it("'All' pill has aria-pressed=true when gen is null", () => {
    renderSearchBar(defaultFilters({ gen: null }));
    const g = within(screen.getByRole("group", { name: /Filter by generation/i }));
    const allBtn = g.getByRole("button", { name: "All", });
    expect(allBtn).toHaveAttribute("aria-pressed", "true");
  });

  it("'All' pill has aria-pressed=false when a specific gen is selected", () => {
    renderSearchBar(defaultFilters({ gen: 1 }));
    const g = within(screen.getByRole("group", { name: /Filter by generation/i }));
    const allBtn = g.getByRole("button", { name: "All", });
    expect(allBtn).toHaveAttribute("aria-pressed", "false");
  });

  it("selected generation pill has aria-pressed=true", () => {
    renderSearchBar(defaultFilters({ gen: 2 }));
    const g = within(screen.getByRole("group", { name: /Filter by generation/i }));
    const genIIBtn = g.getByRole("button", { name: "Gen II", });
    expect(genIIBtn).toHaveAttribute("aria-pressed", "true");
  });

  it("unselected generation pills have aria-pressed=false", () => {
    renderSearchBar(defaultFilters({ gen: 2 }));
    const g = within(screen.getByRole("group", { name: /Filter by generation/i }));
    // Gen I and Gen III should not be selected
    expect(g.getByRole("button", { name: "Gen I", })).toHaveAttribute("aria-pressed", "false");
    expect(g.getByRole("button", { name: "Gen III", })).toHaveAttribute("aria-pressed", "false");
  });

  it("clicking a generation pill calls onGenChange with that gen number", async () => {
    const user = userEvent.setup();
    const { onGenChange } = renderSearchBar();
    const g = within(screen.getByRole("group", { name: /Filter by generation/i }));
    await user.click(g.getByRole("button", { name: "Gen III", }));
    expect(onGenChange).toHaveBeenCalledWith(3);
  });

  it("clicking 'All' calls onGenChange with null", async () => {
    const user = userEvent.setup();
    const { onGenChange } = renderSearchBar(defaultFilters({ gen: 2 }));
    const g = within(screen.getByRole("group", { name: /Filter by generation/i }));
    await user.click(g.getByRole("button", { name: "All", }));
    expect(onGenChange).toHaveBeenCalledWith(null);
  });

  it("clicking Gen I calls onGenChange with 1", async () => {
    const user = userEvent.setup();
    const { onGenChange } = renderSearchBar();
    const g = within(screen.getByRole("group", { name: /Filter by generation/i }));
    await user.click(g.getByRole("button", { name: "Gen I", }));
    expect(onGenChange).toHaveBeenCalledWith(1);
  });

  it("clicking Gen IX calls onGenChange with 9", async () => {
    const user = userEvent.setup();
    const { onGenChange } = renderSearchBar();
    const g = within(screen.getByRole("group", { name: /Filter by generation/i }));
    await user.click(g.getByRole("button", { name: "Gen IX", }));
    expect(onGenChange).toHaveBeenCalledWith(9);
  });
});

// ---------------------------------------------------------------------------
// Japanese locale — chrome strings render in Japanese (#1369)
// ---------------------------------------------------------------------------

describe("PastureSearchBar — Japanese locale", () => {
  it("renders the search label in Japanese", () => {
    renderJa(
      <PastureSearchBar
        filters={defaultFilters()}
        onQueryChange={vi.fn()}
        onTypeToggle={vi.fn()}
        onGenChange={vi.fn()}
      />,
    );
    // messages/ja.json pasture.searchAriaLabel = "Pokémon を検索"
    expect(screen.getByRole("textbox", { name: "Pokémon を検索" })).toBeInTheDocument();
  });

  it("renders the filter-by-type group label in Japanese", () => {
    renderJa(
      <PastureSearchBar
        filters={defaultFilters()}
        onQueryChange={vi.fn()}
        onTypeToggle={vi.fn()}
        onGenChange={vi.fn()}
      />,
    );
    // messages/ja.json pasture.filterByTypeAriaLabel = "タイプでフィルター"
    expect(screen.getByRole("group", { name: "タイプでフィルター" })).toBeInTheDocument();
  });
});
