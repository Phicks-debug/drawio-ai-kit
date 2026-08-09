---
name: drawio-aws
description: Use when the user asks for an AWS architecture diagram — VPC/networking, event-driven, landing zone, multi-AZ, serverless pipeline, or any diagram built with AWS service icons.
license: MIT
---

# Draw.io AWS

Produce correct AWS Cloud architecture diagrams in draw.io.

## Skill structure

- `src/`: Node ESM engine 
  - `cli.mjs` (command runner)
  - `core.mjs` (catalog load, `searchIcon`, `validateDiagram`, `auditAesthetics`)
  - `builder.mjs` (`Diagram`, `link`)
  - `layout-engine.mjs` (`group`/`frame`/`grid`/`icon`/`box`/`serviceFrame`/`renderTree`)
  - `theme.mjs`
  - `layout.mjs`
  - `types.mjs`
  - `bpmn.mjs`
- `catalog/`: icon catalogs — `aws.json` (983 AWS stencils) plus one `<pack>.json` per icon pack; all merged at load.
- `rules/`: domain rules — `aws-architecture.md`, `azure-architecture.md`, `gcp-architecture.md`, `databricks-architecture.md`, `bpmn.md`, plus shared `principles.md`, `diagram-types.md`, `style-guide.md`.
- `packs/`: icon pack manifests (`manifest.json`) and vendored logo assets — the source for catalog regeneration.
- `data/`: vendored ground truth — `shape-index.json.gz` (draw.io AWS palette), `lobe-icons.json` (AI brand list).
- `scripts/`: catalog generation (`build_pack.py`, `ingest_index.py`, `crawl_icons.py`) — see `icon-catalog.md`.
- `vendor/`: standalone Python helpers — `aiicons.py`, `autolayout.py`, `encode_drawio_url.py`, `repair_png.py`.

Usually no need to read the sources and each folder, unless debugging, customizing or get errors. The scripts is tested and works out of the box.

## Setup

No installation: the engine runs directly from this skill with Node ≥ 18 (ESM) and Python 3.12.

```bash
SKILL="<absolute path of the folder containing this SKILL.md>"
node "$SKILL/src/cli.mjs"          # the command runner — subcommands: search, style, validate, audit, render, categories, types, logo
```

Write the diagram build script in a **scratchpad folder** — any working location you choose (a temp dir, the user's project, wherever fits), and run it from there so this skill folder stays read-only. Catalog generation scripts (`icon-catalog.md`) work the same way when you run them. Generated `.drawio`/`.png` output always goes into the user's cwd — never into the skill folder.

Before building, ask:
- the source of truth for this diagram: the codebase, external research, or your description?
- output format: a static PNG, an SVG, or an editable `.drawio` file (or a combination)?

Do not infer it; skip the question only when the user has already stated it explicitly.

## Workflow

For a multi-diagram request, spawn one subagent per diagram in parallel with distinct filenames. Otherwise, work inline.

The workflow below IS the source of truth. You may edit and run the build script directly to fine-tune the diagram.

Read the AWS rules directly from the rules folder:

```bash
cat "$SKILL/rules/principles.md" "$SKILL/rules/aws-architecture.md" "$SKILL/rules/diagram-types.md" "$SKILL/rules/style-guide.md"
```

Apply these rules together with the self-check below. Rebuild until every check passes.

Import the engine by absolute path (set `$SKILL` first, see Setup):

```js
import { Diagram } from "<SKILL>/src/builder.mjs";
import { group, frame, grid, icon, box, serviceFrame, renderTree } from "<SKILL>/src/layout-engine.mjs";
import { loadCatalog, searchIcon } from "<SKILL>/src/core.mjs";   // optional: in-process icon lookup
```

Build with the declarative layout engine (NO hand-written coordinates), then validate and render:

```bash
node "$SKILL/src/cli.mjs" validate <file>.drawio
node "$SKILL/src/cli.mjs" render <file>.drawio -o <file>.png
```

`Read` the PNG for the vision self-check. Render needs the draw.io desktop CLI (or `DRAWIO_CLI` env var); everything else is self-contained.

## Domain notes

Every AWS service must be nested inside the black `AWS Cloud (group_aws_cloud_alt) → AWS Account → Region` hierarchy. Add `VPC → Availability Zone → Subnet → Security Group` only for infrastructure that exists; each deeper network group requires all of those parents in order. Services outside a VPC remain inside Region, Account, and Cloud. Do not write explanatory absence text such as “no VPC.” Category colors from the catalog are authoritative; never recolor AWS icons.

Single icon must not stand for several deployed functions.

Use `serviceFrame(id, icon, name, opts, children)` only for one parent service that owns internal stages, pods, workflow states, or controls. The generated frame has a flush top-left icon, normal-weight title, and a 2px theme-aware border based on the icon category. `opts.borderStyle` is optional and defaults to `solid`; choose `dashed`, `dotted`, or `dash-dot` only when the user requests it or the visual distinction is useful. The `name` is a short human-readable service name, never a generated deployment name, account ID, Region, variable, or placeholder, prefer named by their role, example: `Ingestion Pipeline` or `Query Pipeline` over `Pipeline`. Keep independent AWS services as default icons in a normal group, avoid deep service-frame nesting, and prefer a short edge label when it already explains the relationship.

Use icons and containment to carry meaning. Keep labels short, avoid prose boxes, and connect every operational service icon to a producer, consumer, dependency, or data flow. Decorative corner badges and clearly cross-cutting IAM, CloudWatch, CloudTrail, Config, audit, and provisioning controls may remain unwired.

Do not route opposite directions through the same corridor. Use one double-headed edge when it represents the relationship, or route each direction on a different side. Keep a dead-letter queue outside the message-and-retry lane.

Give separate queue producers different entry faces when their arrowheads would crowd one side.

## Self-check

- Run `validate_diagram`; clear ALL `errors`, `warnings`, and `audit.advice` before delivering. Treat a missing Cloud, Account, Region, VPC, AZ, Subnet, or Security Group parent as a structural defect.
- Render and inspect the PNG every round. Check every deployed service, ownership frame, label, arrowhead, queue path, and high-degree hub. After `render`, run `python3.12 "$SKILL/vendor/repair_png.py" <file>.png` if the export came from the draw.io CLI (`-e` PNGs are truncated).
- Zoom to 200–400% around hubs, queues, buses, and edge labels. A clean full-page preview can hide a few-pixel collision.
- Treat a clean validator result as necessary, not sufficient. Fix every visible defect or crooked, jagged line before delivery
- Build with `contract: "bake"` and compare each edge length with its Manhattan minimum (`|dx| + |dy|`). Measure from `exitX`/`exitY` and `entryX`/`entryY`, not from node centers.
- Read the numbers as a hint about layout: small total excess over Manhattan but large individual minimums means the router is fine and the nodes are in the wrong place, the same message as `Long connector(s)` / `edge crossings`.

## Adding or updating icons

If the user needs an icon not in the catalog, follow `icon-catalog.md`.

## Helper scripts

Standalone utilities in `vendor/` — read the source only if one misbehaves:

- **`aiicons.py`** — find an AI/LLM brand logo (OpenAI, Claude, Gemini, …) as a draw.io `shape=image` style. `python3.12 "$SKILL/vendor/aiicons.py" "<brand>" [--embed] [--variant color|mono|text] [--json] [--list]`. `--embed` inlines the SVG as a data URI (portable, no network at render time); without it the icon is a CDN URL.
- **`autolayout.py`** — auto-layout a graph with Graphviz `dot`. `python3.12 "$SKILL/vendor/autolayout.py" graph.json [-o diagram.drawio] [--tune]` — input is `{direction, nodes:[{id,label,style,width,height}], edges:[{source,target,label}]}`; requires `dot` on PATH. Use when the declarative engine's coordinates need a full pass or when asked for a non-hierarchical free layout.
- **`encode_drawio_url.py`** — share a diagram as a link with no upload. `python3.12 "$SKILL/vendor/encode_drawio_url.py" [--edit] <file>.drawio` → viewer (`#R`) or editable (`#create=`) diagrams.net URL.
- **`repair_png.py`** — fix draw.io CLI `-e` PNG exports (truncated IEND chunk makes vision APIs reject them). `python3.12 "$SKILL/vendor/repair_png.py" <file>.png` — idempotent, safe to run unconditionally after every PNG render.
