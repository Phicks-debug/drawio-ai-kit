# Icon Catalog Management

Add, update, and refresh the icons that `drawio-aws` can place on a diagram. All catalog data lives in `catalog/*.json`; these scripts regenerate it from `packs/*/manifest.json` and `data/`. Run everything from the skill directory with `python3.12`.

- `scripts/build_pack.py <pack>` — build a pack catalog from its manifest
- `scripts/ingest_index.py` — rebuild the full AWS catalog offline (ground truth)
- `scripts/crawl_icons.py` — re-crawl AWS stencil names from draw.io's source (online)

## Add or update an icon in a pack

1. Find which pack fits: `aiml`, `azure`, `bigdata`, `cicd`, `containers`, `database`, `databricks`, `gcp`, `network`, `observability`.
2. Edit `packs/<pack>/manifest.json` — one entry per icon. Known keys:
   - `name` (required) — snake_case id used in the catalog
   - `label` — display name; `abbr` — short text for the tile fallback
   - `tags` — search keywords
   - `color` — brand color (used for simple-icons/text tiles)
   - `category` — overrides the pack default
   - `file` — vendored asset under `packs/<pack>/` (highest priority; `.svg` or `.png`)
   - `devicon` — devicon slug (full-color logo, e.g. `postgresql`)
   - `url` — direct SVG logo URL (embedded as-is)
   - `slug` — simple-icons slug (monochrome glyph on a brand-color tile)
   - `frame: false` — embed a full-bleed logo as-is instead of tiling it

   Resolution order: `file` → `devicon` → `url` → `slug` → text tile (`abbr`/`label`).
3. Rebuild the pack:
   ```bash
   python3.12 scripts/build_pack.py <pack>
   ```
4. Verify the icon is searchable: `grep -o '"name": "[^"]*"' catalog/<pack>.json | grep -i <name>`.

Only open the script source if a build errors; the JSON above is the whole interface.

## Refresh the AWS catalog (offline)

Regenerate `catalog/aws.json` (983 icons) from the vendored draw.io shape index — no network:

```bash
python3.12 scripts/ingest_index.py
```

This is the ground-truth path and the only one guaranteed to work offline.

## Crawl new stencil names (online)

```bash
python3.12 scripts/crawl_icons.py --mode names --dry-run   # preview, no writes
python3.12 scripts/crawl_icons.py --mode names             # merge new names into catalog/aws.json
python3.12 scripts/crawl_icons.py --mode base64 --src <svg-dir>  # embed local SVGs as data URIs
```

Note: jgraph/drawio refactored their sidebar source to build names by string concatenation, so `--mode names` currently extracts nothing. Prefer `ingest_index.py`; if a stencil is genuinely missing from the shape index, add it to `data/shape-index.json.gz`'s source or hand-add a catalog entry.
