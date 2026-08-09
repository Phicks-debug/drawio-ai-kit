#!/usr/bin/env python3.12
"""
ingest_index.py — generate catalog/aws.json from the shape-index ground truth.

Source: data/shape-index.json.gz (vendored from jgraph/drawio-mcp, Apache-2.0) —
each entry is {style, w, h, title, tags, type} for one shape in the draw.io palette.

We filter out the AWS family (mxgraph.aws4) and emit a catalog using the style
VERBATIM (already includes points[], the correct palette fillColor, aspect=fixed)
— without building styles ourselves or guessing names, eliminating the root cause
of "empty icon" errors.

Run: python3.12 scripts/ingest_index.py   (stdlib only)
"""
from __future__ import annotations

import gzip
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
INDEX = ROOT / "data" / "shape-index.json.gz"
OUT = ROOT / "catalog" / "aws.json"

RES_RE = re.compile(r"resIcon=mxgraph\.aws4\.([a-zA-Z0-9_]+)")
GR_RE = re.compile(r"grIcon=mxgraph\.aws4\.([a-zA-Z0-9_]+)")
SHAPE_RE = re.compile(r"shape=mxgraph\.aws4\.([a-zA-Z0-9_]+)")
FILL_RE = re.compile(r"fillColor=([^;]+)")
SKIP_SHAPE = {"resourceIcon", "productIcon", "groupCenter", "group"}

# official fillColor -> category (best-effort; some colors are shared across groups).
COLOR_CATEGORY = {
    "#ED7100": "Compute",
    "#E7157B": "Management",
    "#7AA116": "Storage",
    "#C925D1": "Database",
    "#8C4FFF": "Networking/Analytics",
    "#DD344C": "Security",
    "#01A88D": "Migration/ML",
    "#2E27AD": "Networking",
    "#4D27AA": "Networking",
    "#232F3D": "General",
    "#232F3E": "General",
    "#5294CF": "General",
    "#3334B9": "Application Integration",
}


def clean_title(t: str) -> str:
    return (t or "").strip()


def category_for(color: str | None) -> str:
    if not color:
        return "General"
    return COLOR_CATEGORY.get(color.upper(), "General")


def main() -> None:
    raw = json.loads(gzip.open(INDEX, "rt", encoding="utf-8").read())
    icons: dict[str, dict] = {}
    groups: dict[str, dict] = {}

    for e in raw:
        style = e.get("style", "")
        if "mxgraph.aws4" not in style:
            continue
        res = RES_RE.search(style)
        gr = GR_RE.search(style)
        shp = SHAPE_RE.search(style)
        fill = FILL_RE.search(style)
        color = fill.group(1).strip() if fill else None
        title = clean_title(e.get("title"))
        tags = clean_title(e.get("tags"))
        w = e.get("w", 48)
        h = e.get("h", 48)

        if gr:  # group frame: name is in grIcon
            name = gr.group(1)
            if name not in groups:
                groups[name] = {
                    "name": name, "label": title or name,
                    "category": "Group", "color": color, "w": w, "h": h,
                    "tags": tags, "style": style,
                }
            continue

        if res:  # resourceIcon: the service name is in resIcon
            name = res.group(1)
            entry = {
                "name": name,
                "label": title or name,
                "category": category_for(color),
                "color": color,
                "w": w, "h": h,
                "tags": tags,
                "style": style,
            }
            # prefer the entry with more connection points (points=) — cleaner and connects better
            if name not in icons or ("points=" in style and "points=" not in icons[name]["style"]):
                icons[name] = entry
            continue

        if shp:
            tok = shp.group(1)
            if tok in SKIP_SHAPE:
                continue
            target = groups if tok.startswith("group") else icons
            if tok not in target:
                target[tok] = {
                    "name": tok,
                    "label": title or tok,
                    "category": category_for(color),
                    "color": color,
                    "w": w, "h": h,
                    "tags": tags,
                    "style": style,
                }

    catalog = {
        "meta": {
            "family": "mxgraph.aws4",
            "source": "Generated from data/shape-index.json.gz (jgraph/drawio-mcp, Apache-2.0) — styles verbatim.",
            "incomplete": False,
            "generator": "scripts/ingest_index.py",
        },
        "categoryColors": {
            "Compute": "#ED7100", "Containers": "#ED7100", "Storage": "#7AA116",
            "Database": "#C925D1", "Networking/Analytics": "#8C4FFF", "Networking": "#8C4FFF",
            "Security": "#DD344C", "Management": "#E7157B", "Application Integration": "#E7157B",
            "Migration/ML": "#01A88D", "General": "#232F3E",
        },
        "groups": sorted(groups.values(), key=lambda x: x["name"]),
        "icons": sorted(icons.values(), key=lambda x: x["name"]),
    }
    OUT.write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {OUT}")
    print(f"  icons: {len(catalog['icons'])} | groups: {len(catalog['groups'])}")
    # sanity: a few commonly used names
    for k in ("s3", "eks", "identity_and_access_management", "elasticsearch_service", "datasync", "redshift"):
        print(f"    {k:35} -> {'OK' if k in icons else 'MISSING'}")


if __name__ == "__main__":
    main()
