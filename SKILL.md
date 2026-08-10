---
name: drawio-cloud
description: Use when the user asks for a complete draw.io cloud architecture diagram using AWS, Azure, GCP, Databricks, or multiple clouds—including networking, event-driven systems, landing zones, multi-region or multi-AZ designs, and data platforms.
---

# Draw.io Cloud

Produce correct cloud architecture diagrams in draw.io.

## Skill structure

- `diagram-types.md`: read first to select the layout and routing preset.
- `domains/`: read each domain file represented in the diagram.
- `index.mjs`: public entrypoint for commands and engine imports.
- `src/`: private implementation for debugging, customization, and extension work.
- `icons/`: runtime icon catalogs; pair them with `maintenance.md` when changing icons.

For normal diagram work, use `index.mjs` and the public creators. Inspect `src/` when debugging, customizing, or extending functionality. For icon additions, updates, removals, catalog refreshes, or source upgrades, read `maintenance.md` and follow it.

## Entrypoint

Use the bundled root entrypoint directly. Normal diagram work requires Node.js 20+. Icon maintenance also requires Python 3.12.

```bash
DRAWIO_CLOUD_SKILL="<absolute path of the folder containing this SKILL.md>"
node "$DRAWIO_CLOUD_SKILL/index.mjs" # search, style, validate, audit, render, categories, types
```

Write and run the diagram build script from a scratchpad folder such as a temporary directory or the user's project. Keep the skill folder unchanged and place generated `.drawio`/`.png` output in the user's cwd.

Before building, ask:
- the source of truth for this diagram: the codebase, external research, or your description?
- output format: a static PNG, an SVG, or an editable `.drawio` file (or a combination)?

Ask whenever either answer is missing. Proceed directly when the user has already supplied both answers.

## Workflow

For a multi-diagram request, spawn one subagent per diagram in parallel with distinct filenames. Otherwise, work inline.

1. Read `diagram-types.md` first. Use it to identify and select the suitable dominant diagram type and every domain contained in the diagram, ask the user to confirm if necessary.

2. Apply the shared principles and style in this file together with the selected type and domain rules. Rebuild until every check passes.

Import public engine functions from the root entrypoint during normal use. Reserve direct `src/` imports for source debugging or extension:

```js
import {
  Diagram, group, frame, grid, icon, box, branch, merge, serviceFrame,
  phantom, stage, band, endpoint, ossBox, onpremFrame,
  renderGraph, renderTree, orderGraph,
  loadCatalog, searchIcon,
} from "<DRAWIO_CLOUD_SKILL>/index.mjs";
```

Build with semantic layers and declare the links before placement. Use `renderGraph` to order nodes within graph-aware ranks, compute coordinates, and then create the links:

```js
const links = [
  { source: "client", target: "api", label: "request" },
  { source: "api", target: "worker", label: "invoke" },
];

const d = new Diagram("pipeline", { contract: "bake", routing: "simple", arrow: "block" });
renderGraph(d, tree, links);
```

`stage` enables graph ordering for its children. Set `{ graphOrder: true }` on another `group`, `grid`, or `phantom` when its child order may change to reduce crossings. Keep `renderTree` for a deliberately fixed child order.

Then validate and render:

```bash
node "$DRAWIO_CLOUD_SKILL/index.mjs" validate <file>.drawio
node "$DRAWIO_CLOUD_SKILL/index.mjs" render <file>.drawio -o <file>.png
```

`Read` the PNG for the vision self-check. Rendering requires the draw.io desktop executable (or its path in `DRAWIO_CLI`); everything else is self-contained.

## Principles

### Icons and structure

- Resolve every icon through the bundled entrypoint and treat catalog results as authoritative. Batch lookups: `node "$DRAWIO_CLOUD_SKILL/index.mjs" search "s3, lambda, nat gateway"`.
- Use official domain containers and follow the nesting order in the selected domain file.
- Choose `serviceFrame` when one service owns all children. Use visible icons in a normal group for independent services.
- Give every separately deployed function its own icon so distinct deployed services remain visible.
- Use short human-readable role labels; omit generated names, IDs, variables, and placeholders.

### Density and layout

- Pack related services into one labelled `grid`; 3–8 icons per functional area is normal.
- Give every visible container a short reader-facing name that explains its ownership, scope, or grouping. Use `phantom` for layout-only alignment so it adds structure without drawing a redundant frame.
- Keep frames snug around their content with gaps around 12–16px, especially when a frame contains one icon.
- Prefer a few dense boxes over many sparse boxes. Use one consistent icon size per diagram.
- Default to left-to-right data/request flow and top-to-bottom hierarchy. Keep one dominant direction.
- Place sources/clients on the left, cloud or platform content in the center, consumers on the right, and cross-cutting controls in a band or column.
- Assign semantic layers before routing, such as `Clients → Interfaces → Services → Async/Workers → Data`. Let graph ordering reduce crossings inside each layer while preserving the declared architecture hierarchy.
- Keep the overview focused on primary end-to-end relationships. When a page needs dozens of secondary CRUD, operational, or record-level links, create focused detail diagrams so each path remains traceable.

### House style

Use the theme tokens and themed creators exported by `index.mjs`, letting the closest creator establish the color and structure:

- `stage`: pipeline layer with a pale stage tint.
- `band`: cross-cutting governance, security, or operations.
- `endpoint`: source or consumer card.
- `ossBox`: third-party or self-managed component.
- `onpremFrame`: on-premises or external site.
- `serviceFrame`: one service that owns internal children.
- `branch` / `merge`: shared-trunk split or join point.
- `frame` / `group`: domain containers.

- Keep frames pale and theme-aware while official icons retain their category colors.
- Use a small cohesive palette with at most about eight fill colors. Pale per-stage progression works well; reserve strong colors for meaningful accents.
- Use square frames, clean 2px orthogonal edges, 3–4 font sizes, and labels up to 14px.
- Use `{ dash: true }` for sync, dependency, policy, replication, or lineage. Keep flow animation disabled throughout normal diagram work.
- Prefer icons, containment, and short edge labels over explanatory prose. Add a note for essential meaning that remains after the structure and edges are clear.

### Edges

- Use solid edges for primary data/control flow and dashed edges for sync, dependency, policy, replication, peering, or lineage.
- Select one arrowhead on the `Diagram`, with filled `block` as the default, and use it for every directional edge. A bidirectional edge uses the same selected arrowhead at both ends. Validation returns a hard error when edited XML mixes arrowhead types.
- Represent a bidirectional relationship with one double-headed edge in one corridor.
- Choose `branch("id")` for at least three same-type or same-function targets on one side: `source → branch → equivalent targets`. Individual links keep different target types easy to distinguish.
- Choose `merge("id")` for at least three same-type or same-function sources on one side: `equivalent sources → merge → target`. Individual links keep different source types easy to distinguish.
- Use one line type across every edge in a branch or merge: the same stroke, width, dash pattern, corner style, animation, and arrow selection. The builder throws immediately for mixed options; validation returns a hard error for edited XML.
- Junctions are useful, but overusing them makes paths harder to trace. Use judgment based on readability; keep up to four total incoming/outgoing connections on one side, consolidate equivalent groups, or distribute individual links across suitable sides.
- Use `branch("id", { atBend: true })` or `merge("id", { atBend: true })` as an optional aesthetic variation when a shared transparent junction can sit on the natural orthogonal turn between the trunk and equivalent services.
- The validator identifies equivalent catalog icons automatically. For visually different components with the same function, assign the same `{ functionGroup: "workers" }` to their `icon` or `box` creators.
- Point to the icon when a frame contains different components. Point to the frame only when it represents replicas of one component.
- Move nodes to obtain straight, short connectors. Use another entry face or deliberate waypoints when dense routing still collides.
- Prefer `routing: "simple"`: fixed-side ports, straight/Z/L orthogonal lanes, branch/merge trunks, and small segment nudges. The engine uses constrained A* only when a simple lane would hit a service icon or protected header.
- Choose `routing: "adaptive"` for a focused diagram whose constrained paths still need negotiated congestion cleanup. Keep the semantic layout stable before enabling it.
- Let the router prioritize fewer bends before path length and prefer monotonic progress along each link's dominant axis. Validation reports backtracking, self-crossing, diagonal segments, wrong-side endpoint approaches, and excessive detours; reposition services or steer the few important corridors when a report remains.
- Steer important paths with `{ exitSide: "R", entrySide: "L", via: [[x, y]], monotonic: "horizontal", priority: "primary" }`. Treat `via` as ordered hard checkpoints and use only the few needed to preserve an intentional corridor.
- Keep semantic grouping explicit with `branch` and `merge`. The router preserves their transparent junction topology and routes independent links around it.
- Route every link around unrelated icons, text boxes, shapes, and container headers. Logical container bodies provide open routing space, so an edge may cross their boundaries through clear whitespace.
- Maintain at least 10px clearance between parallel independent links. Shared branch/merge trunks and the short convergence at a common endpoint remain valid.
- Perpendicular link crossings are acceptable when avoiding them would create large detours or congestion. Prefer compact, traceable crossings in dense service diagrams.
- Treat primitive crossings, parallel overlap, and insufficient parallel clearance as hard errors. `save()` throws before writing, and the validator reports the affected edge and primitive IDs.
- Enable flow animation only after the user explicitly requests it. Opt in with `new Diagram(type, { allowFlowAnimation: true })`, then use `{ flow: true }` on the requested links. The builder rejects flow animation without this diagram-level confirmation.

Examples:

```js
// API Gateway → 3 Lambdas share a branch; EC2 remains individually traceable.
d.link("api", "lambda_split");
for (const id of ["lambda_1", "lambda_2", "lambda_3"]) d.link("lambda_split", id);
d.link("api", "ec2");

// 5 equivalent Lambdas → S3 share a merge.
for (const id of ["lambda_1", "lambda_2", "lambda_3", "lambda_4", "lambda_5"]) d.link(id, "lambda_join");
d.link("lambda_join", "s3");
```

Include `branch("lambda_split")` or `merge("lambda_join")` in the layout tree before linking. Add `{ atBend: true }` when the shared point should move onto the natural trunk turn.

Choose the arrow once with `new Diagram(type, { arrow: "block" })`. Link calls inherit it automatically. Use `startArrow: "block"` for a bidirectional edge when `block` is the selected diagram arrow.

### Managed and self-managed components

- Use the official icon for managed cloud services.
- Draw third-party or OSS software with `ossBox` and state where it runs, such as “on EKS” or “on EC2,” beside the corresponding compute icon.

## Self-check

- Run `node "$DRAWIO_CLOUD_SKILL/index.mjs" validate <file>.drawio`; clear ALL `errors`, `warnings`, and `audit.advice` before delivering. In AWS diagrams, treat a missing required Cloud, Account, Region, VPC, AZ, Subnet, or Security Group parent as a structural defect.
- Render and inspect the PNG every round. Check every deployed service, ownership frame, label, arrowhead, and queue path. Confirm every arrow stops on the nearest service edge and every directional edge uses the selected diagram arrowhead.
- Zoom to 200–400% around hubs, queues, buses, and edge labels. A clean full-page preview can hide a few-pixel collision.
- After the validator is clean, complete the visual review and fix every visible defect or crooked, jagged line before delivery.
- Build with `contract: "bake"` and compare each edge length with its Manhattan minimum (`|dx| + |dy|`). Use `exitX`/`exitY` and `entryX`/`entryY` as the measurement anchors.
- Read the numbers as a hint about layout: small total excess over Manhattan but large individual minimums means the router is fine and the nodes are in the wrong place, the same message as `Long connector(s)`.
- Prefer the visually clearer result when a deliberate detour adds a bend but avoids collisions.
