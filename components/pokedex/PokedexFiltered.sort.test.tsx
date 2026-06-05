/**
 * Component tests for PokedexFiltered sort persistence.
 *
 * Covers:
 *   - Default sort falls back to localStorage when no URL sort param exists.
 *   - Changing sort via the FilterBar callback writes to localStorage.
 *   - On mount, reads the sort from localStorage so the preference survives
 *     back-navigation / page reload.
 */

import { renderWithIntl, screen, waitFor } from "@/components/test-utils/renderWithIntl";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { KEY_POKEDEX_SORT } from "@/lib/storage/keys";

// ---------------------------------------------------------------------------
// localStorage stub - jsdom on this Node version does not ship localStorage.
// ---------------------------------------------------------------------------

function makeLocalStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() { return store.size; },
    clear: () => store.clear(),
    getItem: (k) => store.get(k) ?? null,
    key: (i) => Array.from(store.keys())[i] ?? null,
    removeItem: (k) => { store.delete(k); },
    setItem: (k, v) => { store.set(k, String(v)); },
  };
}

// ---------------------------------------------------------------------------
// next/navigation mocks - must be declared before the component import.
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

vi.mock("@/lib/superuser/SuperuserContext", () => ({
  useSuperuser: () => ({ flags: { pretendAllMastered: false } }),
}));

// ---------------------------------------------------------------------------
// PokemonLocaleContext - return English locale (no locale names to load).
// ---------------------------------------------------------------------------

vi.mock("@/lib/i18n/PokemonLocaleContext", () => ({
  usePokemonLocaleContext: () => ({ locale: "en", languagesEnabled: false }),
}));

// ---------------------------------------------------------------------------
// Stub PokedexFilterBar - captures onSortChange so tests can invoke it.
// ---------------------------------------------------------------------------

let capturedOnSortChange: ((sort: string) => void) | null = null;
let capturedSort = "national";

vi.mock("@/components/pokedex/PokedexFilterBar", () => ({
  default: ({
    sort,
    onSortChange,
  }: {
    sort: string;
    onSortChange: (sort: string) => void;
  }) => {
    capturedOnSortChange = onSortChange;
    capturedSort = sort;
    return (
      <div data-testid="filter-bar" data-sort={sort}>
        <button onClick={() => onSortChange("alphabetical")}>Sort Alphabetical</button>
        <button onClick={() => onSortChange("national")}>Sort National</button>
        <button onClick={() => onSortChange("closest-to-mastery")}>Sort Mastery</button>
      </div>
    );
  },
}));

// PokedexGrid stub: renders pokemon names in order.
vi.mock("@/components/pokedex/PokedexGrid", () => ({
  default: ({ pokemon }: { pokemon: Array<{ id: number; name: string }> }) => (
    <ul data-testid="pokedex-grid">
      {pokemon.map((p) => (
        <li key={p.id} data-pokemon-name={p.name}>
          {p.name}
        </li>
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

const SAMPLE = [
  makeCell({ id: 1, name: "Bulbasaur" }),
  makeCell({ id: 4, name: "Charmander" }),
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("PokedexFiltered - sort persistence", () => {
  let storage: Storage;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSearchParams.value = new URLSearchParams();
    capturedOnSortChange = null;
    capturedSort = "national";
    storage = makeLocalStorage();
    Object.defineProperty(window, "localStorage", {
      value: storage,
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    storage.clear();
  });

  it("defaults to national sort when no localStorage key is present", () => {
    renderWithIntl(<PokedexFiltered enrichedPokemon={SAMPLE} />);
    const filterBar = screen.getByTestId("filter-bar");
    expect(filterBar).toHaveAttribute("data-sort", "national");
  });

  it("reads stored sort preference from localStorage on mount", () => {
    storage.setItem(KEY_POKEDEX_SORT, "alphabetical");
    renderWithIntl(<PokedexFiltered enrichedPokemon={SAMPLE} />);
    const filterBar = screen.getByTestId("filter-bar");
    expect(filterBar).toHaveAttribute("data-sort", "alphabetical");
  });

  it("reads closest-to-mastery from localStorage on mount", () => {
    storage.setItem(KEY_POKEDEX_SORT, "closest-to-mastery");
    renderWithIntl(<PokedexFiltered enrichedPokemon={SAMPLE} />);
    const filterBar = screen.getByTestId("filter-bar");
    expect(filterBar).toHaveAttribute("data-sort", "closest-to-mastery");
  });

  it("writes to localStorage when sort changes via FilterBar callback", async () => {
    const user = userEvent.setup();
    renderWithIntl(<PokedexFiltered enrichedPokemon={SAMPLE} />);

    await user.click(screen.getByRole("button", { name: /Filters/i }));
    await user.click(screen.getByRole("button", { name: "Sort Alphabetical" }));

    await waitFor(() => {
      expect(storage.getItem(KEY_POKEDEX_SORT)).toBe("alphabetical");
    });
  });

  it("URL sort param takes priority over localStorage when present", () => {
    storage.setItem(KEY_POKEDEX_SORT, "alphabetical");
    mockSearchParams.value = new URLSearchParams({ sort: "closest-to-mastery" });
    renderWithIntl(<PokedexFiltered enrichedPokemon={SAMPLE} />);
    const filterBar = screen.getByTestId("filter-bar");
    expect(filterBar).toHaveAttribute("data-sort", "closest-to-mastery");
  });
});
