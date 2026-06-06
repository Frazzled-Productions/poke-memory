// lib/pokemon/seed-constants.ts
// JSON-independent numeric constants and pure helpers for the seed card-ID
// namespaces.  Extracted here so async consumers (seed-async.ts) and future
// Stage 2+ work can import them without pulling in the static JSON bundles.
//
// Re-exported from seed.ts so every existing import continues to work
// unchanged - this file is additive only.

// Card-id namespaces (kept disjoint by construction; validated at module load):
//   1..MAX_NAME_ID                      name cards
//   [1_000_001, 1_500_000]              LEGACY per-pre-evo evolution cards.
//                                       Issue #262 retired this sub-range.
//                                       Existing cloud rows are orphaned -
//                                       merge drops them via left-join. No
//                                       local card ever lives here again.
//   [1_500_001, 1_999_999]              forward edge cards (#262).
//   [2_000_001, 2_500_000]              reverse name cards (sprite-picker).
//   [2_500_001, 2_999_999]              reverse evolution edge cards (#343):
//                                       reverseId = REVERSE_EDGE_ID_BASE +
//                                                   (forwardEdgeId - EDGE_ID_BASE)
//   [3_000_001, 3_999_999]              cry cards.

export const EVOLUTION_ID_OFFSET = 1_000_000;
export const EDGE_ID_BASE = 1_500_000; // first forward edge ID = 1_500_001
export const REVERSE_ID_OFFSET = 2_000_000;
export const REVERSE_EDGE_ID_BASE = 2_500_000; // first reverse edge ID = 2_500_001
export const CRY_ID_OFFSET = 3_000_000;

/** Map a forward edge ID to its reverse counterpart. */
export function reverseEdgeIdFor(forwardEdgeId: number): number {
  return REVERSE_EDGE_ID_BASE + (forwardEdgeId - EDGE_ID_BASE);
}

/** True when the id falls in the reverse-evolution edge sub-range. */
export function isReverseEdgeId(id: number): boolean {
  return id > REVERSE_EDGE_ID_BASE && id < CRY_ID_OFFSET;
}
