import { renderWithIntl as render, screen } from "@/components/test-utils/renderWithIntl";
import { waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { QaSeedSection } from "@/components/settings/QaSeedSection";
import { SCENARIOS } from "@/lib/qa-seed/scenarios";
import { KEY_QA_SEED_ACTIVE } from "@/lib/storage/keys";

// ---------------------------------------------------------------------------
// localStorage stub
// ---------------------------------------------------------------------------

// jsdom on this Node version does not ship localStorage out of the box, so
// install an in-memory stub - matching the pattern in CollapsibleSection.test.tsx.
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
// Mocks
// ---------------------------------------------------------------------------

vi.mock("@/lib/qa-seed/apply", () => ({
  applySeedScenario: vi.fn().mockResolvedValue(undefined),
  clearSeedScenario: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/settings/persistence", () => ({
  loadSettings: vi.fn(() => ({ pokemonNameLocale: "en" })),
  saveSettings: vi.fn(),
  DEFAULT_SETTINGS: { pokemonNameLocale: "en" },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderSection() {
  return render(<QaSeedSection />);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("QaSeedSection", () => {
  beforeEach(() => {
    // Install a fresh in-memory localStorage stub (jsdom does not ship one).
    Object.defineProperty(window, "localStorage", {
      value: makeLocalStorage(),
      configurable: true,
      writable: true,
    });
    vi.clearAllMocks();
    vi.stubGlobal("confirm", vi.fn().mockReturnValue(true));
  });

  afterEach(() => {
    delete (window as unknown as { localStorage?: unknown }).localStorage;
  });

  it("renders the QA seed heading and scenario dropdown", () => {
    renderSection();
    expect(screen.getByText("QA seed")).toBeInTheDocument();
    const select = screen.getByRole("combobox", { name: /scenario/i });
    expect(select).toBeInTheDocument();
  });

  it("lists all registered scenarios as options", () => {
    renderSection();
    for (const scenario of SCENARIOS) {
      expect(screen.getByRole("option", { name: scenario.label })).toBeInTheDocument();
    }
  });

  it("shows the selected scenario description", () => {
    renderSection();
    // Default selection is the first scenario.
    expect(screen.getByText(SCENARIOS[0].description)).toBeInTheDocument();
  });

  it("shows 'Apply seed' and 'Clear seed' buttons", () => {
    renderSection();
    expect(screen.getByRole("button", { name: /apply.*seed/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /clear.*seed/i })).toBeInTheDocument();
  });

  it("calls applySeedScenario with the built payload when Apply is clicked", async () => {
    const user = userEvent.setup();
    const { applySeedScenario } = await import("@/lib/qa-seed/apply");
    renderSection();

    await user.click(screen.getByRole("button", { name: /apply.*seed/i }));

    await waitFor(() => {
      expect(applySeedScenario).toHaveBeenCalledTimes(1);
    });

    // The payload passed to applySeedScenario should match the first scenario's build().
    const payload = (applySeedScenario as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(payload).toBeDefined();
    expect(payload.session).toBeDefined();
  });

  it("shows 'Seed applied' status after successful apply", async () => {
    const user = userEvent.setup();
    renderSection();

    await user.click(screen.getByRole("button", { name: /apply.*seed/i }));

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(/seed applied/i);
    });
    expect(screen.getByRole("status")).toHaveTextContent("Reload the page");
  });

  it("calls clearSeedScenario when Clear is clicked", async () => {
    const user = userEvent.setup();
    const { clearSeedScenario } = await import("@/lib/qa-seed/apply");
    renderSection();

    await user.click(screen.getByRole("button", { name: /clear.*seed/i }));

    await waitFor(() => {
      expect(clearSeedScenario).toHaveBeenCalledTimes(1);
    });
  });

  it("shows 'Seed cleared' status after clearing", async () => {
    const user = userEvent.setup();
    renderSection();

    await user.click(screen.getByRole("button", { name: /clear.*seed/i }));

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(/seed cleared/i);
    });
  });

  it("does not apply if the confirm dialog is dismissed", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("confirm", vi.fn().mockReturnValue(false));
    const { applySeedScenario } = await import("@/lib/qa-seed/apply");
    renderSection();

    await user.click(screen.getByRole("button", { name: /apply.*seed/i }));

    expect(applySeedScenario).not.toHaveBeenCalled();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("updating the dropdown changes the displayed description", async () => {
    const user = userEvent.setup();
    renderSection();

    const secondScenario = SCENARIOS[1];
    await user.selectOptions(
      screen.getByRole("combobox", { name: /scenario/i }),
      secondScenario.slug,
    );

    expect(screen.getByText(secondScenario.description)).toBeInTheDocument();
  });

  // Active-seed indicator tests
  it("shows no active-seed indicator when no seed is stored in localStorage", () => {
    renderSection();
    expect(screen.queryByTestId("qa-seed-active-indicator")).toBeNull();
  });

  it("shows the active-seed indicator on mount when a seed slug is stored in localStorage", () => {
    const scenario = SCENARIOS[0];
    window.localStorage.setItem(KEY_QA_SEED_ACTIVE, scenario.slug);
    renderSection();
    const indicator = screen.getByTestId("qa-seed-active-indicator");
    expect(indicator).toBeInTheDocument();
    expect(indicator).toHaveTextContent(scenario.label);
  });

  it("shows the active-seed indicator after applying a seed", async () => {
    const user = userEvent.setup();
    renderSection();

    // No indicator before applying.
    expect(screen.queryByTestId("qa-seed-active-indicator")).toBeNull();

    await user.click(screen.getByRole("button", { name: /apply.*seed/i }));

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(/seed applied/i);
    });

    // Indicator should now reflect the applied scenario.
    const indicator = screen.getByTestId("qa-seed-active-indicator");
    expect(indicator).toBeInTheDocument();
    expect(indicator).toHaveTextContent(SCENARIOS[0].label);
  });

  it("clears the active-seed indicator after clearing a seed", async () => {
    // Pre-seed an active slug.
    const scenario = SCENARIOS[0];
    window.localStorage.setItem(KEY_QA_SEED_ACTIVE, scenario.slug);

    const user = userEvent.setup();
    renderSection();

    // Indicator is visible on mount.
    expect(screen.getByTestId("qa-seed-active-indicator")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /clear.*seed/i }));

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(/seed cleared/i);
    });

    // Indicator should be gone.
    expect(screen.queryByTestId("qa-seed-active-indicator")).toBeNull();
  });

  it("persists the active slug across remount (simulates navigating away and back)", () => {
    const scenario = SCENARIOS[1];
    window.localStorage.setItem(KEY_QA_SEED_ACTIVE, scenario.slug);

    // First mount.
    const { unmount } = renderSection();
    expect(screen.getByTestId("qa-seed-active-indicator")).toBeInTheDocument();
    unmount();

    // Second mount (same localStorage key still present).
    renderSection();
    const indicator = screen.getByTestId("qa-seed-active-indicator");
    expect(indicator).toBeInTheDocument();
    expect(indicator).toHaveTextContent(scenario.label);
  });
});
