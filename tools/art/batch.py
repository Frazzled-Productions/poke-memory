#!/usr/bin/env python3
"""Regenerate a Poké Memory badge asset set from a JSON manifest (#831).

Reads a manifest (see `manifests/gym-badges.json`) and, for each asset, generates a raw
chroma-green render via `generate.py`, then lifts it to a transparent, size-locked PNG via
`chromakey.py`. Writes directly to `public/badges/<id>.png` by default.

CLI:
    tools/art/.venv/bin/python3 tools/art/batch.py tools/art/manifests/gym-badges.json --dry-run
    tools/art/.venv/bin/python3 tools/art/batch.py tools/art/manifests/gym-badges.json
    tools/art/.venv/bin/python3 tools/art/batch.py tools/art/manifests/gym-badges.json --only boulder-badge,cascade-badge
"""
from __future__ import annotations

import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from chromakey import chroma_key  # noqa: E402
from generate import generate  # noqa: E402

DEFAULT_OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "public", "badges")
DEFAULT_RESIZE = 128


def run(manifest_path: str, out_dir: str = DEFAULT_OUT_DIR, only: set[str] | None = None,
        dry_run: bool = False, resize: int = DEFAULT_RESIZE) -> None:
    with open(manifest_path, encoding="utf-8") as f:
        manifest = json.load(f)

    assets = manifest["assets"]
    if only:
        assets = [a for a in assets if a["id"] in only]
        missing = only - {a["id"] for a in assets}
        if missing:
            raise ValueError(f"--only referenced unknown asset id(s): {sorted(missing)}")

    os.makedirs(out_dir, exist_ok=True)
    raw_dir = os.path.join(os.path.dirname(manifest_path), "..", "out")
    os.makedirs(raw_dir, exist_ok=True)

    for asset in assets:
        asset_id = asset["id"]
        out_path = os.path.join(out_dir, asset["out"])
        raw_path = os.path.join(raw_dir, f"{asset_id}.raw.png")
        if dry_run:
            print(f"[dry-run] {asset_id}: generate -> {raw_path}, chroma-key -> {out_path}")
            continue
        print(f"generating {asset_id} ...")
        generate(asset["prompt"], raw_path, aspect="1:1")
        chroma_key(raw_path, out_path, resize=resize)
        print(f"wrote {out_path}")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Regenerate a badge asset set from a manifest.")
    ap.add_argument("manifest")
    ap.add_argument("--out-dir", default=DEFAULT_OUT_DIR)
    ap.add_argument("--only", help="comma-separated asset ids to regenerate (default: all)")
    ap.add_argument("--resize", type=int, default=DEFAULT_RESIZE)
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args(argv)
    only = set(args.only.split(",")) if args.only else None
    run(args.manifest, out_dir=args.out_dir, only=only, dry_run=args.dry_run, resize=args.resize)
    return 0


if __name__ == "__main__":
    sys.exit(main())
