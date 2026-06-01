/**
 * LanguageSwitcher tests (#1484 — learning-language switcher).
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

// Isolate the test from localStorage — the badge reads the due-count cache.
vi.mock("@/lib/profile/dueCountCache", () => ({
  readDueCountCache: () => ({ en: 0, ja: 0, "zh-Hans": 0, "zh-Hant": 0 }),
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
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("LanguageSwitcher", () => {
  it("renders nothing when the languages Labs flag is off", () => {
    mockCtx.mockReturnValue({
      locale: "en",
      languagesEnabled: false,
      learningLocales: ["en"],
    });
    const { container } = renderWithIntl(<LanguageSwitcher />);
    expect(container).toBeEmptyDOMElement();
  });

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
    expect(link).toHaveAttribute("href", "/settings#languages-learning");
  });

  it("closes on Escape", () => {
    renderWithIntl(<LanguageSwitcher />);
    fireEvent.click(screen.getByRole("button", { name: /Pokémon name language/i }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("LanguageSwitcher — locale rendering", () => {
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
