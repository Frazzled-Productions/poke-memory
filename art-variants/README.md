# Starter badge art variants (#831)

Scratch comparison branch, not a shipping change. `public/badges/kanto-starters.png` and its four
siblings all currently draw the same leaf/flame/water-droplet trio inside a differently-shaped
frame, so every regional starter badge reads as near-identical at a glance. Varying only the frame
and metal tone was tried and rejected, so this compares two directions that vary the *content*
instead.

Both directions share the existing 8-bit pixel-art badge family: same `STYLE_PREAMBLE`, same
128x128 transparent PNG, same medallion-silhouette-per-region convention already used for the
starter badges (plain ring / gear / gem-cut hexagon / sunburst / heraldic shield for Kanto / Johto
/ Hoenn / Sinnoh / Galar) and the same rim-metal palette (gold / silver / bronze / copper /
dark-iron).

## Direction A: the actual starter species (`a-species/`)

Depicts the real starter trio as simplified 8-bit sprites instead of an abstract
leaf/flame/droplet. The point is that a Bulbasaur, a Charmander and a Squirtle (or a penguin, a
rabbit and a gecko) have wildly different silhouettes, so the five badges stop looking
interchangeable. Each sprite is reduced to its boldest shape and a flat colour palette so it stays
readable at the ~40px size the badge renders at in-app.

Three creatures in one small badge is genuinely tight. Kanto and Sinnoh (triangle arrangement) and
Johto and Galar (vertical stack) read clearly; Hoenn's overlapping-cluster arrangement is the
weakest of the five, Torchic's wing get slightly obscured by Treecko's tail where they overlap.
Worth a second look if Direction A is the chosen route.

## Direction B: region motifs, no character likenesses (`b-motifs/`)

Sidesteps the starter-trio problem entirely by not depicting any Pokemon: each badge is the
region's own landmark or emblem instead, so there is no character to compare across regions in the
first place.

- Kanto: the Indigo Plateau
- Johto: the Tin Tower
- Hoenn: sea and volcano
- Sinnoh: Mt Coronet
- Galar: the stadium

These read as place-badges rather than creature-badges, which is a different tone to the rest of
the set (which is otherwise entirely creature/type-themed). Worth weighing whether that tonal shift
is acceptable for just the five starter badges among seventeen.

## How these were made

Regenerated via the `tools/art/` pipeline (checked out here from `feat/831-badge-pixel-art`, not
committed on this branch) against two new manifests:

```sh
PY=tools/art/.venv/bin/python3
$PY tools/art/batch.py tools/art/manifests-variants/direction-a-species.json --out-dir art-variants/a-species
$PY tools/art/batch.py tools/art/manifests-variants/direction-b-motifs.json --out-dir art-variants/b-motifs
```

Both manifests render on a magenta chroma-screen (`"key": "magenta"`) since most of these subjects
contain green (Bulbasaur, Chikorita, Treecko, Turtwig, Grookey, and the Galar stadium pitch), which
a green screen would eat during chroma-keying.
