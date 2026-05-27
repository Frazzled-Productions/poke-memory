/**
 * Shared card-eligibility predicate (#1160).
 *
 * Both the on-device PWA badge filter (`lib/review/scope.ts`
 * `computeEligibleCardIds`) and the daily Web Push route
 * (`app/api/push/send-daily/route.ts` `rowIsEligible`) apply the same
 * two-axis gate:
 *
 *   1. Card-type enabled flags (`evolutionCardsEnabled`, etc.)
 *      Name and reverse are always on (#1234) — no per-direction toggle.
 *   2. `alternateFormsEnabled` — excludes alt-form cards (species id >= 10000)
 *      when false.
 *
 * This module is the single source of truth. Both callers wrap their input
 * into `EligibilityInput` and delegate here so a new card type only needs
 * to be wired in one place.
 *
 * The predicate is PURE: no I/O, no globals, no seed imports.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Normalised card identity consumed by `isCardEligible`. Both callers
 * (client seed cards and server DB rows) map to this shape.
 *
 * `cardType` uses the persisted DB slug convention:
 *   - `"name"`                    — name-recognition card
 *   - `"reverse"`                 — reverse name card (image → name)
 *   - `"cry"`                     — cry-recognition card
 *   - `"evolution-edge"`          — forward evolution edge
 *   - `"reverse-evolution-edge"`  — reverse evolution edge
 *
 * `subjectKey` is the opaque text key stored in `card_reviews.subject_key`
 * (see `docs/card-identity.md` for the encoding conventions):
 *   - `name` / `reverse` / `cry`            : numeric species id as text ("26", "10100")
 *   - `evolution-edge` / `reverse-evolution-edge` : `"<fromId>>><toId>"`
 *
 * Unknown `cardType` values pass through as eligible so future card types
 * are not silently dropped while a route or client awaits an update.
 */
export type EligibilityInput = {
  cardType: string;
  subjectKey: string;
};

/**
 * Settings surface consumed by `isCardEligible`. Matches the relevant
 * subset of `UserSettings` in `lib/settings/persistence.ts` and the
 * `UserEligibility` shape in `app/api/push/send-daily/route.ts`.
 *
 * Name and reverse card directions are always on since #1234. They are not
 * represented here — their absence means "always pass".
 */
export type CardEligibilitySettings = {
  evolutionCardsEnabled: boolean;
  reverseEvolutionCardsEnabled: boolean;
  cryCardsEnabled: boolean;
  alternateFormsEnabled: boolean;
};

// ---------------------------------------------------------------------------
// Alt-form species-id threshold
// ---------------------------------------------------------------------------

/**
 * PokéAPI species ids >= this threshold are alternate-form variants
 * (Alolan Raichu = 10100, Galarian Ponyta = 10159, etc.). Default-form
 * species occupy the range 1..1025.
 *
 * Exported so callers that need to perform the same check independently
 * (e.g. building UI labels) use the same constant rather than inlining 10000.
 */
export const ALT_FORM_ID_THRESHOLD = 10000;

// ---------------------------------------------------------------------------
// Core predicate
// ---------------------------------------------------------------------------

/**
 * Returns true when the card described by `input` is eligible under the
 * given `settings`.
 *
 * Gate 1 — card-type enabled flags:
 *   - `"name"`                   → always on (#1234)
 *   - `"reverse"`                → always on (#1234)
 *   - `"evolution-edge"`         → `evolutionCardsEnabled`
 *   - `"reverse-evolution-edge"` → `reverseEvolutionCardsEnabled`
 *   - `"cry"`                    → `cryCardsEnabled`
 *   - unknown type               → pass through (forward-compatible)
 *
 * Gate 2 — alternate-forms toggle (applied only when gate 1 passes):
 *   When `alternateFormsEnabled` is `false`:
 *   - `name` / `reverse` / `cry`: parse `subjectKey` as an integer species id.
 *     Species ids >= `ALT_FORM_ID_THRESHOLD` (10000) are alt-form variants
 *     and are excluded.
 *   - `evolution-edge` / `reverse-evolution-edge`: `subjectKey` has the shape
 *     `"<fromId>>><toId>"` (see `docs/card-identity.md`). Exclude the row
 *     when either endpoint id is >= `ALT_FORM_ID_THRESHOLD`.
 *
 * Pure — no I/O, no side effects.
 */
export function isCardEligible(
  input: EligibilityInput,
  settings: CardEligibilitySettings,
): boolean {
  const { cardType, subjectKey } = input;

  // ── Gate 1: card-type enabled ───────────────────────────────────────────
  // name and reverse are always on since #1234 — no guard needed.
  switch (cardType) {
    case "name":
    case "reverse":
      // Always eligible — no per-direction toggle.
      break;
    case "evolution-edge":
      if (!settings.evolutionCardsEnabled) return false;
      break;
    case "reverse-evolution-edge":
      if (!settings.reverseEvolutionCardsEnabled) return false;
      break;
    case "cry":
      if (!settings.cryCardsEnabled) return false;
      break;
    default:
      // Unknown card type — pass through so future card types are not
      // silently dropped while callers await an update.
      break;
  }

  // ── Gate 2: alternate-forms toggle ─────────────────────────────────────
  if (!settings.alternateFormsEnabled) {
    if (
      cardType === "name" ||
      cardType === "reverse" ||
      cardType === "cry"
    ) {
      // subjectKey is the numeric species id as text.
      const id = parseInt(subjectKey, 10);
      if (!isNaN(id) && id >= ALT_FORM_ID_THRESHOLD) return false;
    } else if (
      cardType === "evolution-edge" ||
      cardType === "reverse-evolution-edge"
    ) {
      // subjectKey format: "<fromId>>><toId>" — split on ">>>".
      // See `docs/card-identity.md` and `lib/cards/subjectKey.ts`.
      const parts = subjectKey.split(">>>");
      if (parts.length === 2) {
        const fromId = parseInt(parts[0], 10);
        const toId = parseInt(parts[1], 10);
        if (
          (!isNaN(fromId) && fromId >= ALT_FORM_ID_THRESHOLD) ||
          (!isNaN(toId) && toId >= ALT_FORM_ID_THRESHOLD)
        ) {
          return false;
        }
      }
    }
  }

  return true;
}
