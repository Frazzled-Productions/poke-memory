/**
 * Form-aware evolution edge expansion.
 *
 * PokéAPI encodes regional evolution branches directly in the chain JSON:
 * `evolution_details[].region` is non-null when a `(parent, child)` edge leads
 * to a regional variant of the child species. For example, the Pikachu chain
 * contains two Raichu child entries under Pikachu — one with `region: null`
 * (default Raichu) and one with `region: {name: "alola"}` (Alolan Raichu).
 *
 * This module implements the post-processing step that turns those region tags
 * into additional chain nodes using the form pokemon IDs (e.g. 10100 for
 * Alolan Raichu instead of 26 for default Raichu).
 *
 * Used by scripts/seed-pokemon.mjs (inline mirror) and tested here in the
 * node project.
 */

/**
 * A chain node as produced by flattenChain in the seed script.
 * The `region` field is populated during seed processing but is not persisted
 * to generated.json — the form IDs already encode the regional information.
 */
export type ChainNode = {
  /** Species ID (or form pokemon ID for form-aware nodes). */
  speciesId: number;
  name: string;
  evolvesFromId: number | null;
  /**
   * Trimmed evolution detail. `region` is set during seed processing to
   * indicate which regional variant this edge targets; it is stripped from
   * the final persisted chain node.
   */
  detail: { region?: string | null; [key: string]: unknown } | null;
  edgeId?: number;
};

/**
 * Variety entry for a single regional variant of a species.
 * Keyed by formSlug (e.g. "alola", "hisui") in VarietiesLookup.
 */
export type VarietyEntry = {
  pokemonId: number;
  displayName: string;
};

/**
 * Lookup table: speciesId → (formSlug → VarietyEntry).
 * Built from the partial records produced by the seed's processSpecies step.
 * Only includes entries where formSlug is a regional slug
 * (alola / galar / hisui / paldea).
 */
export type VarietiesLookup = Map<number, Map<string, VarietyEntry>>;

/**
 * Build a VarietiesLookup from the flat list of seed partial records.
 *
 * @param records  Array of partial records, each with at least:
 *   `{ speciesId: number; isDefaultForm: boolean; formSlug: string | null;
 *      id: number; displayName: string }`
 */
export function buildVarietiesLookup(
  records: Array<{
    speciesId: number;
    isDefaultForm: boolean;
    formSlug: string | null;
    id: number;
    displayName: string;
  }>,
): VarietiesLookup {
  const lookup: VarietiesLookup = new Map();
  for (const rec of records) {
    if (rec.isDefaultForm || !rec.formSlug) continue;
    // Only index regional slugs — the ones PokéAPI uses in evolution_details.region.
    if (!/^(alola|galar|hisui|paldea)/.test(rec.formSlug)) continue;
    if (!lookup.has(rec.speciesId)) {
      lookup.set(rec.speciesId, new Map());
    }
    lookup.get(rec.speciesId)!.set(rec.formSlug, {
      pokemonId: rec.id,
      displayName: rec.displayName,
    });
  }
  return lookup;
}

/**
 * Expand region-tagged chain nodes into additional form-aware edge nodes.
 *
 * For each node in `nodes` that has `detail.region !== null`:
 *   1. Resolve the child form: look up `(childSpeciesId, region)` in
 *      `lookup`. If no match, skip this form edge (the species has no such
 *      regional variant).
 *   2. Resolve the parent form: look up `(parentSpeciesId, region)` in
 *      `lookup`. If no match, fall back to the default parent pokemon ID
 *      (parentSpeciesId, which equals the default pokemonId for species
 *      with no regional variant of that parent).
 *   3. Emit an additional node:
 *      `{ speciesId: childFormId, name: childFormName,
 *         evolvesFromId: parentFormId, detail: detailWithoutRegion }`
 *
 * Default edges (region === null) pass through unchanged.
 *
 * Dedup key: `${evolvesFromId}>>>${speciesId}`. The input nodes are
 * assumed already deduped among themselves; this function deduplicates the
 * combined (input + emitted) set.
 *
 * @param nodes   Flat chain nodes from flattenChain (may include duplicates
 *                when the same chain is shared across species — e.g. both the
 *                default and regional Raichu node appear under the Pikachu
 *                chain).
 * @param lookup  VarietiesLookup built from the seed's partial records.
 * @returns       Combined node list, deduped on (evolvesFromId, speciesId).
 */
export function addFormEdges(
  nodes: ChainNode[],
  lookup: VarietiesLookup,
): ChainNode[] {
  const seen = new Set<string>();
  const result: ChainNode[] = [];

  function pushIfNew(node: ChainNode): void {
    const key =
      node.evolvesFromId === null
        ? `null>>>${node.speciesId}`
        : `${node.evolvesFromId}>>>${node.speciesId}`;
    if (seen.has(key)) return;
    seen.add(key);
    result.push(node);
  }

  for (const node of nodes) {
    // Always emit the node itself (default or no-region).
    pushIfNew(node);

    // Emit a form-aware edge when a region is tagged.
    const region = node.detail?.region;
    if (!region || node.evolvesFromId === null) continue;

    const parentSpeciesId = node.evolvesFromId; // species ID of the parent
    const childSpeciesId = node.speciesId;

    // Child form: required — skip if the child has no such regional variant.
    const childVarieties = lookup.get(childSpeciesId);
    const childEntry = childVarieties?.get(region);
    if (!childEntry) continue;

    // Parent form: optional — fall back to default pokemonId (= speciesId for
    // default forms whose id matches their speciesId).
    const parentVarieties = lookup.get(parentSpeciesId);
    const parentEntry = parentVarieties?.get(region);
    const parentFormId = parentEntry?.pokemonId ?? parentSpeciesId;
    const parentFormName = parentEntry?.displayName ?? node.name; // name unused for edges, but kept for consistency

    // Strip the `region` field from the emitted detail so the persisted node
    // doesn't include seed-time metadata.
    let detailWithoutRegion: ChainNode["detail"] = null;
    if (node.detail !== null) {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { region: _r, ...rest } = node.detail;
      detailWithoutRegion = rest as ChainNode["detail"];
    }

    void parentFormName; // used only as documentation; parentFormId is what matters

    pushIfNew({
      speciesId: childEntry.pokemonId,
      name: childEntry.displayName,
      evolvesFromId: parentFormId,
      detail: detailWithoutRegion,
    });
  }

  return result;
}
