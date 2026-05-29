/**
 * Unit tests for FirstVisitOnboardingModal (#1103, #1369).
 *
 * Covers: open on fresh visit, dismiss persists flag, does not re-open after
 * dismiss, Settings reset re-opens it, locale rendering (ja), and
 * MachineTranslationBanner visibility inside the modal.
 *
 * All renders use renderWithIntl / renderJa so the real message catalogues are
 * exercised — bare render is intentionally avoided here.
 */

import {
  renderWithIntl,
  renderJa,
  screen,
  act,
  fireEvent,
} from "@/components/test-utils/renderWithIntl";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { FirstVisitOnboardingModal } from "@/components/onboarding/FirstVisitOnboardingModal";
import { saveSettings, loadSettings, DEFAULT_ONBOARDING } from "@/lib/settings/persistence";

// AuthContext is consumed by FirstVisitOnboardingModal. Provide a minimal stub.
vi.mock("@/lib/auth/AuthContext", () => ({
  useAuth: () => ({ user: null, loading: false }),
}));

// useAppLocale is consumed by MachineTranslationBanner inside the modal.
// Default to "en" so the banner self-hides in English tests; individual tests
// that need non-English override this.
vi.mock("@/lib/i18n/useAppLocale", () => ({
  useAppLocale: vi.fn(() => "en"),
}));

import { useAppLocale } from "@/lib/i18n/useAppLocale";

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
    // Reset locale mock to English for each test.
    vi.mocked(useAppLocale).mockReturnValue("en");
  });

  afterEach(() => {
    delete (window as unknown as { localStorage?: unknown }).localStorage;
  });

  it("opens on a fresh visit (flag absent)", async () => {
    renderWithIntl(<FirstVisitOnboardingModal />);
    // After useEffect runs the modal should appear.
    expect(
      await screen.findByRole("dialog", { name: /welcome to pok[eé] memory/i }),
    ).toBeInTheDocument();
  });

  it("renders grading guidance content", async () => {
    renderWithIntl(<FirstVisitOnboardingModal />);
    await screen.findByRole("dialog", { name: /welcome to pok[eé] memory/i });
    // "Again" appears as part of the grading list item text.
    expect(screen.getAllByText(/again/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/grade honestly/i)).toBeInTheDocument();
  });

  it("closes and persists flag when the Get started button is clicked", async () => {
    const user = userEvent.setup();
    renderWithIntl(<FirstVisitOnboardingModal />);
    await screen.findByRole("dialog");

    await user.click(screen.getByRole("button", { name: /get started/i }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    const settings = loadSettings();
    expect(settings.onboarding.firstVisitOnboardingDismissed).toBe(true);
  });

  it("closes and persists flag when the X button is clicked", async () => {
    const user = userEvent.setup();
    renderWithIntl(<FirstVisitOnboardingModal />);
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

    renderWithIntl(<FirstVisitOnboardingModal />);

    // Give React time to run effects.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("calls onDismiss callback when closed", async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn();
    renderWithIntl(<FirstVisitOnboardingModal onDismiss={onDismiss} />);
    await screen.findByRole("dialog");

    await user.click(screen.getByRole("button", { name: /get started/i }));

    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("re-opens after Settings resets DEFAULT_ONBOARDING", async () => {
    const user = userEvent.setup();
    const { rerender } = renderWithIntl(<FirstVisitOnboardingModal />);
    await screen.findByRole("dialog");

    // Dismiss it.
    await user.click(screen.getByRole("button", { name: /get started/i }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    // Simulate the Settings "Show onboarding again" reset.
    act(() => {
      const current = loadSettings();
      saveSettings({ ...current, onboarding: { ...DEFAULT_ONBOARDING } });
    });

    // Re-render; the SETTINGS_SAVED_EVENT listener should pick up the change.
    rerender(<FirstVisitOnboardingModal />);

    expect(
      await screen.findByRole("dialog", { name: /welcome to pok[eé] memory/i }),
    ).toBeInTheDocument();
  });

  describe("keyboard interaction", () => {
    it("Escape key dismisses the modal and persists the flag", async () => {
      renderWithIntl(<FirstVisitOnboardingModal />);
      await screen.findByRole("dialog");

      act(() => {
        fireEvent.keyDown(document, { key: "Escape" });
      });

      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

      const settings = loadSettings();
      expect(settings.onboarding.firstVisitOnboardingDismissed).toBe(true);
    });

    it("sets scroll-lock on open and restores overflow on dismiss", async () => {
      const user = userEvent.setup();
      renderWithIntl(<FirstVisitOnboardingModal />);
      await screen.findByRole("dialog");

      expect(document.body.style.overflow).toBe("hidden");

      await user.click(screen.getByRole("button", { name: /get started/i }));

      // overflow is restored to whatever it was before open (empty string when unset).
      expect(document.body.style.overflow).not.toBe("hidden");
    });

    it("Tab cycling stays within the modal", async () => {
      const user = userEvent.setup();
      renderWithIntl(<FirstVisitOnboardingModal />);
      const dialog = await screen.findByRole("dialog");

      // Collect focusable elements inside the dialog.
      const focusable = dialog.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      expect(focusable.length).toBeGreaterThan(1);

      // Start at first element (close button receives initial focus).
      focusable[0].focus();

      // Tab through all elements; focus must stay inside the dialog.
      for (let i = 1; i < focusable.length; i++) {
        await user.tab();
        expect(dialog.contains(document.activeElement)).toBe(true);
      }

      // One more Tab from the last element wraps to the first.
      await user.tab();
      expect(document.activeElement).toBe(focusable[0]);
    });
  });

  describe("i18n: Japanese locale", () => {
    beforeEach(() => {
      vi.mocked(useAppLocale).mockReturnValue("ja");
    });

    it("renders the welcome heading in Japanese", async () => {
      renderJa(<FirstVisitOnboardingModal />);
      // The ja catalogue key onboarding.welcomeHeading is "Poké Memory へようこそ".
      expect(
        await screen.findByRole("dialog", { name: /poké memory へようこそ/i }),
      ).toBeInTheDocument();
    });

    it("renders the close button aria-label in Japanese", async () => {
      renderJa(<FirstVisitOnboardingModal />);
      await screen.findByRole("dialog");
      // ja catalogue: onboarding.closeAriaLabel = "ウェルカムガイドを閉じる"
      expect(
        screen.getByRole("button", { name: /ウェルカムガイドを閉じる/ }),
      ).toBeInTheDocument();
    });

    it("renders the Get started button in Japanese", async () => {
      renderJa(<FirstVisitOnboardingModal />);
      await screen.findByRole("dialog");
      // ja catalogue: onboarding.getStarted = "はじめる"
      expect(
        screen.getByRole("button", { name: /はじめる/ }),
      ).toBeInTheDocument();
    });
  });

  describe("MachineTranslationBanner inside modal", () => {
    it("banner is absent when locale is English", async () => {
      vi.mocked(useAppLocale).mockReturnValue("en");
      renderWithIntl(<FirstVisitOnboardingModal />, { locale: "en" });
      await screen.findByRole("dialog");
      // Banner self-hides for en locale — no role="note" element.
      expect(screen.queryByRole("note")).not.toBeInTheDocument();
    });

    it("banner is present inside the modal when locale is Japanese", async () => {
      vi.mocked(useAppLocale).mockReturnValue("ja");
      renderJa(<FirstVisitOnboardingModal />);
      await screen.findByRole("dialog");
      // After the banner's useEffect fires (dismissed === false), the note renders.
      // The dialog is the container — confirm the note is inside the DOM.
      expect(await screen.findByRole("note")).toBeInTheDocument();
    });
  });
});
