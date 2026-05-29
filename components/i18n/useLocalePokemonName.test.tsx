/**
 * Tests for `useLocalePokemonName` — verifies that:
 * - The hook reads the locale from `PokemonLocaleContext`, not directly from settings.
 * - It resolves the locale-appropriate name when the context locale is non-en.
 * - It falls back to English when the locale is "en" or when the sidecar misses.
 *
 * The context subscription wiring (event listeners, settings reads, single
 * subscription per tree) is tested separately in PokemonLocaleContext.test.tsx.
 *
 * Note: these tests live under `components/` so the jsdom vitest project picks
 * them up (`renderHook` requires a DOM environment).
 */

import { renderHook, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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

// Context mock: controlled via `mockContextValue`. The hook now reads from
// context; these tests verify the hook's logic given a context value, not the
// subscription wiring.
let mockContextValue = { locale: "en" as string, languagesEnabled: false };

vi.mock("@/lib/i18n/PokemonLocaleContext", () => ({
  usePokemonLocaleContext: () => ({ ...mockContextValue }),
}));

function setContext(locale: string, languagesEnabled: boolean) {
  mockContextValue = { locale, languagesEnabled };
}

// ── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  setContext("en", false);
  mockLoadLocaleNames.mockResolvedValue(undefined);
  mockGetLocaleName.mockReturnValue(undefined);
  mockGetTransliteration.mockReturnValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("useLocalePokemonName — locale en (flag off or default)", () => {
  it("returns the English name when locale is en, regardless of flag state", async () => {
    setContext("en", false);
    const { result } = renderHook(() => useLocalePokemonName(4, "Charmander"));
    await waitFor(() => {
      expect(result.current.name).toBe("Charmander");
    });
    expect(result.current.transliteration).toBeNull();
    expect(mockLoadLocaleNames).not.toHaveBeenCalled();
  });
});

describe("useLocalePokemonName — non-en locale", () => {
  it("returns the English name immediately on first render", () => {
    setContext("ja", true);
    const { result } = renderHook(() => useLocalePokemonName(4, "Charmander"));
    // Synchronous initial value is always English.
    expect(result.current.name).toBe("Charmander");
  });

  it("resolves locale name from context when locale is ja", async () => {
    setContext("ja", true);
    mockGetLocaleName.mockReturnValue("ヒトカゲ");
    mockGetTransliteration.mockReturnValue("Hitokage");

    const { result } = renderHook(() => useLocalePokemonName(4, "Charmander"));
    await waitFor(() => {
      expect(result.current.name).toBe("ヒトカゲ");
    });
    expect(result.current.transliteration).toBe("Hitokage");
    expect(mockGetLocaleName).toHaveBeenCalledWith(4, "ja");
  });

  it("falls back to English name when getLocaleName returns undefined", async () => {
    setContext("ja", true);
    mockGetLocaleName.mockReturnValue(undefined);

    const { result } = renderHook(() => useLocalePokemonName(4, "Charmander"));
    await waitFor(() => {
      expect(mockLoadLocaleNames).toHaveBeenCalledOnce();
    });
    expect(result.current.name).toBe("Charmander");
  });

  it("returns English name with no transliteration when locale is en even with flag on", async () => {
    setContext("en", true);
    const { result } = renderHook(() => useLocalePokemonName(4, "Charmander"));
    // en locale short-circuits — loadLocaleNames is never called.
    expect(result.current.name).toBe("Charmander");
    expect(result.current.transliteration).toBeNull();
    expect(mockLoadLocaleNames).not.toHaveBeenCalled();
  });

  it("returns English name when speciesId is undefined", async () => {
    setContext("ja", true);
    const { result } = renderHook(() => useLocalePokemonName(undefined, "Charmander"));
    await waitFor(() => {
      expect(result.current.name).toBe("Charmander");
    });
    expect(result.current.transliteration).toBeNull();
    expect(mockLoadLocaleNames).not.toHaveBeenCalled();
  });
});
