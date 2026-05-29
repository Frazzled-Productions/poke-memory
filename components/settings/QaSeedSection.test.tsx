/**
 * Component tests for QaSeedSection (#1326).
 *
 * Runs in the jsdom project (components/**). Mocks the IDB/localStorage layer
 * so no real writes happen in tests.
 */

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { QaSeedSection } from "@/components/settings/QaSeedSection";
import { SCENARIO_META } from "@/lib/qa-seed/scenarios";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("@/lib/qa-seed/apply", () => ({
  applyScenario: vi.fn().mockResolvedValue(undefined),
  clearSeed: vi.fn().mockResolvedValue(undefined),
}));

import { applyScenario, clearSeed } from "@/lib/qa-seed/apply";

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
  });

  it("renders the section heading and description", () => {
    renderSection();
    expect(screen.getByText("QA seed")).toBeInTheDocument();
    expect(screen.getByText(/Inject a curated scenario payload/i)).toBeInTheDocument();
  });

  it("renders all three required scenario options in the dropdown", () => {
    renderSection();
    const select = screen.getByRole("combobox", { name: /Scenario/i });
    expect(select).toBeInTheDocument();

    for (const meta of SCENARIO_META) {
      expect(screen.getByRole("option", { name: meta.label })).toBeInTheDocument();
    }
  });

  it("renders Apply seed and Clear seed buttons", () => {
    renderSection();
    expect(screen.getByRole("button", { name: /Apply QA seed scenario/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Clear QA seed/i })).toBeInTheDocument();
  });

  it("shows scenario description when a scenario is selected by default", () => {
    renderSection();
    // The first scenario's description should be visible by default.
    expect(screen.getByText(SCENARIO_META[0].description)).toBeInTheDocument();
  });

  it("calls applyScenario with the selected key when Apply seed is clicked", async () => {
    const user = userEvent.setup();
    renderSection();

    const applyBtn = screen.getByRole("button", { name: /Apply QA seed scenario/i });
    await user.click(applyBtn);

    await waitFor(() => {
      expect(applyScenario).toHaveBeenCalledWith(SCENARIO_META[0].key);
    });
  });

  it("calls clearSeed when Clear seed is clicked", async () => {
    const user = userEvent.setup();
    renderSection();

    const clearBtn = screen.getByRole("button", { name: /Clear QA seed/i });
    await user.click(clearBtn);

    await waitFor(() => {
      expect(clearSeed).toHaveBeenCalled();
    });
  });

  it("disables both buttons while applying", async () => {
    // Make applyScenario a promise that does not resolve immediately.
    let resolveApply!: () => void;
    vi.mocked(applyScenario).mockReturnValue(
      new Promise<void>((res) => { resolveApply = res; }),
    );

    const user = userEvent.setup();
    renderSection();

    const applyBtn = screen.getByRole("button", { name: /Apply QA seed scenario/i });
    const clearBtn = screen.getByRole("button", { name: /Clear QA seed/i });

    void user.click(applyBtn);

    await waitFor(() => {
      expect(applyBtn).toBeDisabled();
      expect(clearBtn).toBeDisabled();
    });

    // Resolve so the test doesn't leave dangling promises.
    resolveApply();
    await waitFor(() => {
      expect(applyBtn).not.toBeDisabled();
    });
  });

  it("shows success message after successful apply", async () => {
    const user = userEvent.setup();
    renderSection();

    await user.click(screen.getByRole("button", { name: /Apply QA seed scenario/i }));

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(/Seed applied/i);
    });
  });

  it("shows error message when applyScenario throws", async () => {
    vi.mocked(applyScenario).mockRejectedValue(new Error("IDB unavailable"));

    const user = userEvent.setup();
    renderSection();

    await user.click(screen.getByRole("button", { name: /Apply QA seed scenario/i }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/IDB unavailable/i);
    });
  });

  it("updates description when scenario selection changes", async () => {
    const user = userEvent.setup();
    renderSection();

    const select = screen.getByRole("combobox", { name: /Scenario/i });
    // Switch to the second scenario (optimiser-stress).
    await user.selectOptions(select, SCENARIO_META[1].key);

    expect(screen.getByText(SCENARIO_META[1].description)).toBeInTheDocument();
  });
});
