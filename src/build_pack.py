#!/usr/bin/env python3
"""Manage pack manifests and build base64 icon catalogs.

Each manifest icon resolves a square AWS-style tile one of three ways:
  - "slug": <simple-icons slug>  → monochrome glyph on a brand-colour square (white logo).
  - "url":  <svg url>            → embed the SVG AS-IS (already a coloured logo, e.g. Databricks).
  - neither                      → coloured text tile (fallback) using "abbr" or "label".

icons/*.json packs are merged by core.loadCatalog, so icons become searchable like AWS ones.

Usage:
  python3.12 src/build_pack.py <pack>                      # backward-compatible rebuild
  python3.12 src/build_pack.py build <pack>
  python3.12 src/build_pack.py set <pack> --name NAME [icon fields]
  python3.12 src/build_pack.py remove <pack> --name NAME

`set` adds or updates the manifest entry, rebuilds the catalog, and verifies the
generated icon. Stdlib only.
"""
import argparse, sys, json, base64, re, glob, shutil, subprocess, tempfile, urllib.request
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ICONS = ROOT / "icons"
PACKS = ICONS / "source" / "packs"
SIMPLE_ICONS = "https://raw.githubusercontent.com/simple-icons/simple-icons/develop/icons/{}.svg"
DEVICON = "https://raw.githubusercontent.com/devicons/devicon/master/icons/{n}/{n}-{v}.svg"
STYLE = ("sketch=0;html=1;outlineConnect=0;verticalLabelPosition=bottom;verticalAlign=top;align=center;"
         "fontColor=#232F3E;aspect=fixed;shape=image;image={};")


def fetch(url):
    for _ in range(3):  # retry: simple-icons fetches flake occasionally → don't silently drop a logo
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "drawio-ai-kit"})
            with urllib.request.urlopen(req, timeout=25) as r:  # noqa: S310 (trusted icon sources)
                if r.status == 200:
                    return r.read().decode("utf-8", "replace")
        except Exception:
            pass
    return None


def fg(color):  # readable glyph/text colour for a given tile bg (white on dark, dark on light/yellow)
    c = color.lstrip("#")
    if len(c) != 6:
        return "#ffffff"
    r, g, b = (int(c[i:i + 2], 16) for i in (0, 2, 4))
    lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
    return "#232F3E" if lum > 0.6 else "#ffffff"


def tile_logo(color, paths):  # monochrome glyph (24x24) → contrast-colour on a brand 64x64 tile
    inner = "".join(f'<path d="{d}"/>' for d in paths)
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">'
            f'<rect width="64" height="64" fill="{color}"/>'
            f'<g transform="translate(14 14) scale(1.5)" fill="{fg(color)}">{inner}</g></svg>')


def tile_text(color, text):
    fs = 18 if len(text) <= 3 else (13 if len(text) <= 6 else 10)
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">'
            f'<rect width="64" height="64" fill="{color}"/>'
            f'<text x="32" y="33" font-family="Arial,Helvetica,sans-serif" font-size="{fs}" font-weight="700" '
            f'fill="{fg(color)}" text-anchor="middle" dominant-baseline="central">{text}</text></svg>')


def _inner_and_viewbox(svg):  # split a logo SVG into body + viewBox + namespace decls so it nests in a tile
    m = re.search(r"<svg\b([^>]*)>(.*)</svg>", svg, flags=re.S)
    attrs, body = (m.group(1), m.group(2)) if m else ("", svg)
    vb = re.search(r'viewBox="([^"]+)"', attrs)
    if vb:
        vb = vb.group(1)
    else:
        w, h = re.search(r'\bwidth="([\d.]+)', attrs), re.search(r'\bheight="([\d.]+)', attrs)
        vb = f"0 0 {w.group(1)} {h.group(1)}" if w and h else "0 0 24 24"
    # carry the logo's xmlns:* prefixes (sodipodi/inkscape/dc/rdf/xlink…) onto the nested <svg> — Inkscape
    # / vectorlogo.zone SVGs use them in the body; without the decls the nested XML is malformed (error page).
    ns = " ".join(re.findall(r'xmlns:[\w-]+="[^"]*"', attrs))
    return body, vb, ns


def as_is(svg):  # embed a ready-made (already square / full-bleed) logo; just guarantee namespaces
    head = svg.split(">", 1)[0]
    if "xmlns" not in head:
        svg = svg.replace("<svg", '<svg xmlns="http://www.w3.org/2000/svg"', 1)
    return svg


def tile_framed(logo_svg):  # full-colour logo centred on a white square tile (AWS-style footprint)
    body, vb, ns = _inner_and_viewbox(logo_svg)
    # xmlns:xlink on the wrapper (devicon masks/clips use xlink:href); `ns` carries the logo's own prefixes.
    return ('<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 64 64">'
            '<rect x="0.75" y="0.75" width="62.5" height="62.5" fill="#FFFFFF" stroke="#E1E5EA" stroke-width="1.5"/>'
            f'<svg {ns} x="10" y="10" width="44" height="44" viewBox="{vb}" preserveAspectRatio="xMidYMid meet">{body}</svg>'
            '</svg>')


def png_tile(png_bytes, framed=True):  # a vendored PNG logo centred on a tile (white square if framed)
    b64 = base64.b64encode(png_bytes).decode("ascii")
    rect = ('<rect x="0.75" y="0.75" width="62.5" height="62.5" fill="#FFFFFF" stroke="#E1E5EA" stroke-width="1.5"/>'
            if framed else "")
    x, wh = (10, 44) if framed else (2, 60)
    return ('<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 64 64">'
            f'{rect}<image x="{x}" y="{x}" width="{wh}" height="{wh}" preserveAspectRatio="xMidYMid meet" '
            f'xlink:href="data:image/png;base64,{b64}"/></svg>')


def rasterize(svg, size=256):
    # draw.io's PNG/PDF export does NOT rasterize embedded SVG data-URIs (they render only in the
    # live editor), so bake the tile to PNG first. macOS QuickLook (WebKit) renders SVG paths + text
    # faithfully with zero extra deps. ponytail: macOS-only — on Linux install librsvg + use rsvg-convert.
    if not shutil.which("qlmanage"):
        return None
    with tempfile.TemporaryDirectory() as td:
        (Path(td) / "tile.svg").write_text(svg)
        subprocess.run(["qlmanage", "-t", "-s", str(size), "-o", td, str(Path(td) / "tile.svg")],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        out = glob.glob(str(Path(td) / "*.png"))
        return (Path(out[0])).read_bytes() if out else None


def data_uri(svg):
    # drawio splits style tokens on ";", so the usual "data:image/png;base64," breaks the image=
    # value. drawio's own convention drops ";base64" — "data:image/<type>,<base64>" (comma) — and
    # assumes base64. Match it.
    png = rasterize(svg)
    if png:
        return "data:image/png," + base64.b64encode(png).decode("ascii")
    return "data:image/svg+xml," + base64.b64encode(svg.encode("utf-8")).decode("ascii")


def manifest_path(pack):
    path = PACKS / pack / "manifest.json"
    if not path.is_file():
        raise SystemExit(f"unknown pack {pack!r}: {path} does not exist")
    return path


def read_manifest(pack):
    return json.loads(manifest_path(pack).read_text(encoding="utf-8"))


def write_manifest(pack, manifest):
    manifest_path(pack).write_text(
        json.dumps(manifest, ensure_ascii=False, indent=1) + "\n", encoding="utf-8"
    )


def build(pack):
    man = read_manifest(pack)
    icons = []
    for t in man["icons"]:
        svg = src = None
        # frame:false → embed the logo as-is (for logos that are already a full-bleed square, e.g. ClickHouse)
        wrap = as_is if t.get("frame") is False else tile_framed
        # 0) vendored local asset, highest priority — user-supplied exact logo
        if t.get("file"):
            fp = PACKS / pack / t["file"]
            if fp.exists():
                if fp.suffix.lower() == ".svg":
                    svg, src = wrap(fp.read_text()), "file"
                else:
                    svg, src = png_tile(fp.read_bytes(), framed=t.get("frame") is not False), "file"
        # 1) devicon: authentic full-colour symbol → white square tile (or as-is if frame:false)
        if svg is None and t.get("devicon"):
            for v in ("original", "plain"):
                raw = fetch(DEVICON.format(n=t["devicon"], v=v))
                if raw:
                    svg, src = wrap(raw), "devicon"
                    break
        # 2) explicit full-colour logo URL
        if svg is None and t.get("url"):
            raw = fetch(t["url"])
            if raw:
                svg, src = wrap(raw), "asis"
        # 3) simple-icons monochrome glyph → contrast colour on a brand-colour tile
        if svg is None and t.get("slug"):
            raw = fetch(SIMPLE_ICONS.format(t["slug"]))
            if raw:
                svg, src = tile_logo(t["color"], re.findall(r'<path[^>]*\bd="([^"]+)"', raw)), "logo"
        # 4) coloured text tile (last resort)
        if svg is None:
            svg, src = tile_text(t.get("color", "#5A6B7B"), t.get("abbr", t["label"])), "text"
        icons.append({
            "name": t["name"], "label": t["label"], "category": t.get("category", man.get("category", "Big Data")),
            "color": t.get("color", "#5A6B7B"), "w": 48, "h": 48,
            "tags": t.get("tags", t["label"].lower()), "style": STYLE.format(data_uri(svg)), "src": src,
        })
    out = {"meta": {"pack": pack, "source": man.get("note", ""), "generator": "src/build_pack.py"},
           "categoryColors": {}, "groups": [], "icons": icons}
    (ICONS / f"{pack}.json").write_text(json.dumps(out, ensure_ascii=False, indent=1))
    print(f"wrote icons/{pack}.json ({len(icons)} icons: {dict(Counter(i['src'] for i in icons))})")
    return out


def set_icon(args):
    if not re.fullmatch(r"[a-z0-9_]+", args.name):
        raise SystemExit("--name must use lowercase snake_case (letters, digits, underscores)")

    man = read_manifest(args.pack)
    matches = [i for i, icon in enumerate(man.get("icons", [])) if icon.get("name") == args.name]
    if len(matches) > 1:
        raise SystemExit(f"manifest contains duplicate icon name: {args.name}")

    existing = man["icons"][matches[0]].copy() if matches else {"name": args.name}
    fields = ("label", "abbr", "tags", "color", "category", "file", "devicon", "url", "slug", "frame")
    for field in fields:
        value = getattr(args, field)
        if value is not None:
            existing[field] = value

    if not existing.get("label"):
        raise SystemExit("--label is required when adding a new icon")
    existing.setdefault("color", "#5A6B7B")
    existing.setdefault("tags", existing["label"].lower())

    if existing.get("file"):
        pack_root = (PACKS / args.pack).resolve()
        asset = (pack_root / existing["file"]).resolve()
        if not asset.is_relative_to(pack_root) or not asset.is_file():
            raise SystemExit(f"icon asset does not exist inside icons/source/packs/{args.pack}: {existing['file']}")

    if matches:
        man["icons"][matches[0]] = existing
        action = "updated"
    else:
        man.setdefault("icons", []).append(existing)
        action = "added"
    write_manifest(args.pack, man)

    out = build(args.pack)
    generated = next((icon for icon in out["icons"] if icon["name"] == args.name), None)
    if not generated or not generated.get("style"):
        raise SystemExit(f"catalog verification failed for {args.name}")
    print(f"{action} {args.name} in icons/source/packs/{args.pack}/manifest.json; verified source={generated['src']}")


def remove_icon(args):
    man = read_manifest(args.pack)
    before = len(man.get("icons", []))
    man["icons"] = [icon for icon in man.get("icons", []) if icon.get("name") != args.name]
    if len(man["icons"]) == before:
        raise SystemExit(f"icon not found in {args.pack}: {args.name}")
    write_manifest(args.pack, man)
    build(args.pack)
    print(f"removed {args.name} from icons/source/packs/{args.pack}/manifest.json and rebuilt icons/{args.pack}.json")


def parse_args(argv):
    commands = {"build", "set", "remove"}
    if not argv:
        argv = ["build", "bigdata"]
    elif argv[0] not in commands and argv[0] not in {"-h", "--help"}:
        argv = ["build", *argv]

    parser = argparse.ArgumentParser(description="Manage icon-pack manifests and catalogs.")
    sub = parser.add_subparsers(dest="command", required=True)

    build_cmd = sub.add_parser("build", help="rebuild one catalog from its manifest")
    build_cmd.add_argument("pack")

    set_cmd = sub.add_parser("set", help="add or update an icon, rebuild, and verify")
    set_cmd.add_argument("pack")
    set_cmd.add_argument("--name", required=True, help="lowercase snake_case catalog id")
    set_cmd.add_argument("--label", help="display label (required for a new icon)")
    set_cmd.add_argument("--abbr", help="short fallback tile text")
    set_cmd.add_argument("--tags", help="search keywords")
    set_cmd.add_argument("--color", help="brand color, such as #5A6B7B")
    set_cmd.add_argument("--category", help="override the pack's default category")
    set_cmd.add_argument("--file", help="asset path relative to icons/source/packs/<pack>/")
    set_cmd.add_argument("--devicon", help="Devicon slug")
    set_cmd.add_argument("--url", help="direct SVG URL")
    set_cmd.add_argument("--slug", help="Simple Icons slug")
    set_cmd.add_argument(
        "--frame", action=argparse.BooleanOptionalAction, default=None,
        help="frame the logo; use --no-frame for a full-bleed asset",
    )

    remove_cmd = sub.add_parser("remove", help="remove an icon and rebuild its catalog")
    remove_cmd.add_argument("pack")
    remove_cmd.add_argument("--name", required=True)
    return parser.parse_args(argv)


def cli(argv=None):
    args = parse_args(sys.argv[1:] if argv is None else argv)
    if args.command == "build":
        build(args.pack)
    elif args.command == "set":
        set_icon(args)
    else:
        remove_icon(args)


if __name__ == "__main__":
    cli()
