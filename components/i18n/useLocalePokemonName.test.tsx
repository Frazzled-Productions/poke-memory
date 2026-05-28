/**
 * Tests for `useLocalePokemonName` — verifies that:
 * - The hook reads `pokemonNameLocale` from settings (not the locale cookie).
 * - It updates reactively when `SETTINGS_SAVED_EVENT` fires.
 * - It falls back to English when the languages flag is off.
 * - It falls back to English for the default locale.
 *
 * Note: these tests live under `components/` so the jsdom vitest project picks
 * them up (`renderHook` requires a DOM environment).
 */

import { renderHook, waitFor, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SETTINGS_SAVED_EVENT } from "@/lib/settings/persistence";
import { useLocalePokemonName } from "@/lib/i18n/useLocalePokemonName";

// ── Mocks ────────────────────────────────────────────────────────────────────

const mockLoadLocaleNames = vi.fn<() => Promise<void>>();
const mockGetLocaleName = vi.fn<(id: number, locale: string) => string | undefined>();
const mockGetTransliteration = vi.fn<(id: number, locale: string) => string | undefined>();

vi.mock("@/lib/pokemon/localeNames", () => ({
  loadLocaleNames: () => mockLoadLocaleNames(),
  getLocaleName: (id: number, locale: string) => mockGetLocaleName(id, locale),
  getTransliteration: (id: number, locale: string) => mockGetTransliteration(id, locale),
}));

// Settings mock: controlled via `mockSettingsStore`.
let mockSettingsStore = {
  labsFlags: { languages: false },
  pokemonNameLocale: "en" as string,
};

vi.mock("@/lib/settings/persistence", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/settings/persistence")>();
  return {
    ...actual,
    loadSettings: () => ({ ...mockSettingsStore }),
  };
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function fireSettingsSaved() {
  window.dispatchEvent(new CustomEvent(SETTINGS_SAVED_EVENT));
}

// ── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  mockSettingsStore = { labsFlags: { languages: false }, pokemonNameLocale: "en" };
  mockLoadLocaleNames.mockResolvedValue(undefined);
  mockGetLocaleName.mockReturnValue(undefined);
  mockGetTransliteration.mockReturnValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("useLocalePokemonName — languages flag off", () => {
  it("returns the English name when the flag is off, regardless of pokemonNameLocale", async () => {
    mockSettingsStore = { labsFlags: { languages: false }, pokemonNameLocale: "ja" };
    const { result } = renderHook(() =>
      useLocalePokemonName(4, "Charmander"),
    );
    // Flag off → locale stays "en" → no async resolution.
    await waitFor(() => {
      expect(result.current.name).toBe("Charmander");
    });
    expect(result.current.transliteration).toBeNull();
    expect(mockLoadLocaleNames).not.toHaveBeenCalled();
  });
});

describe("useLocalePokemonName — languages flag on", () => {
  it("returns the English name immediately on first render", () => {
    mockSettingsStore = { labsFlags: { languages: true }, pokemonNameLocale: "en" };
    const { result } = renderHook(() =>
      useLocalePokemonName(4, "Charmander"),
    );
    // Synchronous initial value is always English.
    expect(result.current.name).toBe("Charmander");
  });

  it("resolves locale name from pokemonNameLocale when locale is ja", async () => {
    mockSettingsStore = { labsFlags: { languages: true }, pokemonNameLocale: "ja" };
    mockGetLocaleName.mockReturnValue("ヒトカゲ");
    mockGetTransliteration.mockReturnValue("Hitokage");

    const { result } = renderHook(() =>
      useLocalePokemonName(4, "Charmander"),
    );
    await waitFor(() => {
      expect(result.current.name).toBe("ヒトカゲ");
    });
    expect(result.current.transliteration).toBe("Hitokage");
    expect(mockGetLocaleName).toHaveBeenCalledWith(4, "ja");
  });

  it("falls back to English name when getLocaleName returns undefined", async () => {
    mockSettingsStore = { labsFlags: { languages: true }, pokemonNameLocale: "ja" };
    mockGetLocaleName.mockReturnValue(undefined);

    const { result } = renderHook(() =>
      useLocalePokemonName(4, "Charmander"),
    );
    await waitFor(() => {
      expect(mockLoadLocaleNames).toHaveBeenCalledOnce();
    });
    expect(result.current.name).toBe("Charmander");
  });

  it("returns English name with no transliteration when locale is en", async () => {
    mockSettingsStore = { labsFlags: { languages: true }, pokemonNameLocale: "en" };

    const { result } = renderHook(() =>
      useLocalePokemonName(4, "Charmander"),
    );
    // en locale short-circuits — loadLocaleNames is never called.
    expect(result.current.name).toBe("Charmander");
    expect(result.current.transliteration).toBeNull();
    expect(mockLoadLocaleNames).not.toHaveBeenCalled();
  });

  it("reads pokemonNameLocale from settings, NOT from the locale cookie", async () => {
    // The cookie (app UI locale) is "ja" — but pokemonNameLocale in settings is "en".
    // The hook should use settings, so no locale resolution should occur.
    document.cookie = "poke-memory:locale=ja";
    mockSettingsStore = { labsFlags: { languages: true }, pokemonNameLocale: "en" };

    const { result } = renderHook(() =>
      useLocalePokemonName(4, "Charmander"),
    );
    await waitFor(() => {
      expect(result.current.name).toBe("Charmander");
    });
    // If the hook were reading the cookie, it would have loaded locale names.
    expect(mockLoadLocaleNames).not.toHaveBeenCalled();
    // Clean up cookie.
    document.cookie = "poke-memory:locale=; max-age=0";
  });

  it("updates reactively when SETTINGS_SAVED_EVENT fires with a new locale", async () => {
    mockSettingsStore = { labsFlags: { languages: true }, pokemonNameLocale: "en" };
    mockGetLocaleName.mockReturnValue("ヒトカゲ");
    mockGetTransliteration.mockReturnValue("Hitokage");

    const { result } = renderHook(() =>
      useLocalePokemonName(4, "Charmander"),
    );
    // Initially English.
    expect(result.current.name).toBe("Charmander");

    // Simulate a saveSettings call that switches pokemonNameLocale to "ja".
    act(() => {
      mockSettingsStore = { labsFlags: { languages: true }, pokemonNameLocale: "ja" };
      fireSettingsSaved();
    });

    await waitFor(() => {
      expect(result.current.name).toBe("ヒトカゲ");
    });
    expect(result.current.transliteration).toBe("Hitokage");
  });
});
