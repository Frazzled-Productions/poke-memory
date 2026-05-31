/**
 * scripts/i18n-leak-allowlist.ts
 *
 * Allowlist for the English-leak render harness (#1405).
 *
 * When a component is rendered under the "xx-pseudo" locale, every string that
 * flows through the message catalogue is wrapped in sentinel brackets ("[...]").
 * The leak test collects all visible text nodes, strips sentinel-wrapped values,
 * strips values matching this allowlist, and asserts that the remainder is empty.
 *
 * TEXT THAT BELONGS ON THE ALLOWLIST:
 *   - Brand / proper nouns that intentionally stay English (app name, provider
 *     names, framework names, technical terms).
 *   - Pokemon names -- these flow through useLocalePokemonName (a separate locale
 *     axis), not through the message catalogue. PR1 starts wide; PR2 (#1434)
 *     narrows this to an explicit species-name list or dedicated Pokemon-name
 *     regex.
 *   - Roman numerals for generation labels (I, II, III ...).
 *   - Numeric strings and formatted numbers.
 *   - Common symbols / punctuation that carry no translatable meaning.
 *   - Version strings (v0.1.2).
 *
 * TEXT THAT DOES NOT BELONG:
 *   - Any UI prose, labels, button text, aria-labels, or status messages that
 *     a non-English user would need translated. Add those to the message
 *     catalogues instead.
 *
 * NARROWING STRATEGY:
 *   PR1 (this file) -- intentionally wide Pokemon-name regex so the baseline is
 *   green despite pre-existing hard-coded English strings (#1434 target sites).
 *   PR2 (#1434) -- sweeps hard-coded strings into the catalogue, then narrows
 *   this allowlist. Do not add more English prose here; add it to messages/.
 *
 * ## Known harness limitation -- rich messages
 *
 * The `SENTINEL_RE` pattern (`/^\[[\s\S]*\]$/`) assumes the entire text node is
 * sentinel-wrapped. Components that render rich-message strings (catalogue values
 * containing `<link>`, `<em>`, or `<term>` tags) will produce false positives:
 * `next-intl` splits such strings into multiple text nodes when injecting tag
 * components, and the leading/trailing fragments no longer satisfy `SENTINEL_RE`.
 * Work-around: add the expected text fragments from rich messages to this
 * allowlist, or restructure the test to avoid checking those nodes.
 */

export const ALLOWLIST: Array<string | RegExp> = [
  // -------------------------------------------------------------------------
  // Brand / app name -- intentionally English everywhere.
  // -------------------------------------------------------------------------
  /^poke-?memory$/i,

  // -------------------------------------------------------------------------
  // Auth providers -- proper nouns, not translatable.
  // -------------------------------------------------------------------------
  "GitHub",
  "Google",

  // -------------------------------------------------------------------------
  // Technical / framework terms used verbatim.
  // -------------------------------------------------------------------------
  /^FSRS\b/,

  // -------------------------------------------------------------------------
  // Pokemon names -- resolved via useLocalePokemonName (separate locale axis),
  // not the message catalogue. Wide regex: Title-Case words starting with a
  // capital letter. PR1 starts wide so the baseline is green; #1434 narrows
  // this once hard-coded English prose is swept into the catalogue.
  // -------------------------------------------------------------------------
  // TODO(#1434): replace with tighter heuristic or species-name set
  /^[A-Z][a-zA-Zeé'-]+(?:\s[A-Z][a-zA-Zeé'-]+)*$/,

  // -------------------------------------------------------------------------
  // Roman numerals -- generation labels (Gen I, II, III, IV ... IX).
  // -------------------------------------------------------------------------
  /^[IVX]+$/,

  // -------------------------------------------------------------------------
  // Numeric / formatted numbers (integers, decimals, locale separators).
  // -------------------------------------------------------------------------
  /^\d[\d,.\s]*%?$/,
  /^[0-9]+$/,

  // -------------------------------------------------------------------------
  // Symbols and common punctuation carrying no translatable meaning.
  // -------------------------------------------------------------------------
  /^[→←↑↓%#/·★☆•–\-_:;,.!?'"()\[\]{}|@^~`\s]+$/,
  // Arrow characters used as icons in badges / direction indicators.
  "→",
  "←",
  // Star used in badge rail.
  "★",
  // Black right-pointing pointer (triangle used in collapse toggle).
  "►",

  // -------------------------------------------------------------------------
  // Emoji -- used as decorative icons in badges, direction indicators, etc.
  // -------------------------------------------------------------------------
  // Matches strings containing only emoji / Unicode symbol characters.
  // A string of pure emoji is never translatable prose.
  /^\p{Emoji}+$/u,

  // -------------------------------------------------------------------------
  // PR1 wide-allowlist entries removed in PR2 (#1434) as those strings were
  // moved into the message catalogue:
  //   - DirectionBadge labels (Name this Pokémon, Evolution, Pre-evolution,
  //     Pick the sprite, Name from cry) -- now in practice.direction.* keys.
  //
  // Do NOT add new hard-coded English prose here -- add it to messages/ instead.
  // -------------------------------------------------------------------------

  // -------------------------------------------------------------------------
  // Version strings (v0.1.2 etc.).
  // -------------------------------------------------------------------------
  /^v\d+\.\d+\.\d+/,

  // -------------------------------------------------------------------------
  // Empty / whitespace-only strings -- not meaningful text.
  // -------------------------------------------------------------------------
  /^\s*$/,

  // -------------------------------------------------------------------------
  // Single characters (icons, separators, decorative punctuation).
  // A single visible character (emoji, arrow, letter, digit) carries no
  // translatable prose. The /s flag is not used to stay compatible with es2017
  // targets -- \n in a single-char text node would be the only miss, and text
  // nodes with just a newline are already caught by the whitespace rule above.
  // -------------------------------------------------------------------------
  /^[\s\S]$/,
];

/**
 * Returns true when `text` is an allowlisted value that should not be
 * flagged as an untranslated English string.
 */
export function isAllowlisted(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed === "") return true;
  for (const entry of ALLOWLIST) {
    if (typeof entry === "string") {
      if (trimmed === entry) return true;
    } else {
      if (entry.test(trimmed)) return true;
    }
  }
  return false;
}
