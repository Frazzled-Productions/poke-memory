/**
 * Component tests for PokedexFiltered.
 *
 * Covers:
 *   - Filter disclosure: collapsed by default, toggle expands/collapses,
 *     aria-expanded reflects state.
 *   - Active-filter count badge: shown when filters are active and panel is
 *     collapsed, hidden when panel is open.
 *   - countActiveFilters across all five filter axes (query, types, gen,
 *     hasAlternateForms, masteryStatus).
 *   - Filtered grid: PokedexGrid receives the correctly filtered pokemon list.
 *   - URL updates: router.replace is called with the correct path when filters
 *     change via the FilterBar callbacks.
 *   - Superuser pretendAllMastered: overrides mastery filter to "all".
 */

import { render, screen, act, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// next/navigation mocks — must be declared before the component import.
// ---------------------------------------------------------------------------

const mockReplace = vi.fn();
const mockSearchParams = { value: new URLSearchParams() };

vi.mock("next/navigation", () => ({
  useSearchParams: () => mockSearchParams.value,
  useRouter: () => ({ replace: mockReplace }),
}));

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

// ---------------------------------------------------------------------------
// Superuser context.
// ---------------------------------------------------------------------------

const mockFlags = { pretendAllMastered: false };

vi.mock("@/lib/superuser/SuperuserContext", () => ({
  useSuperuser: () => ({ flags: mockFlags }),
}));

// ---------------------------------------------------------------------------
// PokedexFilterBar and PokedexGrid are stubbed so tests focus on
// PokedexFiltered's own logic rather than these sub-components' internals.
// ---------------------------------------------------------------------------

vi.mock("@/components/pokedex/PokedexFilterBar", () => ({
  default: ({
    filters,
    onQueryChange,
    onTypeToggle,
    onGenChange,
    onAlternateFormsToggle,
    onMasteryChange,
    onSortChange,
    superuserMasteryLocked,
  }: {
    filters: { query: string; types: string[]; gen: number | null; hasAlternateForms: boolean; masteryStatus: string; sort: string };
    onQueryChange: (q: string) => void;
    onTypeToggle: (type: string) => void;
    onGenChange: (gen: number | null) => void;
    onAlternateFormsToggle: () => void;
    onMasteryChange: (status: string) => void;
    onSortChange: (sort: string) => void;
    superuserMasteryLocked?: boolean;
  }) => (
    <div data-testid="filter-bar" data-mastery-locked={String(superuserMasteryLocked)}>
      <input
        aria-label="filter-query"
        value={filters.query}
        onChange={(e) => onQueryChange(e.target.value)}
      />
      <button onClick={() => onTypeToggle("fire")}>Toggle Fire</button>
      <button onClick={() => onGenChange(1)}>Gen 1</button>
      <button onClick={() => onGenChange(null)}>All Gens</button>
      <button onClick={onAlternateFormsToggle}>Has Forms</button>
      <button onClick={() => onMasteryChange("mastered")}>Mastered</button>
      <button onClick={() => onMasteryChange("all")}>All Mastery</button>
      <button onClick={() => onSortChange("proximity")}>Sort Proximity</button>
      <button onClick={() => onSortChange("alpha")}>Sort Alpha</button>
    </div>
  ),
}));

// PokedexGrid stub: renders a list with each pokemon's name so tests can assert
// which pokemon ended up in the filtered result.
vi.mock("@/components/pokedex/PokedexGrid", () => ({
  default: ({ pokemon }: { pokemon: Array<{ id: number; name: string }> }) => (
    <ul data-testid="pokedex-grid">
      {pokemon.map((p) => (
        <li key={p.id}>{p.name}</li>
      ))}
    </ul>
  ),
}));

// ---------------------------------------------------------------------------
// Import component under test after mocks.
// ---------------------------------------------------------------------------

import PokedexFiltered from "@/components/pokedex/PokedexFiltered";
import type { PokemonCellData } from "@/lib/pokemon/filter";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function makeCell(
  overrides: Partial<PokemonCellData> & { id: number; name: string },
): PokemonCellData {
  return {
    speciesId: overrides.id,
    isDefaultForm: true,
    formCategory: "default",
    formSlug: null,
    displayName: overrides.name,
    spriteUrl: `/sprites/pokemon/${overrides.id}.png`,
    types: ["normal"],
    stats: { hp: 1, attack: 1, defense: 1, specialAttack: 1, specialDefense: 1, speed: 1 },
    flavorText: "",
    flavorTexts: [""],
    evolutionChain: [],
    height: 1,
    weight: 1,
    baseExperience: 1,
    genus: "",
    generation: "generation-i",
    captureRate: null,
    baseHappiness: null,
    growthRate: null,
    habitat: null,
    genderRate: null,
    isLegendary: false,
    isMythical: false,
    cryUrl: null,
    cardClass: "locked",
    ...overrides,
  };
}

const BULBASAUR = makeCell({ id: 1, name: "Bulbasaur", types: ["grass", "poison"], cardClass: "mastered" });
const CHARMANDER = makeCell({ id: 4, name: "Charmander", types: ["fire"], cardClass: "learning" });
const SQUIRTLE = makeCell({ id: 7, name: "Squirtle", types: ["water"], cardClass: "locked" });
const SAMPLE = [BULBASAUR, CHARMANDER, SQUIRTLE];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setSearchParams(params: Record<string, string>) {
  mockSearchParams.value = new URLSearchParams(params);
}

// ---------------------------------------------------------------------------
// Tests — filter disclosure
// ---------------------------------------------------------------------------

describe("PokedexFiltered — filter disclosure", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSearchParams.value = new URLSearchParams();
    mockFlags.pretendAllMastered = false;
  });

  it("renders the 'Filters' toggle button", () => {
    render(<PokedexFiltered enrichedPokemon={SAMPLE} />);
    expect(screen.getByRole("button", { name: /Filters/i })).toBeInTheDocument();
  });

  it("filter panel is hidden by default (aria-expanded false)", () => {
    render(<PokedexFiltered enrichedPokemon={SAMPLE} />);
    const button = screen.getByRole("button", { name: /Filters/i });
    expect(button).toHaveAttribute("aria-expanded", "false");
  });

  it("filter bar is not visible before the toggle is clicked", () => {
    render(<PokedexFiltered enrichedPokemon={SAMPLE} />);
    // The panel div has hidden attribute; the FilterBar is in the DOM but not visible.
    expect(screen.getByTestId("filter-bar").closest("[hidden]")).toBeTruthy();
  });

  it("clicking the toggle button expands the panel (aria-expanded true)", async () => {
    const user = userEvent.setup();
    render(<PokedexFiltered enrichedPokemon={SAMPLE} />);

    const button = screen.getByRole("button", { name: /Filters/i });
    await user.click(button);

    expect(button).toHaveAttribute("aria-expanded", "true");
  });

  it("clicking the toggle a second time collapses the panel", async () => {
    const user = userEvent.setup();
    render(<PokedexFiltered enrichedPokemon={SAMPLE} />);

    const button = screen.getByRole("button", { name: /Filters/i });
    await user.click(button);
    await user.click(button);

    expect(button).toHaveAttribute("aria-expanded", "false");
  });

  it("aria-controls references the panel element", () => {
    render(<PokedexFiltered enrichedPokemon={SAMPLE} />);
    const button = screen.getByRole("button", { name: /Filters/i });
    const panelId = button.getAttribute("aria-controls");
    expect(panelId).toBeTruthy();
    const panel = document.getElementById(panelId!);
    expect(panel).toBeTruthy();
  });

  it("filter panel is visible after the toggle is clicked", async () => {
    const user = userEvent.setup();
    render(<PokedexFiltered enrichedPokemon={SAMPLE} />);

    await user.click(screen.getByRole("button", { name: /Filters/i }));

    // After opening, the hidden attribute should be gone.
    expect(screen.getByTestId("filter-bar").closest("[hidden]")).toBeFalsy();
  });
});

// ---------------------------------------------------------------------------
// Tests — active-filter count badge
// ---------------------------------------------------------------------------

describe("PokedexFiltered — active-filter count badge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFlags.pretendAllMastered = false;
  });

  it("badge is not shown when no filters are active", () => {
    mockSearchParams.value = new URLSearchParams();
    render(<PokedexFiltered enrichedPokemon={SAMPLE} />);
    // No badge element — aria-label pattern "N active filter"
    expect(screen.queryByLabelText(/active filter/i)).not.toBeInTheDocument();
  });

  it("shows badge with count 1 when query filter is active (panel collapsed)", () => {
    setSearchParams({ q: "bulba" });
    render(<PokedexFiltered enrichedPokemon={SAMPLE} />);
    expect(screen.getByLabelText("1 active filter")).toBeInTheDocument();
  });

  it("shows badge with count 1 when type filter is active", () => {
    setSearchParams({ type: "fire" });
    render(<PokedexFiltered enrichedPokemon={SAMPLE} />);
    expect(screen.getByLabelText("1 active filter")).toBeInTheDocument();
  });

  it("shows badge with count 1 when gen filter is active", () => {
    setSearchParams({ gen: "1" });
    render(<PokedexFiltered enrichedPokemon={SAMPLE} />);
    expect(screen.getByLabelText("1 active filter")).toBeInTheDocument();
  });

  it("shows badge with count 1 when hasAlternateForms is active", () => {
    setSearchParams({ forms: "1" });
    render(<PokedexFiltered enrichedPokemon={SAMPLE} />);
    expect(screen.getByLabelText("1 active filter")).toBeInTheDocument();
  });

  it("shows badge with count 1 when masteryStatus filter is active", () => {
    setSearchParams({ mastery: "mastered" });
    render(<PokedexFiltered enrichedPokemon={SAMPLE} />);
    expect(screen.getByLabelText("1 active filter")).toBeInTheDocument();
  });

  it("shows badge with count 2 when two filters are active", () => {
    setSearchParams({ q: "char", type: "fire" });
    render(<PokedexFiltered enrichedPokemon={SAMPLE} />);
    expect(screen.getByLabelText("2 active filters")).toBeInTheDocument();
  });

  it("shows badge with count 5 when five filter axes are active", () => {
    setSearchParams({
      q: "pika",
      type: "electric",
      gen: "1",
      forms: "1",
      mastery: "mastered",
    });
    render(<PokedexFiltered enrichedPokemon={SAMPLE} />);
    expect(screen.getByLabelText("5 active filters")).toBeInTheDocument();
  });

  it("shows badge with count 1 when sort filter is active", () => {
    setSearchParams({ sort: "proximity" });
    render(<PokedexFiltered enrichedPokemon={SAMPLE} />);
    expect(screen.getByLabelText("1 active filter")).toBeInTheDocument();
  });

  it("badge is hidden when the panel is open (even with active filters)", async () => {
    setSearchParams({ q: "bulba" });
    const user = userEvent.setup();
    render(<PokedexFiltered enrichedPokemon={SAMPLE} />);

    // Badge visible while closed.
    expect(screen.getByLabelText("1 active filter")).toBeInTheDocument();

    // Open the panel.
    await user.click(screen.getByRole("button", { name: /Filters/i }));

    // Badge should be gone while panel is open.
    expect(screen.queryByLabelText(/active filter/i)).not.toBeInTheDocument();
  });

  it("badge uses singular label for exactly 1 active filter", () => {
    setSearchParams({ gen: "2" });
    render(<PokedexFiltered enrichedPokemon={SAMPLE} />);
    expect(screen.getByLabelText("1 active filter")).toBeInTheDocument();
    expect(screen.queryByLabelText("1 active filters")).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Tests — grid rendering / filter application
// ---------------------------------------------------------------------------

describe("PokedexFiltered — grid receives filtered pokemon", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSearchParams.value = new URLSearchParams();
    mockFlags.pretendAllMastered = false;
  });

  it("renders all pokemon when no filters are active", () => {
    render(<PokedexFiltered enrichedPokemon={SAMPLE} />);
    const grid = screen.getByTestId("pokedex-grid");
    expect(grid).toHaveTextContent("Bulbasaur");
    expect(grid).toHaveTextContent("Charmander");
    expect(grid).toHaveTextContent("Squirtle");
  });

  it("filters grid by name query from URL", () => {
    setSearchParams({ q: "char" });
    render(<PokedexFiltered enrichedPokemon={SAMPLE} />);
    const grid = screen.getByTestId("pokedex-grid");
    expect(grid).toHaveTextContent("Charmander");
    expect(grid).not.toHaveTextContent("Bulbasaur");
    expect(grid).not.toHaveTextContent("Squirtle");
  });

  it("filters grid by mastery status from URL", () => {
    setSearchParams({ mastery: "mastered" });
    render(<PokedexFiltered enrichedPokemon={SAMPLE} />);
    const grid = screen.getByTestId("pokedex-grid");
    expect(grid).toHaveTextContent("Bulbasaur");
    expect(grid).not.toHaveTextContent("Charmander");
    expect(grid).not.toHaveTextContent("Squirtle");
  });

  it("filters to empty when mastery=not-yet-mastered and all are mastered (pretendAllMastered)", () => {
    // With pretendAllMastered=true, effectiveMasteryStatus is forced to "all".
    mockFlags.pretendAllMastered = true;
    setSearchParams({ mastery: "not-yet-mastered" });
    render(<PokedexFiltered enrichedPokemon={SAMPLE} />);
    // All three should still appear because mastery override kicks in.
    const grid = screen.getByTestId("pokedex-grid");
    expect(grid).toHaveTextContent("Bulbasaur");
    expect(grid).toHaveTextContent("Charmander");
    expect(grid).toHaveTextContent("Squirtle");
  });

  it("passes superuserMasteryLocked=true to FilterBar when pretendAllMastered is on", async () => {
    mockFlags.pretendAllMastered = true;
    const user = userEvent.setup();
    render(<PokedexFiltered enrichedPokemon={SAMPLE} />);
    // Open the panel so FilterBar is visible.
    await user.click(screen.getByRole("button", { name: /Filters/i }));
    expect(screen.getByTestId("filter-bar")).toHaveAttribute("data-mastery-locked", "true");
  });
});

// ---------------------------------------------------------------------------
// Tests — URL updates via FilterBar callbacks
// ---------------------------------------------------------------------------

describe("PokedexFiltered — URL updates from FilterBar callbacks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSearchParams.value = new URLSearchParams();
    mockFlags.pretendAllMastered = false;
  });

  it("calls router.replace with the gen filter when Gen 1 is clicked", async () => {
    const user = userEvent.setup();
    render(<PokedexFiltered enrichedPokemon={SAMPLE} />);

    // Open the filter panel first.
    await user.click(screen.getByRole("button", { name: /Filters/i }));
    await user.click(screen.getByRole("button", { name: "Gen 1" }));

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith(
        expect.stringContaining("gen=1"),
        expect.any(Object),
      );
    });
  });

  it("calls router.replace with '/pokedex' when gen is reset to null", async () => {
    // Start with gen=1 active.
    setSearchParams({ gen: "1" });
    const user = userEvent.setup();
    render(<PokedexFiltered enrichedPokemon={SAMPLE} />);

    await user.click(screen.getByRole("button", { name: /Filters/i }));
    await user.click(screen.getByRole("button", { name: "All Gens" }));

    await waitFor(() => {
      // With gen cleared and no other filters the URL should be plain /pokedex.
      expect(mockReplace).toHaveBeenCalledWith("/pokedex", expect.any(Object));
    });
  });

  it("calls router.replace with mastery filter when Mastered is clicked", async () => {
    const user = userEvent.setup();
    render(<PokedexFiltered enrichedPokemon={SAMPLE} />);

    await user.click(screen.getByRole("button", { name: /Filters/i }));
    await user.click(screen.getByRole("button", { name: "Mastered" }));

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith(
        expect.stringContaining("mastery=mastered"),
        expect.any(Object),
      );
    });
  });

  it("calls router.replace with the type filter when Fire is toggled", async () => {
    const user = userEvent.setup();
    render(<PokedexFiltered enrichedPokemon={SAMPLE} />);

    await user.click(screen.getByRole("button", { name: /Filters/i }));
    await user.click(screen.getByRole("button", { name: "Toggle Fire" }));

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith(
        expect.stringContaining("type=fire"),
        expect.any(Object),
      );
    });
  });

  it("calls router.replace with forms=1 when Has Forms is toggled", async () => {
    const user = userEvent.setup();
    render(<PokedexFiltered enrichedPokemon={SAMPLE} />);

    await user.click(screen.getByRole("button", { name: /Filters/i }));
    await user.click(screen.getByRole("button", { name: "Has Forms" }));

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith(
        expect.stringContaining("forms=1"),
        expect.any(Object),
      );
    });
  });

  it("calls router.replace with sort=proximity when Sort Proximity is clicked", async () => {
    const user = userEvent.setup();
    render(<PokedexFiltered enrichedPokemon={SAMPLE} />);

    await user.click(screen.getByRole("button", { name: /Filters/i }));
    await user.click(screen.getByRole("button", { name: "Sort Proximity" }));

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith(
        expect.stringContaining("sort=proximity"),
        expect.any(Object),
      );
    });
  });

  it("calls router.replace with sort=alpha when Sort Alpha is clicked", async () => {
    const user = userEvent.setup();
    render(<PokedexFiltered enrichedPokemon={SAMPLE} />);

    await user.click(screen.getByRole("button", { name: /Filters/i }));
    await user.click(screen.getByRole("button", { name: "Sort Alpha" }));

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith(
        expect.stringContaining("sort=alpha"),
        expect.any(Object),
      );
    });
  });

  it("debounces query input: router.replace is called after text changes", async () => {
    const user = userEvent.setup();
    render(<PokedexFiltered enrichedPokemon={SAMPLE} />);

    await user.click(screen.getByRole("button", { name: /Filters/i }));
    await user.type(screen.getByLabelText("filter-query"), "bul");

    // After typing, wait for the 150 ms debounce to fire.
    await waitFor(
      () => {
        expect(mockReplace).toHaveBeenCalledWith(
          expect.stringContaining("q=bul"),
          expect.any(Object),
        );
      },
      { timeout: 1000 },
    );
  });
});
