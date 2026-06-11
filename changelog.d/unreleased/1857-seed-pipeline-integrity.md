---
kind: fixed
issue: 1857
---
- Seed pipeline: `flattenChain` now picks the region-tagged evolution detail (fixing silent omission of Alolan, Galarian, Hisuian, and Paldean form-aware evolution edges); `buildVarietiesLookup` keys by regional prefix so multi-segment slugs (e.g. "galar-standard") resolve correctly.
- Seed pipeline: a failed evolution-chain fetch now exits the seed run immediately rather than persisting an empty chain; `validateShards` asserts at least one form-aware edge (id > 10000) and, when prior chain data is supplied, that no previously non-empty chain has become empty.
- Seed pipeline: 429 rate-limit responses are now retried with backoff (previously immediately fatal, causing silent species drops); `validateSpeciesIds` checks set membership so a dropped species is detected even when new species arrive in the same run.
- Seed pipeline: `writeSplitSeedFiles` now writes `generated-core.json` and `generated-chains.json` to `public/pokemon-data/` as well as `lib/pokemon/` (mirroring the existing flavor/locale-names dual-write); `validateShardParity` asserts byte-equality of all four shards between both directories.
- Seed validator: flavour-shard check now only requires records with non-empty `flavorTexts` in `generated.json` to appear in the shard, preventing a false-positive failure on freshly-backfilled flavourless species.
