#!/usr/bin/env python3
"""Poké Memory AI art generator (#831 gym-badge pixel art pipeline).

A thin, reusable wrapper over Google's Nano Banana Pro (gemini-3-pro-image) that bakes a shared
8-bit pixel-art STYLE_PREAMBLE into every prompt, so generated badge assets stay visually
consistent as a set. Self-contained: does not import from or depend on any other repo's art
pipeline at runtime.

Key: read from the path in the `POKE_MEMORY_GEMINI_API_KEY_PATH` env var if set, otherwise fall
back to `~/.config/koinori/gemini-api-key` (gitignored, never committed - this repo does not ship
its own key file, so point the env var at your own key for a from-scratch setup). The key itself
is NEVER printed, copied, or committed.

CLI:
    python3 tools/art/generate.py "<prompt>" out.png [--ref a.png --ref b.png] [--model gemini-3-pro-image]

Importable:
    from generate import generate
    generate("a chunky 8-bit rock, ...", "tools/art/out/x.png")
"""
from __future__ import annotations

import argparse
import base64
import json
import mimetypes
import os
import sys
import urllib.error
import urllib.request

# Fallback key path - shared with the sibling koinori repo's pipeline purely as a convenience
# default for this maintainer's machine. A future contributor should set the env var below to
# point at their own key; poke-memory does not depend on koinori at runtime or build time.
DEFAULT_KEY_PATH = os.path.expanduser("~/.config/koinori/gemini-api-key")
KEY_PATH = os.environ.get("POKE_MEMORY_GEMINI_API_KEY_PATH", DEFAULT_KEY_PATH)
DEFAULT_MODEL = "gemini-3-pro-image"  # Nano Banana Pro

# Prepended to every prompt so the full 17-badge set shares one readable, consistent pixel-art
# look. Kept in lockstep with README.md's style notes.
STYLE_PREAMBLE = (
    "Poke Memory gym-badge icon, true 8-bit / 16-bit retro pixel-art style: hard pixel edges, no "
    "anti-aliasing, no gradients, limited flat colour palette per icon, strong black or dark "
    "outline around every shape so the icon stays readable at small sizes (it renders as small as "
    "40x40 CSS pixels in the app). Compose as a single chunky badge/medallion emblem, centred, "
    "filling most of the frame, in the classic circular-pin gym-badge silhouette (a simple "
    "geometric medallion, star-points or gem-cut edge, NOT a photo-real object). Palette: warm "
    "saturated jewel tones (this badge's own theme colour) with a metallic gold or silver rim "
    "highlight, consistent line weight across the whole set. Absolutely NO text, letters or "
    "numbers in the image. Background is a solid flat chroma-key green (#00B140), completely "
    "uniform, no shading, no texture, no vignette, filling every pixel outside the badge shape "
    "edge to edge, so the background can be keyed out to transparency afterwards. "
)


def _api_key() -> str:
    try:
        with open(KEY_PATH, encoding="utf-8") as f:
            return f.read().strip()
    except FileNotFoundError as e:
        raise RuntimeError(
            f"no Gemini API key found at {KEY_PATH!r}. Set POKE_MEMORY_GEMINI_API_KEY_PATH to "
            "your own key file, or place one at the fallback path documented in README.md."
        ) from e


def generate(prompt: str, out_path: str, refs: list[str] | None = None,
             model: str = DEFAULT_MODEL, with_style: bool = True,
             aspect: str | None = None, size: str | None = None) -> str:
    """Generate one image to out_path. `refs` are reference/edit input images (paths). Returns out_path.

    `aspect` sets the output aspect ratio ("1:1", "16:9", "9:16", "4:3", "3:4", "21:9"). `size` sets
    the resolution ("1K", "2K", "4K"). Badge art defaults to a 1:1 square medallion; without an
    explicit aspect the API returns a 1:1 1024px square by default anyway, so badges rarely need
    to pass either flag.
    """
    parts: list[dict] = []
    for ref in refs or []:
        mime = mimetypes.guess_type(ref)[0] or "image/png"
        parts.append({"inlineData": {"mimeType": mime,
                                     "data": base64.b64encode(open(ref, "rb").read()).decode()}})
    parts.append({"text": (STYLE_PREAMBLE + prompt) if with_style else prompt})

    gen_config: dict = {"responseModalities": ["IMAGE"]}
    image_config: dict = {}
    if aspect:
        image_config["aspectRatio"] = aspect
    if size:
        image_config["imageSize"] = size
    if image_config:
        gen_config["imageConfig"] = image_config

    body = {"contents": [{"parts": parts}], "generationConfig": gen_config}
    req = urllib.request.Request(
        f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={_api_key()}",
        data=json.dumps(body).encode(), headers={"Content-Type": "application/json"})
    try:
        resp = json.load(urllib.request.urlopen(req, timeout=180))
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"image API HTTP {e.code}: {e.read().decode()[:400]}") from e

    for cand in resp.get("candidates", []):
        for part in cand.get("content", {}).get("parts", []):
            inline = part.get("inlineData") or part.get("inline_data")
            if inline and inline.get("data"):
                with open(out_path, "wb") as f:
                    f.write(base64.b64decode(inline["data"]))
                return out_path
    raise RuntimeError(f"no image in response: {json.dumps(resp)[:400]}")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Generate a Poke Memory badge asset with Nano Banana Pro.")
    ap.add_argument("prompt")
    ap.add_argument("out")
    ap.add_argument("--ref", action="append", default=[], help="reference/edit input image (repeatable)")
    ap.add_argument("--model", default=DEFAULT_MODEL)
    ap.add_argument("--no-style", action="store_true", help="do not prepend the badge style preamble")
    ap.add_argument("--aspect", help='output aspect ratio: 1:1, 16:9, 9:16, 4:3, 3:4, 21:9 (default 1:1)')
    ap.add_argument("--size", help='output resolution: 1K, 2K, 4K (default 1K)')
    args = ap.parse_args(argv)
    path = generate(args.prompt, args.out, refs=args.ref, model=args.model,
                    with_style=not args.no_style, aspect=args.aspect, size=args.size)
    print("wrote", path)
    return 0


if __name__ == "__main__":
    sys.exit(main())
