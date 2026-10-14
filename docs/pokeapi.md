# PokéAPI integration

Moved out of `AGENTS.md` (2026-10-14). Re-seeding runbook: [reseed.md](reseed.md).

- **Seed at build time, not request time.** A one-off seed script fetches `/pokemon-species` (master list) → `/pokemon/{id}` (sprites) → `/pokemon-species/{id}` (display name + chain URL) → `/evolution-chain/{id}` (deduped) into a local store. The Pokédex never hits PokéAPI at runtime.
- **Canonical set is `/pokemon-species`** (~1025 species), not `/pokemon` (~1300+ incl. Megas/regional/Gigantamax at IDs 10001+). Resolve each species to `varieties[0]`.
- **Display name** is `pokemon-species.names[]` filtered to `language.name === "en"`. The `/pokemon` `name` field is a kebab-case slug.
- **Default sprite**: `sprites.other["official-artwork"].front_default`, falling back to `sprites.front_default`. Sprites self-hosted under `public/sprites/pokemon/`.
- **Evolution chains are trees** - `evolves_to[]` may branch (Eevee → 8). Walk recursively.
- **Rate limit** ~100/min: cap concurrency at ~20–30, don't aggressively retry on 429.
- **Re-seeding a new generation**: `npm run seed:all` (additive default). Full runbook in **[docs/reseed.md](docs/reseed.md)**.
