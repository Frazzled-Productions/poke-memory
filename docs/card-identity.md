# Card identity model

Decision record for how cards are identified in `card_reviews` and the surrounding sync code. AGENTS.md keeps a short pointer here. See also [docs/persistence.md](persistence.md) for the broader "where does new data live" decision tree, and [docs/sync.md](sync.md) for the push/pull/merge rules.

**Status:** Implemented 2026-05-14 (#462). Migrations 010–013 are applied; `card_reviews.pokemon_id` and `grade_log.card_id` are gone.

## TL;DR

Cards in `card_reviews` are identified by a composite primary key `(user_id, card_type, subject_key)`. `card_type` is a short string slug (`name`, `reverse`, `cry`, `evolution-edge`, `reverse-evolution-edge`). `subject_key` is a card-type-specific opaque text key — either a PokéAPI pokemon ID stringified, or a structured composite for multi-referent cards.

This replaces the prior model where every card carried a single integer `pokemon_id` packed into arithmetic offset ranges (1–999_999 name cards, 2_000_001+ reverse, 3_000_001+ cry, etc.). The offset scheme had run out of headroom and made each new card type a multi-file refactor — `grade_log.card_type` historically dropped `cry` and `reverse-evolution` rows from sync because the CHECK constraint was never extended.

## Why this model (B over A and C)

Three options were considered:

- **A — keep the offset scheme, add `FORM_ID_OFFSET = 4_000_001`.** Cheapest, but every future card type pays the same tax (a new offset range, a new CHECK migration on `grade_log`, special-case arithmetic in generation/mastery code). Rejected because the user surfaced extensibility as the top constraint.
- **B (chosen) — string-keyed cards on one table with a `card_type` discriminator.** One-time invasive migration; new card types become free thereafter.
- **C — per-card-type tables** (`card_reviews_name`, `card_reviews_cry`, etc.). Maximally typed per type, but the operational cost compounds: every common read becomes an N-way UNION; every shared column is N migrations; every new card type is a new table + four RLS policies + regression-trigger attachment + sync module. Rejected because all current and plausible-future card types share the same FSRS state shape — what varies between card types is the *identity* of the card, which `subject_key` captures, not the state.

The trade-off B accepts: `subject_key` is opaque text from the DB's perspective. Queries like "all edge cards where `to_id = 26`" require parsing the string. If that ever becomes load-bearing, the answer is a view or a generated column — not C.

## When to add a new `card_type` value (the usual case)

A new card type that reuses FSRS state and just has a different identity shape needs:

1. Pick a new `card_type` slug.
2. Define how its `subject_key` is encoded (single pokemon ID? compound key? something else?) in `lib/cards/subjectKey.ts`.
3. Add a card builder to `lib/review/session.ts` and a card component under `components/review/`.
4. Extend the app-boundary `card_type` validator (a single allow-list in `lib/sync/`).

There is no DB migration. No new RLS. No new trigger. No new sync module.

`card_reviews` deliberately has **no CHECK constraint on `card_type`** — validation lives at the app boundary so adding a card type is a pure code change. `grade_log.card_type` follows the same rule (the CHECK from migration 006 was dropped by migration 013).

## When to add a sidecar table instead

If a new card type needs *state that doesn't fit FSRS columns* — per-attempt artifacts, response-time histograms, per-keystroke metrics — add a sidecar table keyed `(user_id, card_type, subject_key)` that references the unified `card_reviews` row. The shared FSRS state stays on `card_reviews`; the type-specific extras live next to it.

Examples that would justify a sidecar:

- Typing-drill cards storing per-keystroke timing (`keystroke_count`, `typo_positions`, `ms_per_char`).
- Drawing-recognition cards storing user-submitted sketch references (`blob_url`, `grader_confidence`).
- Reaction-time cry cards storing response-time percentiles.

`grade_log` (migration 006) is already a sidecar in this shape — use it as the template for new ones.

**Do not add card-type-specific columns to `card_reviews` itself.** Sparse nullable columns on a shared table are a smell; sidecars keep the shared table uniform and let the type-specific schema evolve independently.

## Subject key encoding conventions

| `card_type` | `subject_key` shape | Example |
|---|---|---|
| `name` | PokéAPI pokemon ID as text | `"26"`, `"10100"` |
| `reverse` | PokéAPI pokemon ID as text | `"26"` |
| `cry` | PokéAPI pokemon ID as text | `"10100"` |
| `evolution-edge` | `<fromId>>><toId>` | `"25>>>26"` |
| `reverse-evolution-edge` | `<fromId>>><toId>` | `"25>>>26"` |

The pokemon ID is the canonical PokéAPI ID — 1..1025 for default forms, 10001..10277 for alternate forms (10278+ are stub Megas to be filtered out). No app-specific offset arithmetic anywhere. The PokéAPI is the source of truth for identity.

`lib/cards/subjectKey.ts` owns encoding/decoding. Never inline these helpers — go through the codec module so the format is auditable in one place.

## Future migrations

- **Adding shared columns to `card_reviews`** follows the existing pattern (one migration; cf. migration 007 `hidden_since`, migration 008 `seen_in_pasture`).
- **Adding a sidecar table** follows the new-table checklist in [docs/persistence.md](persistence.md).
- **The regression trigger on `card_reviews`** (migration 002, updated by migration 012) continues to guard the lifecycle timestamps (`last_review`, `first_seen`) against regression. RAISE strings now reference `(card_type, subject_key)` instead of `pokemon_id`. The trigger is card-type-agnostic and does not need updating per card type.

## If you find yourself wanting C

If a future card type genuinely needs structurally different scheduling state — not just different identity, but truly different state columns — first consider whether the difference belongs in a sidecar. If it really doesn't (you're bringing in a fundamentally different scheduler), open an issue to discuss splitting that card type onto its own table. The B→C transition is reversible (~1.5 weeks of careful work at current scale) but not free; don't do it casually.
