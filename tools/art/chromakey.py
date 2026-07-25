#!/usr/bin/env python3
"""Poké Memory badge chroma-key (#831): green-screen render -> transparent PNG.

`generate.py` produces flat single-subject 8-bit badge art on a solid chroma-green background so
the medallion can be lifted onto transparency for in-app use. This module makes that lift a
repeatable, testable step (adapted from the sibling koinori repo's `tools/art/chromakey.py`, kept
self-contained here so poke-memory has no runtime or build-time dependency on that repo).

Approach (why these choices):
- Key on COLOUR DISTANCE, not exact RGB match, so anti-aliased edge pixels (a blend of subject +
  screen) get a PARTIAL alpha rather than a hard in/out cut - a clean, non-jagged edge.
- DESPILL the kept pixels: the screen colour bleeds a green rim onto the subject, so we pull that
  channel back towards the other two on near-edge pixels (classic green-screen despill).
- A small alpha erode + feather removes the 1px fringe and softens the matte.
- Optional final resize with NEAREST resampling (never bilinear/bicubic) so the 8-bit pixel-art
  edges stay crisp rather than blurring into anti-aliased grey - the whole point of the style.

Alpha-sanity guard: `assert_has_transparency` (run by the CLI by default) FAILS if the output has
no transparent pixels at all, which would mean the chroma-key did nothing and the badge would
render on an opaque green box.

CLI:
    tools/art/.venv/bin/python3 tools/art/chromakey.py in.png out.png \
        [--key green|magenta|RRGGBB] [--threshold 0.18] [--softness 0.08] \
        [--despill 1.0] [--erode 1] [--feather 1.0] [--resize 128] [--no-sanity]

Importable:
    from chromakey import chroma_key, assert_has_transparency
    chroma_key("in.png", "out.png", key="green", resize=128)
"""
from __future__ import annotations

import argparse
import sys

import numpy as np
from PIL import Image, ImageFilter

# Named chroma screens we generate against. Values are the nominal screen RGB (0-255).
NAMED_KEYS: dict[str, tuple[int, int, int]] = {
    "green": (0, 177, 64),    # standard chroma green
    "magenta": (255, 0, 255),  # fallback when the subject contains green
}

# Per-key default colour-distance threshold. The API does not reliably render a pure, saturated
# magenta backdrop (it tends to come back as a muted ~(205, 30, 183) rather than (255, 0, 255)),
# which sits further from the nominal magenta key than a typical green render sits from the
# nominal green key. Using the green default (0.18) on a magenta render leaves the background at
# a partial alpha (a visible magenta tint) instead of fully transparent - found while fixing #831's
# starter-badge leaves. Verified against the badge set's own artwork (leaf/flame/water-droplet
# colours) staying well outside this band, so raising it does not eat legitimate subject pixels.
DEFAULT_THRESHOLD: dict[str, float] = {"green": 0.18, "magenta": 0.24}


def _parse_key(key: str) -> tuple[int, int, int]:
    """Resolve a key name ('green'/'magenta') or a 6-hex 'RRGGBB' to an (r, g, b) tuple."""
    k = key.strip().lower().lstrip("#")
    if k in NAMED_KEYS:
        return NAMED_KEYS[k]
    if len(k) == 6:
        return (int(k[0:2], 16), int(k[2:4], 16), int(k[4:6], 16))
    raise ValueError(f"unknown key {key!r}: use 'green', 'magenta' or an RRGGBB hex")


def _alpha_min(img: Image.Image) -> int:
    """Smallest alpha value in an RGBA image (0 means at least one fully transparent pixel)."""
    if img.mode != "RGBA":
        return 255
    return int(np.asarray(img)[..., 3].min())


_CORNER_ALPHA_MAX = 10  # a genuinely-keyed corner should be all but fully transparent
_MIN_TRANSPARENT_FRACTION = 0.02  # at least 2% of the image should be true background (alpha<=CORNER_ALPHA_MAX)


def assert_has_transparency(img: Image.Image, *, source: str = "output") -> None:
    """Raise if `img` doesn't have a genuinely-transparent background (the white/green-box guard).

    Two checks, because a single alpha-minimum check missed a real regression (#831 starter-badge
    magenta background left the whole background at a partial ~90 alpha rather than 0 - the key
    matched *some* pixels but not fully, so `alpha.min() < 255` alone passed while the badge still
    shipped with a visible tinted background):

    1. Alpha minimum below full-opaque - a correct chroma-key MUST punch some pixels fully out, so
       an alpha minimum of 255 means the key did nothing.
    2. The four corners (background territory on every centred-medallion badge in this set) are
       near-zero alpha, AND at least a small fraction of the whole image is near-zero alpha - not
       just "the darkest pixel happens to be under 255", which a wrongly-thresholded key still
       satisfies.

    Fail loudly rather than ship a translucent-background badge.
    """
    amin = _alpha_min(img)
    if amin >= 255:
        raise ValueError(
            f"{source} has a fully-opaque alpha channel (alpha min == {amin}); chroma-key produced "
            "NO transparency. Check the --key / --threshold for this image.")

    if img.mode != "RGBA":
        return
    arr = np.asarray(img)
    alpha = arr[..., 3]
    h, w = alpha.shape
    corners = [alpha[0, 0], alpha[0, w - 1], alpha[h - 1, 0], alpha[h - 1, w - 1]]
    bad_corners = [int(a) for a in corners if a > _CORNER_ALPHA_MAX]
    if bad_corners:
        raise ValueError(
            f"{source} has non-transparent corner pixel(s) (alpha={bad_corners}, want <= "
            f"{_CORNER_ALPHA_MAX}); the background was only partially keyed out (a visible tint "
            "would ship). Check the --key / --threshold for this image.")

    transparent_fraction = float((alpha <= _CORNER_ALPHA_MAX).mean())
    if transparent_fraction < _MIN_TRANSPARENT_FRACTION:
        raise ValueError(
            f"{source} has only {transparent_fraction:.1%} near-zero-alpha background pixels "
            f"(want >= {_MIN_TRANSPARENT_FRACTION:.0%}); the chroma-key barely punched through. "
            "Check the --key / --threshold for this image.")


def chroma_key(in_path: str, out_path: str, *, key: str = "green",
               threshold: float | None = None, softness: float = 0.08,
               despill: float = 1.0, erode: int = 1, feather: float = 1.0,
               resize: int | None = None, sanity_check: bool = True) -> str:
    """Lift the subject off a chroma screen and write a transparent PNG. Returns out_path.

    threshold: colour-distance (0-1) at/under which a pixel is fully keyed-out (transparent).
               Defaults to `DEFAULT_THRESHOLD[key]` when not given (0.18 for green, 0.24 for
               magenta - the API's magenta renders are less saturated than its greens).
    softness:  distance band above the threshold over which alpha ramps 0->255 (the soft edge).
    despill:   0-1 strength of pulling the screen channel back on kept pixels (rim de-greening).
    erode:     pixels of alpha erosion to bite off the last screen fringe (0 to disable).
    feather:   gaussian blur radius applied to the alpha matte (0 to disable).
    resize:    if set, the final square size in px (NEAREST resampling, keeps pixel-art crisp).
    """
    key_rgb = np.array(_parse_key(key), dtype=np.float32)
    if threshold is None:
        threshold = DEFAULT_THRESHOLD.get(key.strip().lower(), 0.18)
    src = Image.open(in_path).convert("RGBA")
    arr = np.asarray(src, dtype=np.float32)
    rgb = arr[..., :3]

    # Colour distance to the screen, normalised so 1.0 is "as far as a pure-opposite colour can be".
    dist = np.linalg.norm(rgb - key_rgb, axis=-1) / np.sqrt(3 * 255.0**2)

    # Alpha ramp: <=threshold -> 0 (screen), >=threshold+softness -> 1 (subject), linear between.
    soft = max(softness, 1e-6)
    alpha = np.clip((dist - threshold) / soft, 0.0, 1.0)

    # Despill: on partially-keyed (rim) pixels, the screen channel is inflated. Pull the dominant
    # screen channel down towards the mean of the other two, scaled by how rim-like the pixel is.
    if despill > 0:
        screen_chan = int(np.argmax(key_rgb))  # 1 for green, 0/2 for magenta's r/b
        others = [c for c in range(3) if c != screen_chan]
        cap = (rgb[..., others[0]] + rgb[..., others[1]]) / 2.0
        rim = (1.0 - alpha) * float(np.clip(despill, 0.0, 1.0))  # strongest where alpha is low
        chan = rgb[..., screen_chan]
        rgb[..., screen_chan] = np.where(chan > cap, chan + (cap - chan) * rim, chan)

    out = np.empty_like(arr)
    out[..., :3] = rgb
    out[..., 3] = alpha * 255.0
    result = Image.fromarray(np.clip(out, 0, 255).astype(np.uint8), mode="RGBA")

    # Erode the matte to remove the 1px screen fringe, then feather for a soft edge.
    if erode > 0:
        a = result.getchannel("A")
        for _ in range(int(erode)):
            a = a.filter(ImageFilter.MinFilter(3))
        result.putalpha(a)
    if feather > 0:
        a = result.getchannel("A").filter(ImageFilter.GaussianBlur(float(feather)))
        result.putalpha(a)

    if sanity_check:
        assert_has_transparency(result, source=out_path)

    if resize:
        # Centre-crop to square first in case the source render came back non-square (the API
        # does not always honour a 1:1 request), so the badge shape is never stretched. NEAREST
        # keeps hard pixel-art edges crisp; any smoothing resampler would blur the style.
        w, h = result.size
        if w != h:
            side = min(w, h)
            left = (w - side) // 2
            top = (h - side) // 2
            result = result.crop((left, top, left + side, top + side))
        result = result.resize((resize, resize), Image.NEAREST)

    result.save(out_path)
    return out_path


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Chroma-key a green/magenta screen to transparency.")
    ap.add_argument("in_path")
    ap.add_argument("out_path")
    ap.add_argument("--key", default="green", help="green | magenta | RRGGBB hex")
    ap.add_argument("--threshold", type=float, default=None,
                     help="colour-distance threshold; defaults to DEFAULT_THRESHOLD[key] (0.18 green, 0.24 magenta)")
    ap.add_argument("--softness", type=float, default=0.08)
    ap.add_argument("--despill", type=float, default=1.0)
    ap.add_argument("--erode", type=int, default=1)
    ap.add_argument("--feather", type=float, default=1.0)
    ap.add_argument("--resize", type=int, default=None, help="final square size in px (NEAREST)")
    ap.add_argument("--no-sanity", action="store_true", help="skip the transparency sanity check")
    args = ap.parse_args(argv)
    path = chroma_key(args.in_path, args.out_path, key=args.key, threshold=args.threshold,
                      softness=args.softness, despill=args.despill, erode=args.erode,
                      feather=args.feather, resize=args.resize, sanity_check=not args.no_sanity)
    print("wrote", path)
    return 0


if __name__ == "__main__":
    sys.exit(main())
