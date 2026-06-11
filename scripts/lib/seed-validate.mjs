// scripts/lib/seed-validate.mjs
// Pure, unit-testable validation functions for the seed:all pipeline.
//
// Each function receives the artefact data already parsed (not file paths)
// so that tests can exercise the logic without touching the file system.
// The standalone runner (scripts/seed-validate.mjs) owns the file I/O.

// ---------------------------------------------------------------------------
// Type aliases (JSDoc)
// ---------------------------------------------------------------------------
// @typedef {{ id: number, speciesId: number, isDefaultForm: boolean }} GeneratedRecord
// @typedef {{ id: number }} CoreRecord
// @typedef {{ id: number }} FlavorRecord
// @typedef {{ chains: Record<string,unknown>, pokemonChain: Record<string,string> }} ChainsData
// @typedef {{ speciesId: number, nameByLocale: Record<string,string> }} LocaleRecord

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Supported non-English locales that must have entries in generated-locale-names.json. */
export const SUPPORTED_LOCALES = ["ja", "zh-Hans", "zh-Hant"];

/**
 * The canonical WebP sizes produced by optimise-sprites.mjs.
 * We only assert the presence of the smallest size (32 px) to keep the check
 * fast and to be robust against future size additions, but we export the full
 * list so tests and the standalone runner can use it.
 */
export const CANONICAL_SPRITE_SIZE = 32;

// ---------------------------------------------------------------------------
// Validation functions
// ---------------------------------------------------------------------------

/**
 * Assert that the species count in generated.json is at least as large as
 * `preSeedCount`. Returns a ValidationResult.
 *
 * "At least as large" covers both:
 *   - Additive runs: new species were added, count grew.
 *   - No-op runs: upstream PokéAPI had no new species, count stayed the same.
 *
 * @param {number} currentCount  Number of records in generated.json after seed.
 * @param {number} preSeedCount  Number of records in generated.json before seed ran.
 *   Pass 0 on a fresh checkout (no prior artefact).
 * @returns {{ ok: boolean, message: string }}
 */
export function validateSpeciesCount(currentCount, preSeedCount) {
  if (currentCount >= preSeedCount) {
    return {
      ok: true,
      message: `Species count OK: ${currentCount} records in generated.json` +
        (preSeedCount > 0 && currentCount > preSeedCount
          ? ` (grew from ${preSeedCount})`
          : preSeedCount > 0
            ? ` (unchanged from ${preSeedCount} - no new upstream species)`
            : ""),
    };
  }
  return {
    ok: false,
    message:
      `FAIL: generated.json shrank from ${preSeedCount} to ${currentCount} records.\n` +
      `  This suggests a partial or corrupted seed run.\n` +
      `  Re-run: npm run seed (or npm run seed:all) to regenerate.`,
  };
}

/**
 * Assert that no previously-present species ID has disappeared from the new
 * generated.json output. Compares id sets rather than counts so that a dropped
 * species is always detected, even when new species arrive in the same run and
 * the total count grows.
 *
 * @param {number[]} currentIds   IDs present in generated.json after seed.
 * @param {number[]} priorIds     IDs present in generated.json before seed ran.
 *   Pass [] on a fresh checkout (no prior artefact) to skip the check.
 * @param {number[]} [removalAllowlist=[]]  IDs that are explicitly permitted to
 *   disappear (e.g. a species retired from the canonical set).
 * @returns {{ ok: boolean, message: string }}
 */
export function validateSpeciesIds(currentIds, priorIds, removalAllowlist = []) {
  if (priorIds.length === 0) {
    return {
      ok: true,
      message: "Species id-set check skipped (no prior artefact).",
    };
  }
  const currentSet = new Set(currentIds);
  const allowSet = new Set(removalAllowlist);
  const dropped = priorIds.filter((id) => !currentSet.has(id) && !allowSet.has(id));
  if (dropped.length === 0) {
    return {
      ok: true,
      message: `Species id-set OK: no previously-present ids dropped (${currentIds.length} total).`,
    };
  }
  return {
    ok: false,
    message:
      `FAIL: ${dropped.length} previously-present id(s) are missing from generated.json.\n` +
      `  Dropped IDs: ${formatIdList(dropped)}\n` +
      `  This suggests a transient fetch failure dropped existing species.\n` +
      `  Re-run: npm run seed (or npm run seed:all) to regenerate.`,
  };
}

/**
 * Assert that all four shards contain entries for every record in generated.json.
 *
 * Checks:
 *   - generated-core.json has all `id` values from generated.json.
 *   - generated-chains.json.pokemonChain has all `id` values from generated.json.
 *   - generated-chains.json contains at least one chain node referencing an
 *     alternate-form id (> 10000), confirming form-aware edge generation ran.
 *   - When `priorChainsData` is supplied: any species that previously had a
 *     non-empty chain must still have a non-empty chain (detects silent empty-chain
 *     corruption from a failed chain fetch).
 *   - generated-flavor.json has all `id` values for records with non-empty
 *     flavorTexts in generated.json (flavourless records are intentionally omitted).
 *   - generated-locale-names.json has all `speciesId` values for default-form records.
 *
 * Returns an array of ValidationResults (one per check) so callers can report
 * them individually.
 *
 * @param {GeneratedRecord[]} generated       Parsed generated.json records.
 * @param {CoreRecord[]} core                 Parsed generated-core.json records.
 * @param {FlavorRecord[]} flavor             Parsed generated-flavor.json records.
 * @param {ChainsData} chains                 Parsed generated-chains.json object.
 * @param {LocaleRecord[]} localeNames        Parsed generated-locale-names.json records.
 * @param {ChainsData|null} [priorChainsData] Optional prior generated-chains.json for
 *   empty-chain regression detection. Pass null to skip that check.
 * @returns {Array<{ ok: boolean, message: string }>}
 */
export function validateShards(generated, core, flavor, chains, localeNames, priorChainsData = null) {
  const results = [];

  // All pokemon IDs (including alternate forms)
  const allIds = generated.map((p) => p.id);
  // Default-form species IDs only
  const defaultSpeciesIds = generated
    .filter((p) => p.isDefaultForm)
    .map((p) => p.speciesId);

  // ---- core ----------------------------------------------------------------
  const coreIdSet = new Set(core.map((p) => p.id));
  const missingCore = allIds.filter((id) => !coreIdSet.has(id));
  results.push(
    missingCore.length === 0
      ? {
          ok: true,
          message: `generated-core.json OK: all ${allIds.length} records present.`,
        }
      : {
          ok: false,
          message:
            `FAIL: generated-core.json is missing ${missingCore.length} record(s).\n` +
            `  Missing pokemon IDs: ${formatIdList(missingCore)}\n` +
            `  Re-run: npm run seed:split`,
        },
  );

  // ---- chains: pokemonChain coverage ----------------------------------------
  const pokemonChainIdSet = new Set(
    Object.keys(chains.pokemonChain).map(Number),
  );
  const missingChains = allIds.filter((id) => !pokemonChainIdSet.has(id));
  results.push(
    missingChains.length === 0
      ? {
          ok: true,
          message: `generated-chains.json OK: all ${allIds.length} records present in pokemonChain.`,
        }
      : {
          ok: false,
          message:
            `FAIL: generated-chains.json.pokemonChain is missing ${missingChains.length} record(s).\n` +
            `  Missing pokemon IDs: ${formatIdList(missingChains)}\n` +
            `  Re-run: npm run seed:split`,
        },
  );

  // ---- chains: form-aware edges present (F17) ------------------------------
  // At least one chain node in the chains map must reference an alternate-form
  // pokemon id (> 10000). If this is 0, addFormEdges is a no-op (which means
  // the regional-detail fix in flattenChain or buildVarietiesLookup is broken).
  const chainValues = Object.values(chains.chains ?? {});
  const hasFormEdge = chainValues.some(
    (nodes) => Array.isArray(nodes) && nodes.some((n) => n.speciesId > 10000),
  );
  results.push(
    hasFormEdge
      ? {
          ok: true,
          message: "generated-chains.json OK: at least one form-aware edge (id > 10000) present.",
        }
      : {
          ok: false,
          message:
            "FAIL: generated-chains.json contains no chain node referencing an alternate-form id (> 10000).\n" +
            "  This indicates form-aware evolution edge generation did not fire.\n" +
            "  Re-run: npm run seed (to regenerate with the fixed flattenChain / buildVarietiesLookup).",
        },
  );

  // ---- chains: empty-chain regression (F18) --------------------------------
  // When prior chain data is available, any species that previously had a
  // non-empty chain must still have a non-empty chain. An empty chain after a
  // previously non-empty one indicates a failed chain fetch that was silently
  // persisted.
  if (priorChainsData != null) {
    const priorPokemonChain = priorChainsData.pokemonChain ?? {};
    const priorChains = priorChainsData.chains ?? {};
    const emptyRegressed = [];
    for (const [idStr, priorHash] of Object.entries(priorPokemonChain)) {
      const priorChain = priorChains[priorHash];
      if (!Array.isArray(priorChain) || priorChain.length === 0) continue; // was already empty
      const currentHash = chains.pokemonChain[idStr];
      if (currentHash === undefined) continue; // missing ID caught by coverage check above
      const currentChain = chains.chains[currentHash];
      if (!Array.isArray(currentChain) || currentChain.length === 0) {
        emptyRegressed.push(Number(idStr));
      }
    }
    results.push(
      emptyRegressed.length === 0
        ? {
            ok: true,
            message: "generated-chains.json OK: no previously-non-empty chains are now empty.",
          }
        : {
            ok: false,
            message:
              `FAIL: ${emptyRegressed.length} pokemon id(s) had a non-empty chain before but now map to an empty chain.\n` +
              `  Affected IDs: ${formatIdList(emptyRegressed)}\n` +
              `  This indicates a failed evolution-chain fetch was silently persisted.\n` +
              `  Re-run: npm run seed (to re-fetch the affected chain URLs).`,
          },
    );
  }

  // ---- flavor (F58 fix) ----------------------------------------------------
  // Only require records whose generated.json entry has non-empty flavorTexts
  // to be present in the flavor shard. Flavourless records (flavorTexts: [] or
  // absent) are intentionally omitted by the shard producer.
  const flavorIdSet = new Set(flavor.map((p) => p.id));
  const idsWithFlavor = generated
    .filter((p) => Array.isArray(p.flavorTexts) && p.flavorTexts.length > 0)
    .map((p) => p.id);
  const missingFlavor = idsWithFlavor.filter((id) => !flavorIdSet.has(id));
  results.push(
    missingFlavor.length === 0
      ? {
          ok: true,
          message: `generated-flavor.json OK: all ${idsWithFlavor.length} records with flavor text present.`,
        }
      : {
          ok: false,
          message:
            `FAIL: generated-flavor.json is missing ${missingFlavor.length} record(s) that have flavor text.\n` +
            `  Missing pokemon IDs: ${formatIdList(missingFlavor)}\n` +
            `  Re-run: npm run seed:split`,
        },
  );

  // ---- locale names --------------------------------------------------------
  // Locale names only cover default-form species (one entry per species).
  const localeIdSet = new Set(localeNames.map((e) => e.speciesId));
  const missingLocale = defaultSpeciesIds.filter(
    (id) => !localeIdSet.has(id),
  );
  results.push(
    missingLocale.length === 0
      ? {
          ok: true,
          message: `generated-locale-names.json OK: all ${defaultSpeciesIds.length} default-form species present.`,
        }
      : {
          ok: false,
          message:
            `FAIL: generated-locale-names.json is missing ${missingLocale.length} species entry/entries.\n` +
            `  Missing species IDs: ${formatIdList(missingLocale)}\n` +
            `  Re-run: npm run seed:split (or npm run seed:locale-names for full locale data)`,
        },
  );

  return results;
}

/**
 * Assert that the lib/ and public/ copies of all four shards are byte-identical.
 *
 * Both copies are written atomically by writeSplitSeedFiles; a mismatch
 * indicates a partial seed run, a manual edit, or a split-seed.mjs run that
 * only updated one side.
 *
 * @param {string} libDir     Absolute path to lib/pokemon/.
 * @param {string} publicDir  Absolute path to public/pokemon-data/.
 * @param {(path: string) => string|null} readFileFn  Reads file contents as a
 *   string, or returns null if the file does not exist. Injected for testability.
 * @returns {Array<{ ok: boolean, message: string }>}
 */
export function validateShardParity(libDir, publicDir, readFileFn) {
  const shards = [
    "generated-core.json",
    "generated-chains.json",
    "generated-flavor.json",
    "generated-locale-names.json",
  ];

  return shards.map((shard) => {
    const libPath = `${libDir}/${shard}`;
    const publicPath = `${publicDir}/${shard}`;
    const libContent = readFileFn(libPath);
    const publicContent = readFileFn(publicPath);

    if (libContent === null) {
      return {
        ok: false,
        message:
          `FAIL: ${shard} is missing from lib/pokemon/.\n` +
          `  Re-run: npm run seed (or npm run seed:split).`,
      };
    }
    if (publicContent === null) {
      return {
        ok: false,
        message:
          `FAIL: ${shard} is missing from public/pokemon-data/.\n` +
          `  Re-run: npm run seed (or npm run seed:split).`,
      };
    }
    if (libContent !== publicContent) {
      return {
        ok: false,
        message:
          `FAIL: ${shard} differs between lib/pokemon/ and public/pokemon-data/.\n` +
          `  The copies must be byte-identical (written by the same seed run).\n` +
          `  Re-run: npm run seed (or npm run seed:split) to synchronise both copies.`,
      };
    }
    return {
      ok: true,
      message: `${shard} parity OK: lib/ and public/ copies are identical.`,
    };
  });
}

/**
 * Assert that a WebP sprite file exists for every default-form species.
 *
 * We check for the smallest canonical size (CANONICAL_SPRITE_SIZE px) under
 * `public/sprites/pokemon/webp/{speciesId}/{size}.webp`.  The smallest size
 * is generated first by optimise-sprites.mjs; if it is absent then the larger
 * sizes are certainly absent too.
 *
 * `existsSync` is injected so tests can supply a stub.
 *
 * @param {number[]} defaultSpeciesIds  Species IDs for all default-form records.
 * @param {string} webpRoot             Absolute path to public/sprites/pokemon/webp.
 * @param {(path: string) => boolean} existsSync  fs.existsSync or a test stub.
 * @returns {{ ok: boolean, message: string }}
 */
export function validateSprites(defaultSpeciesIds, webpRoot, existsSync) {
  const missing = [];
  for (const id of defaultSpeciesIds) {
    const path = `${webpRoot}/${id}/${CANONICAL_SPRITE_SIZE}.webp`;
    if (!existsSync(path)) {
      missing.push(id);
    }
  }

  if (missing.length === 0) {
    return {
      ok: true,
      message:
        `Sprites OK: all ${defaultSpeciesIds.length} default-form species have ` +
        `a ${CANONICAL_SPRITE_SIZE}px WebP under public/sprites/pokemon/webp/.`,
    };
  }

  return {
    ok: false,
    message:
      `FAIL: ${missing.length} species are missing a WebP sprite ` +
      `(${CANONICAL_SPRITE_SIZE}px under public/sprites/pokemon/webp/).\n` +
      `  Missing species IDs: ${formatIdList(missing)}\n` +
      `  Re-run: npm run seed:sprites`,
  };
}

/**
 * Assert that every default-form species has a non-empty name for each
 * supported locale (ja, zh-Hans, zh-Hant) in generated-locale-names.json.
 *
 * Note: The seed scripts legitimately fall back to the English name when
 * PokéAPI has no localised name for a species.  This check therefore asserts
 * only that the key IS PRESENT and is a non-empty string - not that it
 * differs from the English name.  A legitimate English fallback passes;
 * an absent or empty key is an error.
 *
 * Returns one ValidationResult per locale.
 *
 * @param {LocaleRecord[]} localeNames  Parsed generated-locale-names.json records.
 * @param {string[]} locales            Locale codes to check; defaults to SUPPORTED_LOCALES.
 * @returns {Array<{ ok: boolean, message: string }>}
 */
export function validateLocaleNames(
  localeNames,
  locales = SUPPORTED_LOCALES,
) {
  return locales.map((locale) => {
    const missingOrEmpty = localeNames.filter((entry) => {
      const name = entry.nameByLocale?.[locale];
      return typeof name !== "string" || name.trim() === "";
    });

    if (missingOrEmpty.length === 0) {
      return {
        ok: true,
        message: `Locale "${locale}" OK: all ${localeNames.length} species have a name entry.`,
      };
    }

    return {
      ok: false,
      message:
        `FAIL: ${missingOrEmpty.length} species are missing a "${locale}" name in ` +
        `generated-locale-names.json.\n` +
        `  Missing species IDs: ${formatIdList(missingOrEmpty.map((e) => e.speciesId))}\n` +
        `  Re-run: npm run seed:locale-names (then npm run seed:split to regenerate shards)`,
    };
  });
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Format a list of IDs for display: show up to 10 inline, then "... and N more".
 *
 * @param {number[]} ids
 * @returns {string}
 */
export function formatIdList(ids) {
  const MAX_INLINE = 10;
  if (ids.length <= MAX_INLINE) {
    return ids.join(", ");
  }
  const shown = ids.slice(0, MAX_INLINE).join(", ");
  return `${shown} ... and ${ids.length - MAX_INLINE} more`;
}
