/**
 * Tests for `PokemonLocaleProvider` / `usePokemonLocaleContext` (#1329).
 *
 * Covers the subscription wiring that used to live in `useLocalePokemonName`:
 * - Reads the initial locale + flag state from settings on mount.
 * - Updates when `SETTINGS_SAVED_EVENT` fires (same-tab saves).
 * - Updates when a `storage` event fires (other-tab writes).
 * - Forces locale to en when the languages Labs flag is off, regardless of
 *   `pokemonNameLocale` value.
 * - Registers exactly one pair of listeners regardless of consumer count.
 */

import { act, render, renderHook, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  PokemonLocaleProvider,
  usePokemonLocaleContext,
} from "@/lib/i18n/PokemonLocaleContext";
import { SETTINGS_SAVED_EVENT } from "@/lib/settings/persistence";

// Settings mock — controlled per-test via `mockSettingsStore`.
let mockSettingsStore = {
  labsFlags: { languages: false } as Record<string, boolean>,
  pokemonNameLocale: "en" as string,
  learningLocales: ["en"] as string[],
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
    labsFlags: { languages: false },
    pokemonNameLocale: "en",
    learningLocales: ["en"],
  };
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("PokemonLocaleProvider — initial state", () => {
  it("reads locale en + flag false from settings on mount", async () => {
    mockSettingsStore = {
      labsFlags: { languages: false },
      pokemonNameLocale: "ja",
      learningLocales: ["en", "ja"],
    };
    const { result } = renderHook(() => usePokemonLocaleContext(), { wrapper });
    await waitFor(() => {
      // Flag off forces locale to en regardless of stored pokemonNameLocale, and
      // collapses learningLocales to the default set.
      expect(result.current).toEqual({
        locale: "en",
        languagesEnabled: false,
        learningLocales: ["en"],
      });
    });
  });

  it("reads locale ja + flag true from settings when flag is on", async () => {
    mockSettingsStore = {
      labsFlags: { languages: true },
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

  it("defaults locale to en when flag is on but pokemonNameLocale is unset", async () => {
    mockSettingsStore = {
      labsFlags: { languages: true },
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

  it("exposes the full enrolled learningLocales set when the flag is on", async () => {
    mockSettingsStore = {
      labsFlags: { languages: true },
      pokemonNameLocale: "zh-Hans",
      learningLocales: ["en", "ja", "zh-Hans"],
    };
    const { result } = renderHook(() => usePokemonLocaleContext(), { wrapper });
    await waitFor(() => {
      expect(result.current.learningLocales).toEqual(["en", "ja", "zh-Hans"]);
    });
  });
});

describe("PokemonLocaleProvider — reactive updates", () => {
  it("updates when SETTINGS_SAVED_EVENT fires (same-tab save)", async () => {
    mockSettingsStore = { labsFlags: { languages: true }, pokemonNameLocale: "en" };
    const { result } = renderHook(() => usePokemonLocaleContext(), { wrapper });
    await waitFor(() => {
      expect(result.current.locale).toBe("en");
    });

    act(() => {
      mockSettingsStore = { labsFlags: { languages: true }, pokemonNameLocale: "ja" };
      window.dispatchEvent(new CustomEvent(SETTINGS_SAVED_EVENT));
    });

    await waitFor(() => {
      expect(result.current.locale).toBe("ja");
    });
  });

  it("updates when a storage event fires (other-tab write)", async () => {
    mockSettingsStore = { labsFlags: { languages: true }, pokemonNameLocale: "en" };
    const { result } = renderHook(() => usePokemonLocaleContext(), { wrapper });
    await waitFor(() => {
      expect(result.current.locale).toBe("en");
    });

    act(() => {
      mockSettingsStore = { labsFlags: { languages: true }, pokemonNameLocale: "zh-Hans" };
      window.dispatchEvent(new StorageEvent("storage"));
    });

    await waitFor(() => {
      expect(result.current.locale).toBe("zh-Hans");
    });
  });

  it("flips back to en when the flag is turned off, regardless of stored locale", async () => {
    mockSettingsStore = {
      labsFlags: { languages: true },
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
        labsFlags: { languages: false },
        pokemonNameLocale: "ja",
        learningLocales: ["en", "ja"],
      };
      window.dispatchEvent(new CustomEvent(SETTINGS_SAVED_EVENT));
    });

    await waitFor(() => {
      expect(result.current).toEqual({
        locale: "en",
        languagesEnabled: false,
        learningLocales: ["en"],
      });
    });
  });

  it("reads pokemonNameLocale from settings, NOT from the locale cookie", async () => {
    // The cookie (app UI locale) is independent of pokemonNameLocale — they
    // can disagree (UI in English while practising names in Japanese, or vice
    // versa). The Provider must read from settings only.
    document.cookie = "poke-memory:locale=ja";
    mockSettingsStore = {
      labsFlags: { languages: true },
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

describe("PokemonLocaleProvider — single subscription regardless of consumer count", () => {
  it("registers exactly one SETTINGS_SAVED_EVENT and one storage listener for N consumers", async () => {
    mockSettingsStore = { labsFlags: { languages: true }, pokemonNameLocale: "en" };
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
    // assertion would race React's effect flush — false-passing if effects
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
