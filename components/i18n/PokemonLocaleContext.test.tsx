/**
 * Tests for `PokemonLocaleProvider` / `usePokemonLocaleContext` (#1329).
 *
 * Covers the subscription wiring:
 * - Reads the initial locale + learningLocales from settings on mount.
 * - Updates when `SETTINGS_SAVED_EVENT` fires (same-tab saves).
 * - Updates when a `storage` event fires (other-tab writes).
 * - `languagesEnabled` is always true (multi-locale GA since #1723).
 * - Registers exactly one pair of listeners regardless of consumer count.
 */

import { act, render, renderHook, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  PokemonLocaleProvider,
  usePokemonLocaleContext,
} from "@/lib/i18n/PokemonLocaleContext";
import { SETTINGS_SAVED_EVENT } from "@/lib/settings/persistence";

// Settings mock - controlled per-test via `mockSettingsStore`. learningLocales
// is optional so tests can omit it to exercise the back-compat (pre-#1484)
// path, where readLocaleState falls back to the default set.
let mockSettingsStore: {
  pokemonNameLocale: string;
  learningLocales?: string[];
} = {
  pokemonNameLocale: "en",
  learningLocales: ["en"],
};

vi.mock("@/lib/settings/persistence", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/settings/persistence")>();
  return {
    ...actual,
    loadSettings: () => ({ ...mockSettingsStore }),
  };
});

function wrapper({ children }: { children: React.ReactNode }) {
  return <PokemonLocaleProvider>{children}</PokemonLocaleProvider>;
}

beforeEach(() => {
  mockSettingsStore = {
    pokemonNameLocale: "en",
    learningLocales: ["en"],
  };
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("PokemonLocaleProvider - initial state", () => {
  it("reads locale ja from settings on mount (languagesEnabled is always true)", async () => {
    // Multi-locale is GA - the locale is read from settings regardless of any flag.
    mockSettingsStore = {
      pokemonNameLocale: "ja",
      learningLocales: ["en", "ja"],
    };
    const { result } = renderHook(() => usePokemonLocaleContext(), { wrapper });
    await waitFor(() => {
      expect(result.current).toEqual({
        locale: "ja",
        languagesEnabled: true,
        learningLocales: ["en", "ja"],
      });
    });
  });

  it("defaults locale to en when pokemonNameLocale is unset", async () => {
    mockSettingsStore = {
      // @ts-expect-error simulating missing field
      pokemonNameLocale: undefined,
      learningLocales: ["en"],
    };
    const { result } = renderHook(() => usePokemonLocaleContext(), { wrapper });
    await waitFor(() => {
      expect(result.current).toEqual({
        locale: "en",
        languagesEnabled: true,
        learningLocales: ["en"],
      });
    });
  });

  it("exposes the full enrolled learningLocales set", async () => {
    mockSettingsStore = {
      pokemonNameLocale: "zh-Hans",
      learningLocales: ["en", "ja", "zh-Hans"],
    };
    const { result } = renderHook(() => usePokemonLocaleContext(), { wrapper });
    await waitFor(() => {
      expect(result.current.learningLocales).toEqual(["en", "ja", "zh-Hans"]);
    });
  });

  it("languagesEnabled is always true (multi-locale GA since #1723)", async () => {
    // Regardless of what's in settings, languagesEnabled is always true.
    mockSettingsStore = {
      pokemonNameLocale: "en",
      learningLocales: ["en"],
    };
    const { result } = renderHook(() => usePokemonLocaleContext(), { wrapper });
    await waitFor(() => {
      expect(result.current.languagesEnabled).toBe(true);
    });
  });
});

describe("PokemonLocaleProvider - reactive updates", () => {
  it("updates when SETTINGS_SAVED_EVENT fires (same-tab save)", async () => {
    mockSettingsStore = { pokemonNameLocale: "en" };
    const { result } = renderHook(() => usePokemonLocaleContext(), { wrapper });
    await waitFor(() => {
      expect(result.current.locale).toBe("en");
    });

    act(() => {
      mockSettingsStore = { pokemonNameLocale: "ja" };
      window.dispatchEvent(new CustomEvent(SETTINGS_SAVED_EVENT));
    });

    await waitFor(() => {
      expect(result.current.locale).toBe("ja");
    });
  });

  it("updates when a storage event fires (other-tab write)", async () => {
    mockSettingsStore = { pokemonNameLocale: "en" };
    const { result } = renderHook(() => usePokemonLocaleContext(), { wrapper });
    await waitFor(() => {
      expect(result.current.locale).toBe("en");
    });

    act(() => {
      mockSettingsStore = { pokemonNameLocale: "zh-Hans" };
      window.dispatchEvent(new StorageEvent("storage"));
    });

    await waitFor(() => {
      expect(result.current.locale).toBe("zh-Hans");
    });
  });

  it("updates learningLocales when settings change", async () => {
    mockSettingsStore = {
      pokemonNameLocale: "ja",
      learningLocales: ["en", "ja"],
    };
    const { result } = renderHook(() => usePokemonLocaleContext(), { wrapper });
    await waitFor(() => {
      expect(result.current).toEqual({
        locale: "ja",
        languagesEnabled: true,
        learningLocales: ["en", "ja"],
      });
    });

    act(() => {
      mockSettingsStore = {
        pokemonNameLocale: "ja",
        learningLocales: ["en", "ja", "zh-Hans"],
      };
      window.dispatchEvent(new CustomEvent(SETTINGS_SAVED_EVENT));
    });

    await waitFor(() => {
      expect(result.current.learningLocales).toEqual(["en", "ja", "zh-Hans"]);
    });
  });

  it("reads pokemonNameLocale from settings, NOT from the locale cookie", async () => {
    // The cookie (app UI locale) is independent of pokemonNameLocale - they
    // can disagree (UI in English while practising names in Japanese, or vice
    // versa). The Provider must read from settings only.
    document.cookie = "poke-memory:locale=ja";
    mockSettingsStore = {
      pokemonNameLocale: "en",
      learningLocales: ["en"],
    };

    const { result } = renderHook(() => usePokemonLocaleContext(), { wrapper });
    await waitFor(() => {
      expect(result.current).toEqual({
        locale: "en",
        languagesEnabled: true,
        learningLocales: ["en"],
      });
    });

    document.cookie = "poke-memory:locale=; max-age=0";
  });
});

describe("PokemonLocaleProvider - single subscription regardless of consumer count", () => {
  it("registers exactly one SETTINGS_SAVED_EVENT and one storage listener for N consumers", async () => {
    mockSettingsStore = { pokemonNameLocale: "en" };
    const addSpy = vi.spyOn(window, "addEventListener");

    function Consumer() {
      usePokemonLocaleContext();
      return null;
    }

    render(
      <PokemonLocaleProvider>
        <Consumer />
        <Consumer />
        <Consumer />
        <Consumer />
        <Consumer />
      </PokemonLocaleProvider>,
    );

    // Wait explicitly for the effect-scheduled listeners. Without waitFor the
    // assertion would race React's effect flush - false-passing if effects
    // ever moved to a later phase. With waitFor it false-fails (preferable)
    // if a future regression makes listener registration consumer-driven.
    await waitFor(() => {
      const settingsListenerCount = addSpy.mock.calls.filter(
        ([type]) => type === SETTINGS_SAVED_EVENT,
      ).length;
      const storageListenerCount = addSpy.mock.calls.filter(
        ([type]) => type === "storage",
      ).length;
      expect(settingsListenerCount).toBe(1);
      expect(storageListenerCount).toBe(1);
    });
  });
});
