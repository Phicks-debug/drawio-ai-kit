# AWS architecture

Apply these AWS-specific conventions together with the shared principles in `SKILL.md`.

## Containers and nesting

Resolve official AWS group shapes with `node "$DRAWIO_CLOUD_SKILL/index.mjs" search "<name>" --kind group`. Build the hierarchy through parent-child nesting:

```text
AWS Cloud (group_aws_cloud_alt)
└─ AWS Account (group_account)
   └─ Region (group_region, dashed)
      └─ VPC (group_vpc)
         └─ Availability Zone (group_availability_zone, dashed)
            └─ Subnet (group_subnet; color follows its label: "Public" → blue, "Private" → green)
               └─ Security Group (group_security_group, dashed)
                  └─ service icons
```

- Place every AWS service inside `AWS Cloud → AWS Account → Region`. The validator reports missing, misplaced, or incorrectly ordered layers, including in multi-account and multi-Region diagrams.
- Extend the hierarchy with `VPC → Availability Zone → Subnet → Security Group` for network-scoped infrastructure. Include each parent in order so the containment reflects AWS structure.
- Keep services outside a VPC within their Region, Account, and Cloud containers. The container structure communicates the scope clearly on its own.
- Place managed or global services such as S3, IAM, KMS, CloudWatch, Route 53, and Organizations outside the VPC while retaining the consistent Region, Account, and Cloud hierarchy.
- Include the infrastructure that exists in the source of truth. A concise hierarchy keeps the diagram accurate and readable.
- Give each visible logical container a short name that explains the AWS boundary or grouping. Use `phantom` when a wrapper exists only to align services; the validator asks for an explicit decision when a visible container has an empty name.
- Let `group_subnet` derive its fill from the label: `Public` produces blue and `Private` produces green.
- Retain the official catalog styles for AWS service icons; their category colors carry service identity.

## Resource fidelity

- Give every separately defined Lambda function its own visible Lambda icon, including functions that share one CRUD domain.
- Place distinct functions in a normal labelled `grid`. Choose `serviceFrame` when one parent service owns non-service internal children.
- Use short human-readable role names such as `Create tag` or `Pipeline`.
- Keep service labels focused on reader-facing roles. Deployment names, account IDs, Regions, interpolation syntax, variables, and placeholders belong in the source rather than the diagram.
- Connect each operational storage, database, queue, compute, and network icon to at least one producer, consumer, dependency, or data flow.
- Treat IAM, logging, audit, provisioning services, and decorative badges as cross-cutting context; they may remain unwired when containment or placement already explains their role.

## Icon color and identity

Use each AWS icon with the official category color supplied by its catalog style. Consistent official colors make services immediately recognizable, and the validator reports style overrides.

Category colors:

- Compute and Containers: `#ED7100`
- Storage: `#7AA116`
- Database: `#C925D1`
- Networking and Analytics: `#8C4FFF`
- Security: `#DD344C`
- Management and Application Integration: `#E7157B`
- Migration and Machine Learning: `#01A88D`

## Canonical layouts

- Data pipeline: arrange `Sources → Ingestion → Processing → Storage → Integration/Serving → Consumers` from left to right. Place cross-cutting layers in a band below, following `SKILL.md` under `Density and layout`.
- VPC or network diagram: use one vertical column per Availability Zone and place the columns side by side inside a horizontal VPC frame. Stack subnet tiers from top to bottom as `Public → App → Data`, and align matching tiers horizontally across AZs. Place users and the Internet outside the VPC. Let a shared ALB, NAT gateway, or bus span the AZ columns horizontally when its scope requires it.
- Event-driven or bus architecture: use the `hubspoke` preset from `diagram-types.md`, with the bus in the center, producers on one side, and consumers on the other.
- Hybrid or disaster recovery: place on-premises infrastructure in a separate block outside the AWS Cloud and Region hierarchy. Use the `hybrid` preset from `diagram-types.md`.

## Multi-AZ

- Represent high availability with at least two Availability Zone columns side by side inside the VPC; label them `AZ-a`, `AZ-b`, and so on.
- Mirror stateful tiers across the AZ columns when the architecture deploys them per AZ.
- Arrange stateless services horizontally within each AZ.
- Show a managed multi-AZ data service such as RDS at the VPC level with a concise scope note, or place one icon in each AZ and connect the replicas with a sync link.

## Edges

- Connect an edge to a dashed `clusterBox` when that frame represents replicas of one stack across multiple AZs. One edge to the frame boundary communicates the replicated target cleanly.
- Create each `clusterBox` before calling `d.link(...)` so its ID is available as an edge endpoint.
- Connect directly to individual icons when the relationship is a genuine fan-out to distinct services. Use the shared branch and merge guidance in `SKILL.md` for equivalent groups.
- Point to the icon when a frame contains different components; point to the frame when it represents replicas of one component.

## Placement

The layout engine follows declared nesting while the router tidies connector paths. Place each node near the services it communicates with most so the resulting paths stay compact and traceable.

- Put shared resources such as ECR, S3, CloudWatch, and KMS in a nearby band beside their main consumers.
- Reposition nodes when validation reports `Long connector(s)`; this warning usually indicates that the layout can better reflect communication locality.
- Use compact perpendicular crossings when they preserve traceability and prevent large detours or corridor congestion.
