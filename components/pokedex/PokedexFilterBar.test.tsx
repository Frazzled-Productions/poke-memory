/**
 * Unit tests for PokedexFilterBar (#1314).
 *
 * Covers the sort dropdown (SORT_OPTIONS) and the onSortChange callback.
 * Type chips, mastery filter, and generation pills are integration-tested via
 * PokedexFiltered.test.tsx; this file targets lines otherwise unreachable from
 * the mock FilterBar used by those tests.
 */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi } from "vitest";
import PokedexFilterBar from "@/components/pokedex/PokedexFilterBar";
import type { PokedexFilters } from "@/lib/pokemon/filter";

function defaultFilters(): PokedexFilters {
  return {
    query: "",
    types: [],
    gen: null,
    hasAlternateForms: false,
    masteryStatus: "all",
    sort: "national",
  };
}

describe("PokedexFilterBar — sort dropdown", () => {
  it("renders the sort select with all three options", () => {
    render(
      <PokedexFilterBar
        filters={defaultFilters()}
        onQueryChange={vi.fn()}
        onTypeToggle={vi.fn()}
        onGenChange={vi.fn()}
        onAlternateFormsToggle={vi.fn()}
        onMasteryChange={vi.fn()}
        onSortChange={vi.fn()}
      />,
    );

    const select = screen.getByRole("combobox", { name: /Sort Pokédex/i });
    expect(select).toBeInTheDocument();

    const options = screen.getAllByRole("option");
    const optionValues = options.map((o) => (o as HTMLOptionElement).value);
    expect(optionValues).toContain("national");
    expect(optionValues).toContain("alpha");
    expect(optionValues).toContain("proximity");
  });

  it("reflects the current sort value", () => {
    render(
      <PokedexFilterBar
        filters={{ ...defaultFilters(), sort: "alpha" }}
        onQueryChange={vi.fn()}
        onTypeToggle={vi.fn()}
        onGenChange={vi.fn()}
        onAlternateFormsToggle={vi.fn()}
        onMasteryChange={vi.fn()}
        onSortChange={vi.fn()}
      />,
    );

    const select = screen.getByRole("combobox", { name: /Sort Pokédex/i });
    expect(select).toHaveValue("alpha");
  });

  it("calls onSortChange with the new sort value when the select changes", async () => {
    const onSortChange = vi.fn();
    render(
      <PokedexFilterBar
        filters={defaultFilters()}
        onQueryChange={vi.fn()}
        onTypeToggle={vi.fn()}
        onGenChange={vi.fn()}
        onAlternateFormsToggle={vi.fn()}
        onMasteryChange={vi.fn()}
        onSortChange={onSortChange}
      />,
    );

    const select = screen.getByRole("combobox", { name: /Sort Pokédex/i });
    await userEvent.selectOptions(select, "alpha");
    expect(onSortChange).toHaveBeenCalledWith("alpha");
  });
});

describe("PokedexFilterBar — mastery filter", () => {
  it("renders the mastery filter group with All, Mastered, and Not yet mastered options", () => {
    render(
      <PokedexFilterBar
        filters={defaultFilters()}
        onQueryChange={vi.fn()}
        onTypeToggle={vi.fn()}
        onGenChange={vi.fn()}
        onAlternateFormsToggle={vi.fn()}
        onMasteryChange={vi.fn()}
        onSortChange={vi.fn()}
      />,
    );

    const group = screen.getByRole("group", { name: /Filter by mastery/i });
    expect(group).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "All" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mastered" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Not yet mastered" })).toBeInTheDocument();
  });

  it("disables mastery filter options when superuserMasteryLocked is true", () => {
    render(
      <PokedexFilterBar
        filters={defaultFilters()}
        onQueryChange={vi.fn()}
        onTypeToggle={vi.fn()}
        onGenChange={vi.fn()}
        onAlternateFormsToggle={vi.fn()}
        onMasteryChange={vi.fn()}
        onSortChange={vi.fn()}
        superuserMasteryLocked={true}
      />,
    );

    // Non-"all" buttons should be disabled when locked.
    expect(screen.getByRole("button", { name: "Mastered" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Not yet mastered" })).toBeDisabled();
    // "All" must remain enabled.
    expect(screen.getByRole("button", { name: "All" })).not.toBeDisabled();
  });
});
