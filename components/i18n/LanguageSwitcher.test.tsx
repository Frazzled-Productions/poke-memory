/**
 * LanguageSwitcher tests (#1484 - learning-language switcher).
 *
 * Covers: Labs-flag gating, the pill showing the active endonym, opening the
 * dropdown over the ENROLLED set (learningLocales), switching (writes
 * activePokemonNameLocale), the no-op when re-selecting the active locale,
 * the machine-translation note, the "Add a language" link, Escape-to-close,
 * and locale rendering.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderWithIntl, renderJa } from "@/components/test-utils/renderWithIntl";
import { LanguageSwitcher } from "./LanguageSwitcher";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockCtx = vi.fn();
vi.mock("@/lib/i18n/PokemonLocaleContext", () => ({
  usePokemonLocaleContext: () => mockCtx(),
}));

const mockSaveSettings = vi.fn();
let mockSettings: Record<string, unknown> = {
  activePokemonNameLocale: "en",
  learningLocales: ["en"],
};
vi.mock("@/lib/settings/persistence", () => ({
  loadSettings: () => mockSettings,
  saveSettings: (s: unknown) => mockSaveSettings(s),
}));

// Isolate the test from localStorage - the badge reads the due-count and
// has-history caches.
const mockReadDueCountCache = vi.fn(() => ({
  en: 0,
  ja: 0,
  "zh-Hans": 0,
  "zh-Hant": 0,
}));
const mockReadHasHistoryCache = vi.fn(() => ({
  en: false,
  ja: false,
  "zh-Hans": false,
  "zh-Hant": false,
}));
vi.mock("@/lib/profile/dueCountCache", () => ({
  readDueCountCache: () => mockReadDueCountCache(),
  readHasHistoryCache: () => mockReadHasHistoryCache(),
}));

const ALL_FOUR = ["en", "ja", "zh-Hans", "zh-Hant"];

beforeEach(() => {
  vi.clearAllMocks();
  mockCtx.mockReturnValue({
    locale: "en",
    languagesEnabled: true,
    learningLocales: ["en"],
  });
  mockSettings = { activePokemonNameLocale: "en", learningLocales: ["en"] };
  mockReadDueCountCache.mockReturnValue({ en: 0, ja: 0, "zh-Hans": 0, "zh-Hant": 0 });
  mockReadHasHistoryCache.mockReturnValue({ en: false, ja: false, "zh-Hans": false, "zh-Hant": false });
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("LanguageSwitcher", () => {
  // Note: the "renders nothing when languagesEnabled is false" test was removed
  // because the guard was dead code - languagesEnabled is always true since
  // multi-locale went GA (#1723).

  it("renders a pill showing the active locale endonym", () => {
    mockCtx.mockReturnValue({
      locale: "ja",
      languagesEnabled: true,
      learningLocales: ["en", "ja"],
    });
    renderWithIntl(<LanguageSwitcher />);
    expect(screen.getByText("日本語")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /日本語/ })).toBeInTheDocument();
  });

  it("opens a dialog listing the ENROLLED locales, the active one checked", () => {
    mockCtx.mockReturnValue({
      locale: "en",
      languagesEnabled: true,
      learningLocales: ALL_FOUR,
    });
    renderWithIntl(<LanguageSwitcher />);
    fireEvent.click(screen.getByRole("button", { name: /Pokémon name language/i }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getAllByRole("radio")).toHaveLength(4);
    expect(screen.getByRole("radio", { checked: true })).toHaveAccessibleName(
      /English/i,
    );
  });

  it("only lists the enrolled locales (single-language user sees just English)", () => {
    // Default mock: learningLocales = ["en"].
    renderWithIntl(<LanguageSwitcher />);
    fireEvent.click(screen.getByRole("button", { name: /Pokémon name language/i }));
    expect(screen.getAllByRole("radio")).toHaveLength(1);
  });

  it("switching writes the new activePokemonNameLocale via saveSettings", () => {
    mockCtx.mockReturnValue({
      locale: "en",
      languagesEnabled: true,
      learningLocales: ["en", "ja"],
    });
    renderWithIntl(<LanguageSwitcher />);
    fireEvent.click(screen.getByRole("button", { name: /Pokémon name language/i }));
    fireEvent.click(screen.getByRole("radio", { name: /日本語/ }));
    expect(mockSaveSettings).toHaveBeenCalledWith(
      expect.objectContaining({ activePokemonNameLocale: "ja" }),
    );
  });

  it("does not save when re-selecting the active locale", () => {
    renderWithIntl(<LanguageSwitcher />);
    fireEvent.click(screen.getByRole("button", { name: /Pokémon name language/i }));
    fireEvent.click(screen.getByRole("radio", { name: /English/ }));
    expect(mockSaveSettings).not.toHaveBeenCalled();
  });

  it("shows a machine-translation note on enrolled non-English locales", () => {
    mockCtx.mockReturnValue({
      locale: "en",
      languagesEnabled: true,
      learningLocales: ALL_FOUR,
    });
    renderWithIntl(<LanguageSwitcher />);
    fireEvent.click(screen.getByRole("button", { name: /Pokémon name language/i }));
    expect(
      screen.getAllByText(/machine translation/i).length,
    ).toBeGreaterThanOrEqual(3);
  });

  it("offers an 'Add a language' link to the Settings enrolment section", () => {
    renderWithIntl(<LanguageSwitcher />);
    fireEvent.click(screen.getByRole("button", { name: /Pokémon name language/i }));
    const link = screen.getByRole("link", { name: /add a language/i });
    expect(link).toHaveAttribute("href", "/settings#language-heading");
  });

  it("closes on Escape", () => {
    renderWithIntl(<LanguageSwitcher />);
    fireEvent.click(screen.getByRole("button", { name: /Pokémon name language/i }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("LanguageSwitcher - locale rendering", () => {
  it("ja: the dropdown heading renders in Japanese", () => {
    mockCtx.mockReturnValue({
      locale: "ja",
      languagesEnabled: true,
      learningLocales: ["en", "ja"],
    });
    renderJa(<LanguageSwitcher />);
    fireEvent.click(screen.getByRole("button"));
    expect(
      screen.getByRole("heading", { name: /名前の言語/ }),
    ).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Item 4: "No cards yet" vs "Caught up" due badge distinction
// ---------------------------------------------------------------------------

describe("LanguageSwitcher - due badge states", () => {
  beforeEach(() => {
    mockCtx.mockReturnValue({
      locale: "en",
      languagesEnabled: true,
      learningLocales: ["en", "ja"],
    });
    // Both locales at 0 due by default (set per-test for history).
    mockReadDueCountCache.mockReturnValue({ en: 0, ja: 0, "zh-Hans": 0, "zh-Hant": 0 });
  });

  it("shows 'No cards yet' for a locale with count=0 and no review history", () => {
    // No history for ja (freshly enrolled).
    mockReadHasHistoryCache.mockReturnValue({
      en: true, // en has history
      ja: false, // ja is freshly enrolled
      "zh-Hans": false,
      "zh-Hant": false,
    });
    renderWithIntl(<LanguageSwitcher />);
    fireEvent.click(screen.getByRole("button", { name: /Pokémon name language/i }));
    // ja row should show "No cards yet", NOT "Caught up".
    expect(screen.getByText(/no cards yet/i)).toBeInTheDocument();
    // en row with history + 0 due = "Caught up".
    expect(screen.getByText(/caught up/i)).toBeInTheDocument();
  });

  it("shows 'Caught up' for a locale with count=0 and existing review history", () => {
    // Both locales have history (all reviews done).
    mockReadHasHistoryCache.mockReturnValue({
      en: true,
      ja: true,
      "zh-Hans": false,
      "zh-Hant": false,
    });
    renderWithIntl(<LanguageSwitcher />);
    fireEvent.click(screen.getByRole("button", { name: /Pokémon name language/i }));
    // Both enrolled locales have history - both should show "Caught up".
    const caughtUp = screen.getAllByText(/caught up/i);
    expect(caughtUp.length).toBeGreaterThanOrEqual(2);
    // "No cards yet" must NOT appear.
    expect(screen.queryByText(/no cards yet/i)).toBeNull();
  });

  it("shows the count badge (not Caught up / No cards yet) when count > 0", () => {
    mockReadDueCountCache.mockReturnValue({ en: 0, ja: 3, "zh-Hans": 0, "zh-Hant": 0 });
    mockReadHasHistoryCache.mockReturnValue({
      en: false,
      ja: true,
      "zh-Hans": false,
      "zh-Hant": false,
    });
    renderWithIntl(<LanguageSwitcher />);
    fireEvent.click(screen.getByRole("button", { name: /Pokémon name language/i }));
    // ja has 3 due - should show count text, not "Caught up" or "No cards yet".
    expect(screen.getByText(/3 due today/i)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Phase 2: mid-card lock tests (#1562)
// ---------------------------------------------------------------------------

const mockIsCardRevealed = vi.hoisted(() => vi.fn(() => false));
vi.mock("@/lib/review/sessionActive", () => ({
  isCardRevealed: mockIsCardRevealed,
}));

describe("LanguageSwitcher - mid-card lock (#1562)", () => {
  beforeEach(() => {
    mockIsCardRevealed.mockReturnValue(false);
    mockCtx.mockReturnValue({
      locale: "en",
      languagesEnabled: true,
      learningLocales: ["en", "ja"],
    });
  });

  it("shows lock message and disables non-active radios when a card is revealed", () => {
    mockIsCardRevealed.mockReturnValue(true);
    renderWithIntl(<LanguageSwitcher />);
    fireEvent.click(screen.getByRole("button", { name: /Pokémon name language/i }));

    // Lock message is shown.
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(/finish this card first/i);

    // The non-active (ja) radio is visually disabled.
    const jaRadio = screen.getByRole("radio", { name: /日本語/ });
    expect(jaRadio).toHaveAttribute("aria-disabled", "true");
  });

  it("does NOT switch locale when card is revealed and non-active radio is clicked", () => {
    mockIsCardRevealed.mockReturnValue(true);
    renderWithIntl(<LanguageSwitcher />);
    fireEvent.click(screen.getByRole("button", { name: /Pokémon name language/i }));
    fireEvent.click(screen.getByRole("radio", { name: /日本語/ }));
    // saveSettings must not be called.
    expect(mockSaveSettings).not.toHaveBeenCalled();
  });

  it("allows switching when no card is revealed", () => {
    mockIsCardRevealed.mockReturnValue(false);
    renderWithIntl(<LanguageSwitcher />);
    fireEvent.click(screen.getByRole("button", { name: /Pokémon name language/i }));
    fireEvent.click(screen.getByRole("radio", { name: /日本語/ }));
    expect(mockSaveSettings).toHaveBeenCalledWith(
      expect.objectContaining({ activePokemonNameLocale: "ja" }),
    );
  });

  it("grade keys are blocked when the language panel is open (role=dialog present)", () => {
    // When the panel is open there is a [role=dialog] in the document.
    // ReviewSession checks document.querySelector('[role="dialog"]') before
    // firing grade keys. Simulated here at the unit level: the LanguageSwitcher
    // dialog opening is all we need to verify the guard condition.
    renderWithIntl(<LanguageSwitcher />);
    fireEvent.click(screen.getByRole("button", { name: /Pokémon name language/i }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeInTheDocument();
    // The keydown handler on the panel calls stopPropagation, preventing
    // grade keys from firing. Test that a keydown event on the document
    // has stopPropagation called by the panel listener.
    const stopPropSpy = vi.spyOn(KeyboardEvent.prototype, "stopPropagation");
    fireEvent.keyDown(document, { key: "4" });
    expect(stopPropSpy).toHaveBeenCalled();
    stopPropSpy.mockRestore();
  });
});
