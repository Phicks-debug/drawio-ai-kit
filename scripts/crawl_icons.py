#!/usr/bin/env python3.12
"""
crawl_icons.py — generate/validate the draw.io stencil catalog from official sources.

Roles (per the repo design):
  - Node 26  : serves the AI side (MCP server, CLI, validator)
  - Python 3.11: crawls & "cooks" data (catalog of stencil names + base64 OSS icons)

Modes:
  --mode names   (default) Extract mxgraph.aws4.* stencil NAMES from the draw.io
                 source (ground truth) -> merge into catalog/aws.json, set incomplete=false.
  --mode base64  Crawl OSS/internal icons (SVG) from a directory/URL -> catalog/custom-icons.json
                 as base64 data URIs to embed shape=image into draw.io.

Requirements: Python 3.11+ (standard library only: urllib, json, base64, argparse, re).
"""
from __future__ import annotations

import argparse
import base64
import json
import re
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CATALOG = ROOT / "catalog" / "aws.json"
CUSTOM = ROOT / "catalog" / "custom-icons.json"

# Ground-truth source: draw.io's AWS4 sidebar definition (Apache-2.0).
DRAWIO_AWS4_SOURCES = [
    "https://raw.githubusercontent.com/jgraph/drawio/dev/src/main/webapp/js/diagramly/sidebar/Sidebar-AWS4.js",
]

STENCIL_RE = re.compile(r"mxgraph\.aws4\.([a-z0-9_]+)")
GROUP_RE = re.compile(r"mxgraph\.aws4\.(group_[a-z0-9_]+)")
# skip the "shape words" that are not service names
SKIP = {"resourceIcon", "productIcon", "group", "groupCenter", "resourceIcon2"}


def fetch(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": "drawio-ai-kit/0.1"})
    with urllib.request.urlopen(req, timeout=30) as r:  # noqa: S310 (fixed, trusted source)
        return r.read().decode("utf-8", errors="replace")


def crawl_names() -> dict:
    found: set[str] = set()
    groups: set[str] = set()
    errors: list[str] = []
    for url in DRAWIO_AWS4_SOURCES:
        try:
            txt = fetch(url)
        except Exception as e:  # noqa: BLE001
            errors.append(f"{url}: {e}")
            continue
        for m in STENCIL_RE.findall(txt):
            if m in SKIP:
                continue
            (groups if m.startswith("group_") else found).add(m)
    return {"icons": sorted(found), "groups": sorted(groups), "errors": errors}


def merge_names(dry_run: bool = False) -> None:
    data = json.loads(CATALOG.read_text(encoding="utf-8"))
    existing = {i["name"]: i for i in data.get("icons", [])}
    existing_g = {g["name"]: g for g in data.get("groups", [])}

    crawled = crawl_names()
    if crawled["errors"]:
        print("WARNING while crawling:", *crawled["errors"], sep="\n  ", file=sys.stderr)
    if not crawled["icons"]:
        print("No names extracted — check the network/source URL.", file=sys.stderr)
        sys.exit(1)

    added = 0
    for name in crawled["icons"]:
        if name not in existing:
            existing[name] = {"name": name, "label": name, "category": "General",
                              "aliases": [], "keywords": name.split("_")}
            added += 1
    added_g = 0
    for name in crawled["groups"]:
        if name not in existing_g:
            existing_g[name] = {"name": name, "label": name, "stroke": "#232F3E", "dashed": False}
            added_g += 1

    data["icons"] = sorted(existing.values(), key=lambda x: x["name"])
    data["groups"] = sorted(existing_g.values(), key=lambda x: x["name"])
    data.setdefault("meta", {})
    data["meta"]["incomplete"] = False
    data["meta"]["source"] = "Merged from jgraph/drawio Sidebar-AWS4.js (Apache-2.0)"

    print(f"Total icons: {len(data['icons'])} (+{added} new), groups: {len(data['groups'])} (+{added_g} new)")
    if dry_run:
        print("[dry-run] file not written.")
        return
    CATALOG.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {CATALOG}")
    print("Note: new icons default to category/color 'General' — add a classification if needed.")


def crawl_base64(src: str) -> None:
    """Read the .svg files in directory `src`, base64-encode them -> custom-icons.json (data URI)."""
    srcdir = Path(src)
    if not srcdir.is_dir():
        print(f"Not a directory: {src}", file=sys.stderr)
        sys.exit(1)
    out = {"meta": {"encoding": "data-uri-svg-base64",
                    "usage": "shape=image;image=<dataUri>;verticalLabelPosition=bottom;verticalAlign=top;"},
           "icons": []}
    for svg in sorted(srcdir.rglob("*.svg")):
        raw = svg.read_bytes()
        b64 = base64.b64encode(raw).decode("ascii")
        out["icons"].append({
            "name": svg.stem.lower().replace(" ", "_"),
            "label": svg.stem,
            "category": svg.parent.name,
            "dataUri": f"data:image/svg+xml;base64,{b64}",
        })
    CUSTOM.write_text(json.dumps(out, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {len(out['icons'])} base64 icons -> {CUSTOM}")
    print("LICENSE NOTE: review the terms before redistributing third-party icons.")


def main() -> None:
    ap = argparse.ArgumentParser(description="Generate/validate the draw.io stencil catalog.")
    ap.add_argument("--mode", choices=["names", "base64"], default="names")
    ap.add_argument("--src", help="Directory containing .svg files (for --mode base64).")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    if args.mode == "names":
        merge_names(dry_run=args.dry_run)
    else:
        if not args.src:
            ap.error("--mode base64 requires --src <svg directory>")
        crawl_base64(args.src)


if __name__ == "__main__":
    main()
