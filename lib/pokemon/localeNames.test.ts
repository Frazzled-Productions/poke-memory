// lib/pokemon/localeNames.test.ts
// Unit tests for the locale-names sidecar module.
//
// Runs in the `node` vitest project (no DOM).

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  loadLocaleNames,
  getLocaleName,
  getTransliteration,
  getLocaleNamesSnapshot,
  _resetLocaleNamesCache,
} from "./localeNames";
import type { PokemonLocaleNames } from "./seed";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const BULBASAUR: PokemonLocaleNames = {
  speciesId: 1,
  nameByLocale: {
    en: "Bulbasaur",
    ja: "フシギダネ",
    "zh-Hans": "妙蛙种子",
    "zh-Hant": "妙蛙種子",
  },
  transliterationByLocale: {
    ja: "Fushigidane",
    // 妙蛙种子 (Simplified): 子 is neutral tone in compound → "zi" not "zǐ"
    "zh-Hans": "miào wā zhǒng zi",
    // 妙蛙種子 (Traditional): full tone mark
    "zh-Hant": "miào wā zhǒng zǐ",
  },
};

const CHARMANDER: PokemonLocaleNames = {
  speciesId: 4,
  nameByLocale: {
    en: "Charmander",
    ja: "ヒトカゲ",
    "zh-Hans": "小火龙",
    "zh-Hant": "小火龍",
  },
  transliterationByLocale: {
    ja: "Hitokage",
    "zh-Hans": "xiǎo huǒ lóng",
    "zh-Hant": "xiǎo huǒ lóng",
  },
};

const SAMPLE_PAYLOAD: PokemonLocaleNames[] = [BULBASAUR, CHARMANDER];

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Mock a successful fetch returning the given payload. */
function mockFetch(payload: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => payload,
    }),
  );
}

/** Mock a failing fetch. */
function mockFetchFail() {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: false, status: 404 }),
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("localeNames", () => {
  beforeEach(() => {
    _resetLocaleNamesCache();
    vi.restoreAllMocks();
  });

  describe("loadLocaleNames", () => {
    it("returns a Map keyed by speciesId on success", async () => {
      mockFetch(SAMPLE_PAYLOAD);
      const map = await loadLocaleNames();
      expect(map.size).toBe(2);
      expect(map.get(1)).toEqual(BULBASAUR);
      expect(map.get(4)).toEqual(CHARMANDER);
    });

    it("returns an empty Map when fetch fails", async () => {
      mockFetchFail();
      const map = await loadLocaleNames();
      expect(map.size).toBe(0);
    });

    it("calls fetch only once for concurrent invocations", async () => {
      mockFetch(SAMPLE_PAYLOAD);
      const [a, b] = await Promise.all([loadLocaleNames(), loadLocaleNames()]);
      expect(a).toBe(b);
      expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
    });

    it("returns the cached result on subsequent calls", async () => {
      mockFetch(SAMPLE_PAYLOAD);
      await loadLocaleNames();
      await loadLocaleNames();
      expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
    });
  });

  describe("getLocaleName", () => {
    it("returns undefined before the cache is loaded", () => {
      expect(getLocaleName(1, "ja")).toBeUndefined();
    });

    it("returns the correct name after loading", async () => {
      mockFetch(SAMPLE_PAYLOAD);
      await loadLocaleNames();
      expect(getLocaleName(1, "ja")).toBe("フシギダネ");
      expect(getLocaleName(1, "zh-Hans")).toBe("妙蛙种子");
      expect(getLocaleName(1, "zh-Hant")).toBe("妙蛙種子");
      expect(getLocaleName(1, "en")).toBe("Bulbasaur");
    });

    it("returns undefined for an unknown speciesId", async () => {
      mockFetch(SAMPLE_PAYLOAD);
      await loadLocaleNames();
      expect(getLocaleName(9999, "ja")).toBeUndefined();
    });
  });

  describe("getTransliteration", () => {
    it("returns undefined before the cache is loaded", () => {
      expect(getTransliteration(1, "ja")).toBeUndefined();
    });

    it("returns rōmaji for Japanese locale", async () => {
      mockFetch(SAMPLE_PAYLOAD);
      await loadLocaleNames();
      expect(getTransliteration(1, "ja")).toBe("Fushigidane");
    });

    it("returns pinyin for Simplified Chinese", async () => {
      mockFetch(SAMPLE_PAYLOAD);
      await loadLocaleNames();
      // 妙蛙种子: 子 is neutral tone in compound → "zi" not "zǐ"
      expect(getTransliteration(1, "zh-Hans")).toBe("miào wā zhǒng zi");
    });

    it("returns pinyin for Traditional Chinese", async () => {
      mockFetch(SAMPLE_PAYLOAD);
      await loadLocaleNames();
      expect(getTransliteration(1, "zh-Hant")).toBe("miào wā zhǒng zǐ");
    });

    it("returns undefined for an unknown speciesId", async () => {
      mockFetch(SAMPLE_PAYLOAD);
      await loadLocaleNames();
      expect(getTransliteration(9999, "ja")).toBeUndefined();
    });
  });

  describe("getLocaleNamesSnapshot", () => {
    it("returns an empty Map before loading", () => {
      expect(getLocaleNamesSnapshot().size).toBe(0);
    });

    it("returns the populated Map after loading", async () => {
      mockFetch(SAMPLE_PAYLOAD);
      await loadLocaleNames();
      expect(getLocaleNamesSnapshot().size).toBe(2);
    });
  });

  describe("_resetLocaleNamesCache", () => {
    it("clears the cache so the next call fetches again", async () => {
      mockFetch(SAMPLE_PAYLOAD);
      await loadLocaleNames();
      _resetLocaleNamesCache();
      // Snapshot should be empty after reset.
      expect(getLocaleNamesSnapshot().size).toBe(0);
      // A new call should fetch again.
      await loadLocaleNames();
      expect(vi.mocked(fetch)).toHaveBeenCalledTimes(2);
    });
  });
});
