# Poké Memory badge art pipeline (`tools/art/`)

The repeatable pipeline for the 8-bit gym-badge medallion artwork (#831). Generates pixel-art
badges on a chroma-green background, lifts them to transparent PNGs, and can regenerate the whole
17-badge set from one manifest.

**Self-contained.** This pipeline was adapted from a similar tool in a sibling repo but does not
import from or depend on it at runtime or build time - poke-memory owns its own copy.

Final assets ship at `public/badges/<id>.png` and are referenced from `lib/badges/catalog.ts` via
`badgeArtworkSrc(id)` in `lib/badges/artwork.ts`.

## Setup

`generate.py` is pure stdlib (it only needs the Gemini key). `chromakey.py` and `batch.py` need
Pillow + numpy, so they use a local venv (gitignored):

```sh
python3 -m venv tools/art/.venv
tools/art/.venv/bin/python3 -m pip install Pillow numpy
```

The image generator reads the API key from the path in the `POKE_MEMORY_GEMINI_API_KEY_PATH` env
var if set, otherwise falls back to `~/.config/koinori/gemini-api-key` (a convenience default for
this maintainer's machine, not a poke-memory-owned key file - gitignored, NEVER committed). A
future contributor without access to that path should set the env var to point at their own
Gemini API key file, e.g.:

```sh
export POKE_MEMORY_GEMINI_API_KEY_PATH=~/.config/poke-memory/gemini-api-key
```

## Modules

- **`generate.py`** - Nano Banana Pro (`gemini-3-pro-image`) wrapper. Bakes a shared 8-bit
  pixel-art `STYLE_PREAMBLE` into every prompt (hard pixel edges, no anti-aliasing, flat chunky
  medallion silhouette, solid chroma-green background) so the 17-badge set reads as one
  consistent family. Stdlib only.
- **`chromakey.py`** - green-screen render -> transparent PNG, with soft edges, despill, and a
  transparency sanity guard that FAILS if the output has no transparent pixels (a chroma-key that
  did nothing would ship a badge on an opaque green box). Also centre-crops to square and, when
  `--resize` is given, downsamples with NEAREST resampling so the pixel-art edges stay crisp
  (any smoothing resampler would blur the style).
- **`batch.py`** - regenerate a named badge set from a JSON manifest in one command: generate +
  chroma-key each entry, writing straight to `public/badges/`. `--dry-run` prints the plan without
  calling the API. `--only id1,id2` regenerates a subset.
- **`manifests/gym-badges.json`** - the ratified 17-badge manifest: one prompt per badge, matched
  to what each badge represents in `lib/badges/catalog.ts` (the 8 Kanto gym-leader badges use an
  octagonal medallion silhouette; the 9 themed/legendary/starter badges use a circular medallion
  silhouette, so the two families read as visually distinct groups).

## Common commands

```sh
PY=tools/art/.venv/bin/python3

# Generate one raw asset (stdlib; the system python is fine too). Always pass --aspect 1:1 for
# badges - the API does not reliably default to a square frame without it.
python3 tools/art/generate.py "a chunky pixel-art rock badge..." tools/art/out/x.raw.png --aspect 1:1

# Lift a green-screen render to a transparent, size-locked sprite (sanity-checked).
$PY tools/art/chromakey.py tools/art/out/x.raw.png public/badges/x.png --resize 128

# Regenerate the whole 17-badge set (dry-run first to inspect the plan).
$PY tools/art/batch.py tools/art/manifests/gym-badges.json --dry-run
$PY tools/art/batch.py tools/art/manifests/gym-badges.json

# Regenerate just one or two badges.
$PY tools/art/batch.py tools/art/manifests/gym-badges.json --only boulder-badge,cascade-badge
```

## Adding a new badge

1. Add the new `BadgeDefinition` entry to `lib/badges/catalog.ts` (it will call
   `badgeArtworkSrc(id)` for its `artwork` field, following the existing entries).
2. Add a matching entry to `tools/art/manifests/gym-badges.json` with a prompt describing the
   badge's theme (colour palette, central icon, medallion silhouette family).
3. Run `batch.py --only <new-id>` to generate just that badge.
4. Eyeball the result (against both a light and dark background) before committing - confirm it
   reads clearly at 40px, has real transparency, and fits the existing palette family.

## Tuning notes (found during #831)

- The API does not reliably return a square image by default - always pass `aspect="1:1"` /
  `--aspect 1:1`, and `chromakey.py`'s resize step centre-crops to square as a safety net in case
  a render still comes back non-square.
- The upstream koinori pipeline's default chroma-key `threshold`/`softness` (tuned for that
  repo's warm koi-orange/teal brand palette) incorrectly punched large transparent holes through
  this badge set's muted brown/grey/purple tones (their colour-distance to pure chroma-green was
  smaller than expected). `chromakey.py` here defaults to `threshold=0.18`, `softness=0.08`,
  verified against the full 17-badge set (every asset passes the transparency sanity check with a
  believable opaque-interior / transparent-background split).
