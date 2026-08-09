# Diagram types — layout & routing presets

Pick the diagram type first — each has its own layout & edge-routing preset (`src/types.mjs` → `typePreset(name)`).

## Pick the type

| User intent | Type key |
|---|---|
| Data/request pipeline, ETL, request-response across tiers | `pipeline` |
| Org structure, Landing Zone, account/OU hierarchy | `hierarchy` |
| VPC / network topology, Multi-AZ deployment, 3-tier in a VPC | `network` |
| Event-driven, message bus, fan-in/fan-out around a hub | `hubspoke` |
| Hybrid / disaster recovery (on-prem ↔ cloud, two sites) | `hybrid` |
| Multi-account connectivity / service mesh (VPC Lattice, TGW, peering, RAM share) | `mesh` |
| Numbered request walkthrough over an architecture | `sequence` |

## Templates — copy-paste starting points (`examples/`)

Before free-handing, check if a template matches the request. Open it, **reproduce its structure**, then adapt the labels / LAYERS block.

| You're drawing | Start from |
|---|---|
| A **Multi-AZ workload layer** — AZ private-subnet columns · pods on EC2 worker nodes · per-app cross-AZ `clusterBox` · GitOps band | `examples/aws/build_multiaz_template.mjs` |
| A **multi-account Landing Zone / hub-and-spoke** — Network account + **Transit Gateway** · Ingress/Inspection/Egress VPCs · workload spokes · hybrid (DX/VPN) · governance — incl. a **multi-tab SA deck** (As-Is · To-Be · Networking · Security · Backup · Logging · CI/CD) | `examples/aws/build_landingzone_hubspoke_template.mjs` |
| A single VPC (Multi-AZ · EKS · NAT) | `examples/aws/build_vpc_eks.mjs` |
| Hybrid / DR (on-prem ↔ cloud, two sites) | `examples/aws/build_hybrid.mjs` |
| Multi-account mesh / TGW connectivity | `examples/aws/build_mesh.mjs` |

## Reproduction loop — build → validate → conform → fix (repeat)

When a template matches, **don't free-hand it — reproduce it and self-check** in a loop:

1. **Match** — pick the template above; open it.
2. **Build** — reproduce its structure with the layout engine + helpers (`clusterBox`, themed creators); never hardcode coordinates.
3. **Validate** — clear all `errors`, `warnings`, `audit.advice`.
4. **Conform** — `render_diagram`, then check against the **Conformance checklist at the top of the template file**.
5. **Fix & repeat** — until validate is clean **and** every checklist item passes (≤ ~3 rounds).

## Composing archetypes (real systems mix several)

A real architecture is usually NOT one pure type — it COMBINES them, and the engine composes freely because every archetype is just a nested `group`/`frame` subtree. Build the dominant type, then nest the others inside/around it (e.g. a full data platform = **pipeline** stages inside a Cloud frame + a **hybrid** on-prem block and Direct Connect channel beside it + a cross-cutting **band**). `new Diagram(type)` only sets edge-routing defaults (pick the dominant one) — it does **not** restrict the layout. Don't force a complex system into one archetype — **compose**, and reuse the themed creators (`stage`/`band`/`endpoint`/`onpremFrame`) across the pieces so the whole thing stays one coherent style.

## Per-type layout & routing

### pipeline

- **Layout:** left → right, one column per tier (Ingest → Process → Store → Serve). Cross-cutting layers as a band below.
- **Routing:** put the connected "spine" nodes at the **same Y** so the main flow is straight horizontal.

### hierarchy

- **Layout:** top → down. Parent (Management/Root) on top; children (OUs/accounts) nested below. Group by OU containers.

### network

- **Layout:** nest containers in the real parent-child order (see the domain preset's nesting tree). **Mirror the AZs** (stack them vertically). Tiers flow left → right inside each AZ: Public (NAT/IGW) → Private app → Private data.
- **Routing:** make the **load balancer a tall node spanning the AZs** so its edges to each AZ's app tier are straight horizontals. Edges between tiers are horizontal; go **vertical only to cross AZs** (e.g. RDS primary → standby). Cross-AZ replication / DR uses **dashed** lines.

### hubspoke

- **Layout:** hub (bus/TGW/EventBridge/SNS) in the **centre** of the producer/consumer row.
- **Routing:** producers connect from one side, consumers from the other with short horizontal edges → no crossings.

### hybrid

- **Layout:** two site blocks (on-prem, cloud) as separate frames — on-prem OUTSIDE the cloud Region container, never nested inside it.
- **Routing:** connect through a single **Direct Connect / VPN** node (not just a labelled edge); mirror matching components on both sides; bidirectional links are **dashed double-headed**.

## Fan-out / fan-in edges

Routed automatically as sharp, bundled **combs** — call `d.link(...)` repeatedly and pick role `fanout` where relevant. Keep the many-side roughly **aligned** (same x for LR, same y for TB) so branches stay short.

## Grid layout

When a row of N items doesn't match the column count of a sibling row (e.g. 4 storage icons under 3 AZ columns), use `grid(id, gname, label, { cols }, children)` instead of hand-stacking — evenly-sized centered cells, no lop-sided whitespace.
