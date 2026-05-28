// lib/pokemon/transliteration.ts
// Build-time transliteration helpers for multi-locale Pokemon names (#1259).
//
// This module is intentionally NOT imported at runtime — it is only used by
// the seed script (`scripts/seed-pokemon.mjs`) and `scripts/split-seed.mjs`.
// All transliterations are baked into `generated-locale-names.json` at seed
// time; the runtime never calls pinyin-pro or wanakana.
//
// Exports are plain functions so they can be unit-tested directly.

// ---------------------------------------------------------------------------
// Pinyin (zh-Hans / zh-Hant)
// ---------------------------------------------------------------------------

/**
 * Generate a pinyin transliteration for a Chinese (Simplified or Traditional)
 * Pokemon name.  Tone marks are included (e.g. "miào wā zhǒng zǐ").
 *
 * `pinyin-pro` v3.28 handles both Simplified and Traditional characters
 * natively — the same call works for both scripts.
 *
 * Callers should import pinyin-pro directly when possible; this wrapper is
 * provided for a cleaner interface and to centralise the options.
 */
export function generatePinyin(
  name: string,
  pinyinFn: (text: string, opts: { toneType: string }) => string,
): string {
  return pinyinFn(name, { toneType: "symbol" }).trim();
}

// ---------------------------------------------------------------------------
// Rōmaji (ja)
// ---------------------------------------------------------------------------

/**
 * Normalise a PokéAPI `ja-roma` rōmaji string.
 *
 * PokéAPI's rōmaji field is already in Hepburn romanisation; this function
 * applies light normalisation only (collapse multiple spaces, trim).
 *
 * If `jaRoma` is absent for a species (defensive — research shows Gen 1-9
 * coverage is complete), `fallback` is used instead (wanakana conversion of
 * the `ja` kana field).
 */
export function normaliseRomaji(
  jaRoma: string | null | undefined,
  fallback: string,
): string {
  if (!jaRoma) return fallback;
  return jaRoma.replace(/\s+/g, " ").trim();
}

// ---------------------------------------------------------------------------
// Known-bad-tone override map
// ---------------------------------------------------------------------------

/**
 * Pinyin override map for names where pinyin-pro produces ambiguous or
 * incorrect tone assignments.  Keyed on the Chinese name string.
 *
 * Pokemon names are typically proper nouns whose hanzi readings in context
 * may differ from the standard dictionary entry.  This map is intentionally
 * sparse — only entries that are verified to be wrong should be added here.
 *
 * Format: chineseName → correctedPinyin
 *
 * Populated on a best-effort basis; the seed-time validator logs a warning
 * for any name that yields suspiciously short or empty pinyin.
 */
export const PINYIN_OVERRIDES: Record<string, string> = {
  // No overrides identified in initial spot-check — maintained for future use.
};

/**
 * Return the pinyin for a Chinese name, applying any known overrides.
 */
export function pinyinWithOverrides(
  name: string,
  pinyinFn: (text: string, opts: { toneType: string }) => string,
): string {
  if (Object.prototype.hasOwnProperty.call(PINYIN_OVERRIDES, name)) {
    return PINYIN_OVERRIDES[name];
  }
  return generatePinyin(name, pinyinFn);
}
