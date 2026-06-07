# Re-seed runbook

Maintainer checklist for incorporating a new Pokémon generation or newly-added species from PokéAPI.

## Safety assertion (read first)

Re-seeding is **purely additive**. New species are new PokéAPI IDs, which become new `(user_id, card_type, subject_key)` card keys. The process does **not** regress existing `card_reviews` rows, requires **no DB migration**, and pushes nothing to the cloud - there is no #293-class risk. New cards only enter a user's cloud via the normal per-grade sync path the first time they grade them.

## When to re-seed

- The new-species detector issue (#1739) fires, indicating PokéAPI has backfilled a new generation.
- PokéAPI is known to have corrected existing data (renamed species, fixed evolution chains, better official artwork).

## Running the seed

```bash
nvm use                   # pin to the repo's Node major (.nvmrc)
npm run seed:all          # additive default: touches only new species' rows + binaries
npm run seed:all -- --force  # full regenerate: use ONLY when PokéAPI corrected existing data
```

The TTS step requires `GOOGLE_CLOUD_TTS_API_KEY` in the environment or `.env.local`. If the key is absent the orchestrator skips that step with a loud warning and completes the remaining steps normally. Run `npm run seed:tts` separately once the key is available.

Steps run in this order:

1. `seed` - fetches all species from PokéAPI, writes `generated.json`, downloads sprite PNGs and Pokémon-cry audio.
2. `seed:sprites` - converts PNGs to committed WebP variants at every app render size. macOS only (uses `sharp`; runs after `npm ci`).
3. `seed:tts` - generates Google Cloud TTS MP3s under `public/audio/names/`. Skipped if key is absent.
4. `seed:split` - splits `generated.json` into the four committed shards (`generated-core.json`, `generated-chains.json`, `generated-flavor.json`, `generated-locale-names.json`).
5. `generate:scope-lookup` - regenerates `lib/pokemon/scopeLookup.ts` from `generated.json`. Required to avoid `scope-lookup-drift.yml` CI failures.
6. `generate:pseudo-locale` - regenerates `messages/xx-pseudo.json` from `messages/en.json`. Required to avoid `pseudo-locale-drift.yml` / `lint:pseudo-locale` CI failures.

`seed:locale-names` is subsumed by a full `seed`; keep it for a locale-only patch when PokéAPI only corrected names.

## Reviewing the diff

Before committing, check the following in `git diff`:

- **All four shards** contain rows for each new species (`generated-core.json`, `generated-chains.json`, `generated-flavor.json`, `generated-locale-names.json`).
- **Sprite quality**: eyeball the new WebP files; confirm they are the official artwork variant, not placeholder greyscale.
- **Evolution chains**: branching chains (e.g. Eevee's eight branches) are resolved correctly with no orphan `pokemonChain` hashes.
- **Locale names**: every new species has non-placeholder, non-English-leak names in `ja`, `zh-Hans`, and `zh-Hant` in `generated-locale-names.json`.
- **Flavour text**: new species entries in `generated-flavor.json` contain at least one flavour text string.
- **Derived artefacts regenerated**: `lib/pokemon/scopeLookup.ts` and `messages/xx-pseudo.json` show diffs consistent with the new species count.

## Perf-budget re-check

Each new generation enlarges every shard and the WebKit JSON-parse budget. The #1234 incident traced a 2.96 MB bottleneck to this path. After the seed:

```bash
npm run check:bundle      # or trigger perf-budget.yml in CI
```

Note the tie to #1604 (async seed loading). If any shard's parse time regresses the WebKit budget, that issue is the next step.

## Test and locale coverage

- Add any new species to existing locale-rendering or species-count assertions in unit tests.
- Watch for `\d+`-style regex assertions that may break if a localised number gains digit-grouping separators (#1408).

## Committing and deploying

Open a single PR targeting `qa`. Commit the binary artefacts (WebP sprites, MP3 audio, generated JSON shards) alongside the source changes. Include "additive, no migration" in the PR body to signal to reviewers that no schema change is needed.

Sprite and screenshot regeneration are macOS-only steps. CI does not regenerate them (Linux font anti-aliasing differs); run `npm run screenshots` locally for any surface the new species affects.
