# Icon Catalog Maintenance

Read this file only when adding, updating, or removing icons; refreshing a catalog; upgrading icon sources; or otherwise maintaining the skill. Routine diagram creation does not require anything here.

Runtime catalog data lives in `icons/*.json`. The maintenance generators rebuild it from manifests and assets in `icons/source/packs/` and the vendored AWS source in `icons/source/shape-index.json.gz`. Run commands from the skill directory with Python 3.12.

- `src/build_pack.py`: add, update, or remove manifest entries and rebuild pack catalogs
- `src/ingest_index.py`: rebuild the full AWS catalog offline from vendored ground truth

## Icon sources

Pack icons resolve in this order: local `file` → Devicon → explicit SVG `url` → Simple Icons `slug` → generated text tile. Remote SVGs are fetched only during rebuild and embedded in `icons/*.json`, so packs without local assets still work offline at runtime. Currently AWS instead uses native draw.io stencil styles from `shape-index.json.gz`; Azure and GCP use vendored official SVGs.

## Add or update an icon in a pack

1. Find which pack fits: `aiml`, `azure`, `bigdata`, `cicd`, `containers`, `database`, `databricks`, `gcp`, `network`, `observability`.

2. Run one command to update the manifest, rebuild the catalog, and verify the generated icon:

   ```bash
   python3.12 src/build_pack.py set <pack> \
     --name <snake_case_name> \
     --label "<Display name>" \
     --tags "<search keywords>" \
     --slug <simple-icons-slug> \
     --color '#5A6B7B'
   ```

   Asset options are `--file`, `--devicon`, `--url`, or `--slug`; resolution follows that order when fallbacks are supplied. Other options are `--abbr`, `--category`, `--color`, and `--no-frame`. For a vendored asset, place it under `icons/source/packs/<pack>/` and pass its pack-relative path to `--file`.

   Running `set` again with the same `--name` updates that entry. Omitted fields retain their existing values.

3. To remove an icon and rebuild its catalog:

   ```bash
   python3.12 src/build_pack.py remove <pack> --name <snake_case_name>
   ```

To rebuild a pack without changing its manifest, run `python3.12 src/build_pack.py build <pack>`.

Only open the script source if a build errors; the commands above are the whole interface.

## Refresh the AWS catalog

Regenerate `icons/aws.json` from the vendored draw.io shape index with no network:

```bash
python3.12 src/ingest_index.py
```
