/**
 * Serve the real locale-names sidecar to `loadLocaleNames` in jsdom tests, so
 * `useLocalePokemonName` resolves real ja / zh-Hans / zh-Hant names (#2187).
 * Call in `beforeEach`; it resets the module cache and stubs `fetch`.
 */
import { vi } from "vitest";
import entries from "@/lib/pokemon/generated-locale-names.json";
import { _resetLocaleNamesCache } from "@/lib/pokemon/localeNames";

export function serveLocaleNames(): void {
  _resetLocaleNamesCache();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, status: 200, json: async () => entries })),
  );
}
