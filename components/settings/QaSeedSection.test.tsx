import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { QaSeedSection } from "@/components/settings/QaSeedSection";
import { SCENARIOS } from "@/lib/qa-seed/scenarios";

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
    vi.clearAllMocks();
    vi.stubGlobal("confirm", vi.fn().mockReturnValue(true));
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
});
