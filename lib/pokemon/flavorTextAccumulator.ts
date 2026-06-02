/**
 * lib/pokemon/flavorTextAccumulator.ts
 *
 * Pure helper that dedup-accumulates English flavour-text entries from a
 * PokéAPI `flavor_text_entries` array into a `{ text, versions }[]` shape
 * where identical texts are merged and their source game slugs combined.
 *
 * Extracted from `scripts/seed-pokemon.mjs` in #1559 so the accumulation
 * logic can be unit-tested independently of the seed script.
 *
 * The seed script imports this module and delegates to it; the persisted
 * output in `generated-flavor.json` is produced by this path.
 */

/** Maximum number of distinct flavour-text entries kept per Pokémon. */
export const FLAVOR_TEXTS_MAX = 12;

/** A single PokéAPI flavour-text entry as it arrives from the API. */
export type RawFlavorTextEntry = {
  flavor_text?: string;
  language?: { name?: string };
  version?: { name?: string };
};

/** The accumulated shape stored in generated-flavor.json. */
export type FlavorTextEntry = {
  text: string;
  versions: string[];
};

/**
 * Normalise a PokéAPI flavour-text string: replace form-feed (0x0C),
 * newline, and carriage-return characters with a space, then collapse
 * runs of spaces and trim.
 */
export function normalizeFlavorText(text: string | null | undefined): string {
  if (!text) return "";
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    out += code === 12 || code === 10 || code === 13 ? " " : text[i];
  }
  return out.replace(/  +/g, " ").trim();
}

/**
 * Extract and dedup-accumulate English flavour-text entries.
 *
 * - Only entries whose `language.name === "en"` are kept.
 * - Entries with identical normalised text are merged: the first occurrence
 *   wins; subsequent occurrences add their `version.name` slug to the
 *   existing entry's `versions` list (in encounter order, deduped).
 * - The cap `FLAVOR_TEXTS_MAX` applies to *distinct* texts, not raw entries,
 *   so a Pokémon with 20 Red/Blue entries sharing 3 distinct texts yields 3.
 * - An entry whose `version.name` is absent contributes an empty `versions`
 *   list (or is silently skipped from version accumulation).
 *
 * @param flavorTextEntries  Raw `flavor_text_entries` from PokéAPI.
 * @returns Ordered array of `{ text, versions }` objects.
 */
export function extractFlavorTexts(
  flavorTextEntries: RawFlavorTextEntry[] | null | undefined,
): FlavorTextEntry[] {
  const en = (flavorTextEntries ?? []).filter(
    (e) => e.language?.name === "en",
  );
  if (en.length === 0) return [];

  // Insertion-ordered Map keyed on normalised text so iteration order matches
  // the first-seen order (preserving the old dedup-keep-first behaviour),
  // while accumulating version slugs across all entries with the same text.
  const byText = new Map<string, FlavorTextEntry>();

  for (const entry of en) {
    const normalized = normalizeFlavorText(entry.flavor_text);
    if (!normalized) continue;

    const versionSlug = entry.version?.name ?? "";

    if (byText.has(normalized)) {
      // Accumulate: add this game to the existing entry's versions list.
      const existing = byText.get(normalized)!;
      if (versionSlug && !existing.versions.includes(versionSlug)) {
        existing.versions.push(versionSlug);
      }
    } else {
      // New distinct text — insert with this game as the first version.
      byText.set(normalized, {
        text: normalized,
        versions: versionSlug ? [versionSlug] : [],
      });
      // Apply cap to distinct entries, not raw entries.
      if (byText.size >= FLAVOR_TEXTS_MAX) break;
    }
  }

  return [...byText.values()];
}
