# Diagram type and domains

## Domains

- `domains/aws.md`: AWS services or containers.
- `domains/azure.md`: Azure services or containers.
- `domains/gcp.md`: GCP services or containers.
- `domains/databricks.md`: Databricks or lakehouse components.

Read every matching domain file. For multi-cloud diagrams, read all applicable files and give each cloud its own sibling top-level frame. For example, Databricks deployed on AWS requires both `domains/databricks.md` and `domains/aws.md`.

Never nest one cloud inside another.

## Diagram types

Each type has its own layout and edge-routing preset, exposed as `typePreset(name)` from `index.mjs`.

Use semantic layers as the primary layout. Declare links before placement and call `renderGraph`; its Sugiyama-style barycenter sweeps reorder children inside `stage` and containers marked `{ graphOrder: true }`. The router then uses simple orthogonal lanes, with A* reserved for paths that still meet a protected service or header.

Use `deployment` by default. Read the alternatives below and switch only when the request needs a different dominant view:

- `deployment`: Deployed-resource inventory with runtime relationships and exact resource counts. Its fidelity rules live in `SKILL.md` because they are the default architecture contract.
- `pipeline`: Data/request pipelines, ETL, or request-response across tiers.
- `hierarchy`: Organization structures, landing zones, accounts, or organizational units.
- `network`: VPC/VNet topology, multi-AZ deployment, or three-tier networking.
- `hubspoke`: Event-driven systems, message buses, or fan-in/fan-out around a hub.
- `hybrid`: Hybrid connectivity or disaster recovery across on-premises and cloud sites.
- `mesh`: Multi-account connectivity, service mesh, transit gateway, peering, or resource sharing.
- `sequence`: Numbered request or interaction walkthrough over an architecture.

## Composing archetypes

A real architecture is usually NOT one pure type — it COMBINES them, and the engine composes freely because every archetype is just a nested `group`/`frame` subtree. Build the dominant type, then nest the others inside/around it (e.g. a full data platform = pipeline stages inside a Cloud frame + a hybrid on-prem block and Direct Connect channel beside it + a cross-cutting band). `new Diagram(type)` only sets edge-routing defaults (pick the dominant one) — it does not restrict the layout. Don't force a complex system into one archetype — compose, and reuse the themed creators (`stage`/`band`/`endpoint`/`onpremFrame`) across the pieces so the whole thing stays one coherent style.

## Per-type layout & routing

### Deployment

- Layout: cloud boundaries outside, functional domains inside, deployed resources grouped by runtime ownership.
- Apply `SKILL.md` under `Deployment fidelity` and `Edges`; keep runtime triggers and primary data/control flow visible.

### Pipeline

- Layout: left → right, one column per tier (Ingest → Process → Store → Serve). Cross-cutting layers as a band below.
- Routing: put the connected "spine" nodes at the same Y so the main flow is straight horizontal.

### Hierarchy

- Layout: top → down. Parent (Management/Root) on top; children (OUs/accounts) nested below. Group by OU containers.

### Network

- Layout: nest containers in the real parent-child order (see the domain preset's nesting tree). Mirror the AZs (stack them vertically). Tiers flow left → right inside each AZ: Public (NAT/IGW) → Private app → Private data.
- Routing: make the load balancer a tall node spanning the AZs so its edges to each AZ's app tier are straight horizontals. Edges between tiers are horizontal; go vertical only to cross AZs (e.g. RDS primary → standby). Cross-AZ replication / DR uses dashed lines.

### Hubspoke

- Layout: hub (bus/TGW/EventBridge/SNS) in the centre of the producer/consumer row.
- Routing: producers connect from one side, consumers from the other with short horizontal edges → no crossings.

### Hybrid

- Layout: two site blocks (on-prem, cloud) as separate frames — on-prem OUTSIDE the cloud Region container, never nested inside it.
- Routing: connect through a single Direct Connect / VPN node (not just a labelled edge); mirror matching components on both sides; bidirectional links are dashed double-headed.

## Grid layout

When a row of N items doesn't match the column count of a sibling row (e.g. 4 storage icons under 3 AZ columns), use `grid(id, gname, label, { cols }, children)` instead of hand-stacking — evenly-sized centered cells, no lop-sided whitespace.
