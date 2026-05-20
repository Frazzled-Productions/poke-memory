/**
 * Unit tests for FirstVisitOnboardingModal (#1103).
 *
 * Covers: open on fresh visit, dismiss persists flag, does not re-open after
 * dismiss, Settings reset re-opens it.
 */

import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { FirstVisitOnboardingModal } from "@/components/onboarding/FirstVisitOnboardingModal";
import { saveSettings, loadSettings, DEFAULT_ONBOARDING } from "@/lib/settings/persistence";

// AuthContext is consumed by FirstVisitOnboardingModal. Provide a minimal stub.
vi.mock("@/lib/auth/AuthContext", () => ({
  useAuth: () => ({ user: null, loading: false }),
}));

// jsdom on this Node version does not ship localStorage out of the box, so
// the component test provides its own stub (same pattern as VoiceQualityHint.test.tsx).
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

describe("FirstVisitOnboardingModal", () => {
  beforeEach(() => {
    Object.defineProperty(window, "localStorage", {
      value: makeLocalStorage(),
      configurable: true,
      writable: true,
    });
    // window.dispatchEvent is called by saveSettings — ensure it exists in jsdom.
    if (!window.dispatchEvent) {
      Object.defineProperty(window, "dispatchEvent", {
        value: vi.fn(),
        configurable: true,
        writable: true,
      });
    }
  });

  afterEach(() => {
    delete (window as unknown as { localStorage?: unknown }).localStorage;
  });

  it("opens on a fresh visit (flag absent)", async () => {
    render(<FirstVisitOnboardingModal />);
    // After useEffect runs the modal should appear.
    expect(
      await screen.findByRole("dialog", { name: /welcome to poke memory/i }),
    ).toBeInTheDocument();
  });

  it("renders grading guidance content", async () => {
    render(<FirstVisitOnboardingModal />);
    await screen.findByRole("dialog", { name: /welcome to poke memory/i });
    // "Again" appears as a bold label in the grading list; getAllByText handles
    // the fact that the text matches both the <strong> and its parent <li>.
    expect(screen.getAllByText(/again/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/grade honestly/i)).toBeInTheDocument();
  });

  it("closes and persists flag when the Get started button is clicked", async () => {
    const user = userEvent.setup();
    render(<FirstVisitOnboardingModal />);
    await screen.findByRole("dialog");

    await user.click(screen.getByRole("button", { name: /get started/i }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    const settings = loadSettings();
    expect(settings.onboarding.firstVisitOnboardingDismissed).toBe(true);
  });

  it("closes and persists flag when the X button is clicked", async () => {
    const user = userEvent.setup();
    render(<FirstVisitOnboardingModal />);
    await screen.findByRole("dialog");

    await user.click(screen.getByRole("button", { name: /close welcome guide/i }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    const settings = loadSettings();
    expect(settings.onboarding.firstVisitOnboardingDismissed).toBe(true);
  });

  it("does not open when firstVisitOnboardingDismissed is already true", async () => {
    // Pre-seed the flag as dismissed.
    const current = loadSettings();
    saveSettings({
      ...current,
      onboarding: { ...DEFAULT_ONBOARDING, firstVisitOnboardingDismissed: true },
    });

    render(<FirstVisitOnboardingModal />);

    // Give React time to run effects.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("calls onDismiss callback when closed", async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn();
    render(<FirstVisitOnboardingModal onDismiss={onDismiss} />);
    await screen.findByRole("dialog");

    await user.click(screen.getByRole("button", { name: /get started/i }));

    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("re-opens after Settings resets DEFAULT_ONBOARDING", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<FirstVisitOnboardingModal />);
    await screen.findByRole("dialog");

    // Dismiss it.
    await user.click(screen.getByRole("button", { name: /get started/i }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    // Simulate the Settings "Show tips again" reset.
    act(() => {
      const current = loadSettings();
      saveSettings({ ...current, onboarding: { ...DEFAULT_ONBOARDING } });
    });

    // Re-render; the SETTINGS_SAVED_EVENT listener should pick up the change.
    rerender(<FirstVisitOnboardingModal />);

    expect(
      await screen.findByRole("dialog", { name: /welcome to poke memory/i }),
    ).toBeInTheDocument();
  });
});
