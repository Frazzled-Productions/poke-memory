/**
 * LanguageSwitcher tests (Phase 2 — learning-language switcher).
 *
 * Covers: Labs-flag gating (renders nothing when off), the pill showing the
 * active endonym, opening the sheet, the radio options + machine-translation
 * note, switching (writes pokemonNameLocale), the no-op when re-selecting the
 * current locale, Escape-to-close, and locale rendering.
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
let mockSettings: Record<string, unknown> = { pokemonNameLocale: "en" };
vi.mock("@/lib/settings/persistence", () => ({
  loadSettings: () => mockSettings,
  saveSettings: (s: unknown) => mockSaveSettings(s),
}));

beforeEach(() => {
  // Clear call history between tests — saveSettings is a module-level vi.fn,
  // and restoreAllMocks does not reset its recorded calls.
  vi.clearAllMocks();
  mockCtx.mockReturnValue({ locale: "en", languagesEnabled: true });
  mockSettings = { pokemonNameLocale: "en" };
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("LanguageSwitcher", () => {
  it("renders nothing when the languages Labs flag is off", () => {
    mockCtx.mockReturnValue({ locale: "en", languagesEnabled: false });
    const { container } = renderWithIntl(<LanguageSwitcher />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders a pill showing the active locale endonym", () => {
    mockCtx.mockReturnValue({ locale: "ja", languagesEnabled: true });
    renderWithIntl(<LanguageSwitcher />);
    // Native-script endonym is visible; the pill's accessible name names it.
    expect(screen.getByText("日本語")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /日本語/ })).toBeInTheDocument();
  });

  it("opens a dialog with the four locale options, the active one checked", () => {
    renderWithIntl(<LanguageSwitcher />);
    fireEvent.click(screen.getByRole("button", { name: /English/ }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getAllByRole("radio")).toHaveLength(4);
    expect(screen.getByRole("radio", { checked: true })).toHaveAccessibleName(
      /English/i,
    );
  });

  it("switching writes the new pokemonNameLocale via saveSettings", () => {
    renderWithIntl(<LanguageSwitcher />);
    fireEvent.click(screen.getByRole("button", { name: /English/ }));
    fireEvent.click(screen.getByRole("radio", { name: /日本語/ }));
    expect(mockSaveSettings).toHaveBeenCalledWith(
      expect.objectContaining({ pokemonNameLocale: "ja" }),
    );
  });

  it("does not save when re-selecting the current locale", () => {
    renderWithIntl(<LanguageSwitcher />);
    fireEvent.click(screen.getByRole("button", { name: /English/ }));
    fireEvent.click(screen.getByRole("radio", { name: /English/ }));
    expect(mockSaveSettings).not.toHaveBeenCalled();
  });

  it("shows a machine-translation note on the non-English options", () => {
    renderWithIntl(<LanguageSwitcher />);
    fireEvent.click(screen.getByRole("button", { name: /English/ }));
    // ja + zh-Hans + zh-Hant each carry the note.
    expect(
      screen.getAllByText(/machine translation/i).length,
    ).toBeGreaterThanOrEqual(3);
  });

  it("closes on Escape", () => {
    renderWithIntl(<LanguageSwitcher />);
    fireEvent.click(screen.getByRole("button", { name: /English/ }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("LanguageSwitcher — locale rendering", () => {
  it("ja: the sheet heading renders in Japanese", () => {
    mockCtx.mockReturnValue({ locale: "ja", languagesEnabled: true });
    renderJa(<LanguageSwitcher />);
    fireEvent.click(screen.getByRole("button"));
    expect(
      screen.getByRole("heading", { name: /名前の言語/ }),
    ).toBeInTheDocument();
  });
});
