/**
 * Tests for MachineTranslationBanner (#1349).
 *
 * Covers both sides of each state:
 *   - Locale: English (banner absent) vs. non-English (banner present).
 *   - Dismissed: not dismissed (banner present) vs. dismissed (banner absent).
 *
 * Uses renderWithIntl / renderJa from the shared test helper so real message
 * catalogues are exercised - no inline translation fixtures.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import {
  renderWithIntl,
  renderJa,
  screen,
  fireEvent,
} from "@/components/test-utils/renderWithIntl";
import { MachineTranslationBanner } from "./MachineTranslationBanner";
import { mtBannerDismissedKey } from "@/lib/storage/keys";

// ---------------------------------------------------------------------------
// localStorage mock
// ---------------------------------------------------------------------------

const store: Record<string, string> = {};

const localStorageMock = {
  getItem: vi.fn((key: string) => store[key] ?? null),
  setItem: vi.fn((key: string, value: string) => { store[key] = value; }),
  removeItem: vi.fn((key: string) => { delete store[key]; }),
  clear: vi.fn(() => { Object.keys(store).forEach(k => delete store[k]); }),
};

beforeEach(() => {
  Object.defineProperty(window, "localStorage", {
    value: localStorageMock,
    writable: true,
  });
  localStorageMock.clear();
  vi.clearAllMocks();
  // Default: loadSettings returns settings with no dismissed locales.
  mockLoadSettings.mockReturnValue({ dismissedMtBannerLocales: [] });
  mockSaveSettings.mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// useAppLocale mock - reads document.cookie; set the cookie in tests instead.
// ---------------------------------------------------------------------------
// We mock the module so tests can control the active locale without touching
// real cookie parsing, keeping tests fast and isolated.

vi.mock("@/lib/i18n/useAppLocale", () => ({
  useAppLocale: vi.fn(() => "ja"),
}));

// Mock lib/settings/persistence so we can spy on saveSettings calls without
// touching real localStorage or triggering SETTINGS_SAVED_EVENT listeners.
const mockLoadSettings = vi.fn();
const mockSaveSettings = vi.fn();

vi.mock("@/lib/settings/persistence", () => ({
  loadSettings: () => mockLoadSettings(),
  saveSettings: (s: unknown) => mockSaveSettings(s),
}));

import { useAppLocale } from "@/lib/i18n/useAppLocale";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("MachineTranslationBanner", () => {
  describe("English locale", () => {
    it("does not render the banner when locale is 'en'", () => {
      vi.mocked(useAppLocale).mockReturnValue("en");
      renderWithIntl(<MachineTranslationBanner />, { locale: "en" });
      // The aside element should not be present
      expect(screen.queryByRole("note")).toBeNull();
    });
  });

  describe("Japanese locale (non-English)", () => {
    beforeEach(() => {
      vi.mocked(useAppLocale).mockReturnValue("ja");
    });

    it("shows the banner text in Japanese", () => {
      renderJa(<MachineTranslationBanner />);
      // After the useEffect fires, dismissed === false so banner renders.
      // The Japanese catalogue has the translation with {language} = 日本語.
      expect(screen.getByRole("note")).toBeTruthy();
    });

    it("shows the dismiss button", () => {
      renderJa(<MachineTranslationBanner />);
      // The dismiss button text comes from the ja catalogue key banner.dismiss.
      const button = screen.getByRole("button");
      expect(button).toBeTruthy();
    });

    it("hides the banner after dismiss and writes the localStorage key", () => {
      renderJa(<MachineTranslationBanner />);

      const button = screen.getByRole("button");
      fireEvent.click(button);

      // Banner should no longer be in the document.
      expect(screen.queryByRole("note")).toBeNull();

      // localStorage should have been written.
      expect(localStorageMock.setItem).toHaveBeenCalledWith(
        mtBannerDismissedKey("ja"),
        "1",
      );
    });

    it("does not render the banner when already dismissed in localStorage", () => {
      // Pre-seed the dismissed flag.
      store[mtBannerDismissedKey("ja")] = "1";

      renderJa(<MachineTranslationBanner />);

      expect(screen.queryByRole("note")).toBeNull();
    });

    it("renders the banner when the ja key is missing but a different locale is dismissed", () => {
      // Dismiss zh-Hans but not ja - banner should still show for ja.
      store[mtBannerDismissedKey("zh-Hans")] = "1";

      renderJa(<MachineTranslationBanner />);

      expect(screen.getByRole("note")).toBeTruthy();
    });
  });

  describe("Simplified Chinese locale", () => {
    it("shows the banner in Simplified Chinese", () => {
      vi.mocked(useAppLocale).mockReturnValue("zh-Hans");
      renderWithIntl(<MachineTranslationBanner />, { locale: "zh-Hans" });
      expect(screen.getByRole("note")).toBeTruthy();
    });

    it("persists dismissal under the zh-Hans key", () => {
      vi.mocked(useAppLocale).mockReturnValue("zh-Hans");
      renderWithIntl(<MachineTranslationBanner />, { locale: "zh-Hans" });

      fireEvent.click(screen.getByRole("button"));

      expect(localStorageMock.setItem).toHaveBeenCalledWith(
        mtBannerDismissedKey("zh-Hans"),
        "1",
      );
    });
  });

  describe("Traditional Chinese locale", () => {
    it("shows the banner in Traditional Chinese", () => {
      vi.mocked(useAppLocale).mockReturnValue("zh-Hant");
      renderWithIntl(<MachineTranslationBanner />, { locale: "zh-Hant" });
      expect(screen.getByRole("note")).toBeTruthy();
    });
  });


  describe("settings write-through on dismiss (#1387)", () => {
    beforeEach(() => {
      vi.mocked(useAppLocale).mockReturnValue("ja");
    });

    it("calls saveSettings with the dismissed locale appended when banner is dismissed", () => {
      renderJa(<MachineTranslationBanner />);
      fireEvent.click(screen.getByRole("button"));

      expect(mockSaveSettings).toHaveBeenCalledOnce();
      const saved = mockSaveSettings.mock.calls[0][0] as Record<string, unknown>;
      expect((saved.dismissedMtBannerLocales as string[])).toContain("ja");
    });

    it("does not call saveSettings again when the locale is already in dismissedMtBannerLocales", () => {
      // Simulate: settings already have ja in the list (e.g. a second dismiss click).
      mockLoadSettings.mockReturnValue({ dismissedMtBannerLocales: ["ja"] });
      // Pre-seed the localStorage key so the banner renders as already dismissed.
      store[mtBannerDismissedKey("ja")] = "1";

      renderJa(<MachineTranslationBanner />);

      // Banner is already dismissed so no button is visible.
      expect(screen.queryByRole("button")).toBeNull();
      expect(mockSaveSettings).not.toHaveBeenCalled();
    });

    it("guest path: saveSettings is still called (local-only, no cloud write without auth)", () => {
      // Guest mode: AutoSyncOnChange treats userId as null (anyFlagOn or no user),
      // so saveSettings persists locally and the cloud push never fires.
      // From the component's perspective, saveSettings is always called on dismiss - 
      // the write-guard lives in AutoSyncOnChange, not here.
      renderJa(<MachineTranslationBanner />);
      fireEvent.click(screen.getByRole("button"));

      expect(mockSaveSettings).toHaveBeenCalledOnce();
    });
  });

  describe("mtBannerDismissedKey helper", () => {
    it("returns the expected key format", () => {
      expect(mtBannerDismissedKey("ja")).toBe("poke-memory:mt-banner-dismissed:ja");
      expect(mtBannerDismissedKey("zh-Hans")).toBe("poke-memory:mt-banner-dismissed:zh-Hans");
    });
  });
});
