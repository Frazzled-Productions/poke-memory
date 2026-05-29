/**
 * Component tests for PokedexFilterBar.
 *
 * Covers the sort control (new in #1314) and the existing filter controls at
 * a smoke level — verifying that user interactions call the correct handlers
 * and that the sort select reflects the current sort state.
 *
 * Existing filter controls (type chips, gen pills, mastery buttons) are also
 * exercised to ensure the refactor that added the sort prop did not break them.
 *
 * All renders use renderWithIntl (i18n wiring from #1369) so t() calls resolve
 * against the real en.json catalogue. A renderJa test asserts that Japanese
 * chrome strings render correctly on this surface.
 */

import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import {
  renderWithIntl,
  renderJa,
  screen,
} from "@/components/test-utils/renderWithIntl";
import PokedexFilterBar from "@/components/pokedex/PokedexFilterBar";
import type { PokedexFilters } from "@/lib/pokemon/filter";
import type { PokedexSortOrder } from "@/lib/pokedex/sort";

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function defaultFilters(overrides: Partial<PokedexFilters> = {}): PokedexFilters {
  return {
    query: "",
    types: [],
    gen: null,
    hasAlternateForms: false,
    masteryStatus: "all",
    ...overrides,
  };
}

function renderBar(
  filters: PokedexFilters = defaultFilters(),
  sort: PokedexSortOrder = "national",
  handlers: {
    onQueryChange?: (q: string) => void;
    onTypeToggle?: (type: string) => void;
    onGenChange?: (gen: number | null) => void;
    onAlternateFormsToggle?: () => void;
    onMasteryChange?: (status: string) => void;
    onSortChange?: (sort: PokedexSortOrder) => void;
    superuserMasteryLocked?: boolean;
  } = {},
) {
  const {
    onQueryChange = vi.fn(),
    onTypeToggle = vi.fn(),
    onGenChange = vi.fn(),
    onAlternateFormsToggle = vi.fn(),
    onMasteryChange = vi.fn(),
    onSortChange = vi.fn(),
    superuserMasteryLocked = false,
  } = handlers;

  const result = renderWithIntl(
    <PokedexFilterBar
      filters={filters}
      sort={sort}
      onQueryChange={onQueryChange}
      onTypeToggle={onTypeToggle}
      onGenChange={onGenChange}
      onAlternateFormsToggle={onAlternateFormsToggle}
      onMasteryChange={onMasteryChange as (s: import("@/lib/pokemon/filter").MasteryStatus) => void}
      onSortChange={onSortChange}
      superuserMasteryLocked={superuserMasteryLocked}
    />,
  );

  return {
    ...result,
    onQueryChange,
    onTypeToggle,
    onGenChange,
    onAlternateFormsToggle,
    onMasteryChange,
    onSortChange,
  };
}

// ---------------------------------------------------------------------------
// Sort control tests
// ---------------------------------------------------------------------------

describe("PokedexFilterBar — sort control", () => {
  it("renders a labelled sort select", () => {
    renderBar();
    expect(screen.getByLabelText("Sort by")).toBeInTheDocument();
  });

  it("shows National Number as the default selected option", () => {
    renderBar();
    const select = screen.getByLabelText("Sort by") as HTMLSelectElement;
    expect(select.value).toBe("national");
  });

  it("shows Alphabetical as selected when sort=alphabetical", () => {
    renderBar(defaultFilters(), "alphabetical");
    const select = screen.getByLabelText("Sort by") as HTMLSelectElement;
    expect(select.value).toBe("alphabetical");
  });

  it("shows Closest to mastery as selected when sort=closest-to-mastery", () => {
    renderBar(defaultFilters(), "closest-to-mastery");
    const select = screen.getByLabelText("Sort by") as HTMLSelectElement;
    expect(select.value).toBe("closest-to-mastery");
  });

  it("calls onSortChange with 'alphabetical' when Alphabetical is selected", async () => {
    const user = userEvent.setup();
    const { onSortChange } = renderBar();
    const select = screen.getByLabelText("Sort by");
    await user.selectOptions(select, "alphabetical");
    expect(onSortChange).toHaveBeenCalledWith("alphabetical");
  });

  it("calls onSortChange with 'closest-to-mastery' when Closest to mastery is selected", async () => {
    const user = userEvent.setup();
    const { onSortChange } = renderBar();
    const select = screen.getByLabelText("Sort by");
    await user.selectOptions(select, "closest-to-mastery");
    expect(onSortChange).toHaveBeenCalledWith("closest-to-mastery");
  });

  it("calls onSortChange with 'national' when National Number is selected", async () => {
    const user = userEvent.setup();
    const { onSortChange } = renderBar(defaultFilters(), "alphabetical");
    const select = screen.getByLabelText("Sort by");
    await user.selectOptions(select, "national");
    expect(onSortChange).toHaveBeenCalledWith("national");
  });

  it("renders all three sort options", () => {
    renderBar();
    const select = screen.getByLabelText("Sort by") as HTMLSelectElement;
    const options = Array.from(select.options).map((o) => o.value);
    expect(options).toEqual(["national", "alphabetical", "closest-to-mastery"]);
  });
});

// ---------------------------------------------------------------------------
// Existing filter controls — smoke tests to confirm prop wiring is intact
// ---------------------------------------------------------------------------

describe("PokedexFilterBar — existing filter controls", () => {
  it("renders the search input", () => {
    renderBar();
    expect(screen.getByRole("textbox", { name: "Search Pokémon" })).toBeInTheDocument();
  });

  it("calls onQueryChange when the search input changes", async () => {
    const user = userEvent.setup();
    const { onQueryChange } = renderBar();
    await user.type(screen.getByRole("textbox", { name: "Search Pokémon" }), "b");
    expect(onQueryChange).toHaveBeenCalled();
  });

  it("renders the Filter by type group", () => {
    renderBar();
    expect(screen.getByRole("group", { name: "Filter by type" })).toBeInTheDocument();
  });

  it("calls onTypeToggle when a type chip is clicked", async () => {
    const user = userEvent.setup();
    const { onTypeToggle } = renderBar();
    await user.click(
      screen.getByRole("button", { name: "Fire" }),
    );
    expect(onTypeToggle).toHaveBeenCalledWith("fire");
  });

  it("renders the Filter by generation group", () => {
    renderBar();
    expect(screen.getByRole("group", { name: "Filter by generation" })).toBeInTheDocument();
  });

  it("calls onGenChange with 1 when Gen I is clicked", async () => {
    const user = userEvent.setup();
    const { onGenChange } = renderBar();
    await user.click(screen.getByRole("button", { name: "Gen I" }));
    expect(onGenChange).toHaveBeenCalledWith(1);
  });

  it("calls onGenChange with null when All gen button is clicked", async () => {
    const user = userEvent.setup();
    const { onGenChange } = renderBar(defaultFilters({ gen: 1 }));
    await user.click(
      screen.getByRole("group", { name: "Filter by generation" }).querySelector(
        "button[aria-pressed='false']",
      ) ?? screen.getByRole("button", { name: "All" }),
    );
    // Clicking All while gen=1 resets to null.
    expect(onGenChange).toHaveBeenCalledWith(null);
  });

  it("renders the Filter by mastery group", () => {
    renderBar();
    expect(screen.getByRole("group", { name: "Filter by mastery" })).toBeInTheDocument();
  });

  it("calls onMasteryChange with 'mastered' when Mastered button is clicked", async () => {
    const user = userEvent.setup();
    const { onMasteryChange } = renderBar();
    await user.click(screen.getByRole("button", { name: "Mastered" }));
    expect(onMasteryChange).toHaveBeenCalledWith("mastered");
  });

  it("disables non-all mastery buttons when superuserMasteryLocked is true", () => {
    renderBar(defaultFilters(), "national", { superuserMasteryLocked: true });
    const masteredBtn = screen.getByRole("button", { name: "Mastered" });
    expect(masteredBtn).toBeDisabled();
    // "All" in the mastery group must remain enabled. Scope to the mastery group
    // because the generation group also has an "All" button.
    const masteryGroup = screen.getByRole("group", { name: "Filter by mastery" });
    const allMasteryBtn = masteryGroup.querySelector("button:not([disabled])");
    expect(allMasteryBtn).not.toBeNull();
    expect(allMasteryBtn).toHaveTextContent("All");
  });
});

// ---------------------------------------------------------------------------
// Japanese locale — chrome strings render in Japanese (#1369)
// ---------------------------------------------------------------------------

describe("PokedexFilterBar — Japanese locale", () => {
  it("renders the sort label in Japanese", () => {
    renderJa(
      <PokedexFilterBar
        filters={defaultFilters()}
        sort="national"
        onQueryChange={vi.fn()}
        onTypeToggle={vi.fn()}
        onGenChange={vi.fn()}
        onAlternateFormsToggle={vi.fn()}
        onMasteryChange={vi.fn()}
        onSortChange={vi.fn()}
      />,
    );
    // messages/ja.json pokedex.sortBy = "並び替え"
    expect(screen.getByLabelText("並び替え")).toBeInTheDocument();
  });

  it("renders the search label in Japanese", () => {
    renderJa(
      <PokedexFilterBar
        filters={defaultFilters()}
        sort="national"
        onQueryChange={vi.fn()}
        onTypeToggle={vi.fn()}
        onGenChange={vi.fn()}
        onAlternateFormsToggle={vi.fn()}
        onMasteryChange={vi.fn()}
        onSortChange={vi.fn()}
      />,
    );
    // messages/ja.json pokedex.searchAriaLabel = "Pokémon を検索"
    expect(screen.getByRole("textbox", { name: "Pokémon を検索" })).toBeInTheDocument();
  });

  it("renders the generation All pill in Japanese", () => {
    renderJa(
      <PokedexFilterBar
        filters={defaultFilters()}
        sort="national"
        onQueryChange={vi.fn()}
        onTypeToggle={vi.fn()}
        onGenChange={vi.fn()}
        onAlternateFormsToggle={vi.fn()}
        onMasteryChange={vi.fn()}
        onSortChange={vi.fn()}
      />,
    );
    // messages/ja.json pokedex.generationAll = "すべて"
    const genGroup = screen.getByRole("group", { name: "世代でフィルター" });
    expect(genGroup.querySelector("button[aria-pressed]")).toHaveTextContent("すべて");
  });

  it("renders a Gen I pill in Japanese as 第I世代", () => {
    renderJa(
      <PokedexFilterBar
        filters={defaultFilters()}
        sort="national"
        onQueryChange={vi.fn()}
        onTypeToggle={vi.fn()}
        onGenChange={vi.fn()}
        onAlternateFormsToggle={vi.fn()}
        onMasteryChange={vi.fn()}
        onSortChange={vi.fn()}
      />,
    );
    // messages/ja.json pokedex.generationLabel = "第{gen}世代" → "第I世代"
    expect(screen.getByRole("button", { name: "第I世代" })).toBeInTheDocument();
  });
});
