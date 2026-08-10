// drawio-ai-kit — core engine (zero-dependency, Node >=18, target Node 26)
// Provides: loadCatalog, searchIcon, styleForIcon, styleForGroup, validateDiagram.
// No external libraries so the CLI always runs, even when the MCP SDK is not installed.

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, isAbsolute, basename } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_CATALOG = join(__dirname, "..", "icons", "aws.json");

const FAMILY = "mxgraph.aws4";

/** Read the catalog JSON and build a lookup index. */
export function loadCatalog(path = DEFAULT_CATALOG) {
  const file = isAbsolute(path) ? path : join(process.cwd(), path);
  const raw = JSON.parse(readFileSync(file, "utf8"));
  // Each entry carries its pack name (catalog filename) so callers can filter per domain mode.
  const tag = (arr, pack) => arr.map((e) => ({ ...e, pack }));
  const basePack = basename(file, ".json");
  const icons = tag(raw.icons ?? [], basePack);
  const groups = tag(raw.groups ?? [], basePack);
  const categoryColors = { ...(raw.categoryColors ?? {}) };
  // Merge any sibling icons/*.json packs (e.g. bigdata.json, databricks.json) so their
  // icons are searchable alongside AWS. Each pack contributes icons/groups/categoryColors.
  try {
    for (const f of readdirSync(dirname(file))) {
      if (!f.endsWith(".json") || join(dirname(file), f) === file) continue;
      const pack = JSON.parse(readFileSync(join(dirname(file), f), "utf8"));
      const packName = basename(f, ".json");
      if (Array.isArray(pack.icons)) icons.push(...tag(pack.icons, packName));
      if (Array.isArray(pack.groups)) groups.push(...tag(pack.groups, packName));
      // nosemgrep: insecure-object-assign -- merges the kit's own bundled catalog JSON, not user/request input
      Object.assign(categoryColors, pack.categoryColors ?? {});
    }
  } catch { /* no extra packs */ }
  const byName = new Map();
  for (const it of icons) byName.set(it.name, { ...it, kind: "icon" });
  for (const g of groups) byName.set(g.name, { ...g, kind: "group" });
  return { meta: raw.meta ?? {}, categoryColors, icons, groups, byName, validNames: new Set(byName.keys()) };
}

function norm(s) {
  return String(s ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Simple match score between the query and an entry. */
function scoreEntry(entry, qTokens, qRaw) {
  const name = norm(entry.name);
  const haystack = norm(
    [entry.name, entry.label, entry.category, entry.tags, ...(entry.aliases ?? []), ...(entry.keywords ?? [])].join(" ")
  );
  let score = 0;
  if (name === qRaw) score += 100; // exact name match
  if (name.replace(/ /g, "") === qRaw.replace(/ /g, "")) score += 60;
  for (const t of qTokens) {
    if (!t) continue;
    if (name.split(" ").includes(t)) score += 25;
    else if (name.includes(t)) score += 12;
    if (haystack.includes(t)) score += 6;
  }
  return score;
}

// ponytail: catalog entries carry zero aliases, so common shorthand returns [] and the agent
// falls back to a plain box. Whole-token expansion here beats editing 12 catalog JSONs.
const QUERY_ALIASES = {
  k8s: "kubernetes", psql: "postgresql", pg: "postgresql", es: "elasticsearch",
  mongo: "mongodb", rabbit: "rabbitmq", "hashicorp": "hashicorp vault",
};

/** Search for an icon/group by keyword. */
export function searchIcon(catalog, query, { category, limit = 8, kind, full = false } = {}) {
  const qTokens = norm(query).split(" ").filter(Boolean).map((t) => QUERY_ALIASES[t] ?? t);
  const qRaw = qTokens.join(" ");
  const cat = category ? norm(category) : null;
  const pool = [...catalog.byName.values()].filter((e) => {
    if (kind && e.kind !== kind) return false;
    if (cat && norm(e.category) !== cat && !norm(e.category).includes(cat)) return false;
    return true;
  });
  const ranked = pool
    .map((e) => ({ entry: e, score: scoreEntry(e, qTokens, qRaw) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((r) => decorate(catalog, r.entry, r.score, { lean: true, compact: !full }));
  return ranked;
}

function colorFor(catalog, entry) {
  return entry.color || catalog.categoryColors[entry.category] || "#232F3E";
}

function decorate(catalog, entry, score, { lean = false, compact = false } = {}) {
  // ponytail: compact = search-result shape. The agent builds with icon("<name>") and the engine
  // resolves the style server-side, so the ~600-char style string (plus fqn/aliases/score) is
  // pure context burn in search output. `drawio-ai style <name>` returns the full entry.
  if (compact) {
    return {
      name: entry.name,
      label: entry.label ?? entry.name,
      category: entry.category ?? null,
      kind: entry.kind,
      color: colorFor(catalog, entry),
    };
  }
  const styleObj = entry.kind === "group" ? styleForGroup(catalog, entry.name) : styleForIcon(catalog, entry.name);
  // ponytail: OSS icons embed a base64 PNG (~15-25KB) in the style. In search results (lean) don't
  // dump it into context — the model only needs the name; builder.icon(name) resolves the style
  // server-side, and get_icon_style(name) (not lean) returns it verbatim if raw XML is needed.
  const style = lean && /image=data:/.test(styleObj.style || "")
    ? `embedded-image; build with icon("${entry.name}") or fetch via get_icon_style`
    : styleObj.style;
  return {
    name: entry.name,
    fqn: `${FAMILY}.${entry.name}`,
    label: entry.label ?? entry.name,
    category: entry.category ?? null,
    kind: entry.kind,
    color: colorFor(catalog, entry),
    aliases: entry.aliases ?? [],
    style,
    ...(styleObj.width ? { width: styleObj.width, height: styleObj.height } : {}),
    ...(score != null ? { score } : {}),
  };
}

/** Full draw.io style for an AWS resource icon (verbatim from the index if available). */
export function styleForIcon(catalog, name, { width, height } = {}) {
  const entry = catalog.byName.get(name);
  if (!entry) return null;
  if (entry.style) return { style: entry.style, width: width ?? entry.w ?? 48, height: height ?? entry.h ?? 48 };
  // hand-built fallback (when the catalog is in the old seed form)
  const color = colorFor(catalog, entry);
  const style =
    `sketch=0;outlineConnect=0;fontColor=#232F3E;gradientColor=none;fillColor=${color};` +
    `strokeColor=none;dashed=0;verticalLabelPosition=bottom;verticalAlign=top;align=center;` +
    `html=1;fontSize=12;fontStyle=0;aspect=fixed;shape=${FAMILY}.resourceIcon;resIcon=${FAMILY}.${name};`;
  return { style, width: width ?? 48, height: height ?? 48 };
}

/** Style for a group container (AWS Cloud / Region / VPC / AZ ...) — verbatim from the index if available. */
export function styleForGroup(catalog, name) {
  const entry = catalog.byName.get(name);
  if (entry?.style) return { style: entry.style, width: entry.w, height: entry.h };
  const stroke = entry?.stroke || "#232F3E";
  const fill = entry?.fill || "none";
  const style =
    `sketch=0;outlineConnect=0;gradientColor=none;html=1;whiteSpace=wrap;fontSize=12;fontStyle=0;` +
    `container=1;pointerEvents=0;collapsible=0;recursiveResize=0;shape=${FAMILY}.group;` +
    `grIcon=${FAMILY}.${name};strokeColor=${stroke};fillColor=${fill};verticalAlign=top;align=left;` +
    `spacingLeft=30;fontColor=${stroke};dashed=${entry?.dashed ? 1 : 0};`;
  return { style };
}

const RE_RESICON = /resIcon=mxgraph\.aws4\.([a-z0-9_]+)/g;
const RE_GRICON = /grIcon=mxgraph\.aws4\.([a-z0-9_]+)/g;
const RE_SHAPE = /shape=mxgraph\.aws4\.([a-zA-Z0-9_]+)/g;
const RE_SRC = /\bsource="([^"]+)"/g;
const RE_TGT = /\btarget="([^"]+)"/g;

function collect(re, xml) {
  const out = [];
  let m;
  re.lastIndex = 0;
  while ((m = re.exec(xml)) !== null) out.push(m[1]);
  return out;
}

/**
 * Validate a draw.io XML string:
 *  - whether every resIcon / grIcon exists in the catalog (guards against the AI inventing names)
 *  - whether edges reference existing ids
 *  - a few basic lint checks on icon styles
 * Returns { ok, errors, warnings, stats }.
 */
export function validateDiagram(catalog, xml, { strict = false } = {}) {
  const errors = [];
  const warnings = [];
  const knownShapeWords = new Set(["resourceIcon", "resourceIcon2", "group", "groupCenter", "productIcon"]);

  // Guard: no <mxCell> at all means there is nothing to validate — most often a COMPRESSED .drawio
  // (draw.io desktop's default save format base64-deflates the <diagram> body). Without this guard
  // the file silently passes as "ok" with zero checks run.
  if (!/<mxCell[\s>]/.test(xml)) {
    const looksCompressed =
      /<diagram[^>]*>[^<\s][A-Za-z0-9+/=\s]{40,}<\/diagram>/.test(xml) || // whole file
      /^[A-Za-z0-9+/=\s]{40,}$/.test(xml.trim());                          // bare tab body (per-tab path)
    errors.push(
      looksCompressed
        ? "No cells found — this .drawio appears to be COMPRESSED (draw.io's default save). Re-export uncompressed: File → Properties → uncheck Compressed, or Extras → Edit Diagram to copy plain XML."
        : "No <mxCell> elements found — nothing to validate (empty or unrecognized file).",
    );
    return { ok: false, errors, warnings, audit: { advice: [] } };
  }

  const resIcons = collect(RE_RESICON, xml);
  const grIcons = collect(RE_GRICON, xml);
  const shapes = collect(RE_SHAPE, xml).filter((s) => !knownShapeWords.has(s));

  const checkRef = (name, where) => {
    if (catalog.validNames.has(name)) return;
    const msg = `Stencil not found in catalog: mxgraph.aws4.${name} (at ${where})`;
    const suggestions = searchIcon(catalog, name.replace(/_/g, " "), { limit: 3 }).map((s) => s.name);
    const full = suggestions.length ? `${msg} — suggestions: ${suggestions.join(", ")}` : msg;
    if (strict || !catalog.meta.incomplete) errors.push(full);
    else warnings.push(full + " (catalog is in seed form and may be incomplete — run the generator to verify)");
  };

  for (const n of resIcons) checkRef(n, "resIcon");
  for (const n of grIcons) checkRef(n, "grIcon");
  for (const n of shapes) checkRef(n, "shape");

  // duplicate id check
  const allIds = [...xml.matchAll(/<mxCell\b[^>]*\bid="([^"]+)"/g)].map((match) => match[1]);
  const ids = new Set(allIds);
  if (allIds.length !== ids.size) {
    const seen = new Set();
    for (const id of allIds) {
      if (seen.has(id)) errors.push(`Duplicate cell id: "${id}" — draw.io silently drops one of the cells, causing missing icons or broken edges.`);
      seen.add(id);
    }
  }

  // edge references
  const dangling = [];
  for (const re of [RE_SRC, RE_TGT]) {
    for (const ref of collect(re, xml)) {
      if (!ids.has(ref)) dangling.push(ref);
    }
  }
  for (const d of [...new Set(dangling)]) {
    warnings.push(`Edge references a non-existent id: "${d}"`);
  }

  errors.push(...validateBranches(xml));
  errors.push(...validateArrowConsistency(xml));
  errors.push(...validateFlowAnimations(xml));
  errors.push(...validateEndpointApproaches(xml));
  errors.push(...validateEdgeClearance(xml));
  const pathQuality = validateEdgePathQuality(xml);
  errors.push(...pathQuality.errors);
  warnings.push(...pathQuality.warnings);
  warnings.push(...validateContainerLabels(xml));

  // lint: every style containing resourceIcon should have aspect=fixed
  const iconStyles = xml.match(/style="[^"]*mxgraph\.aws4\.resourceIcon[^"]*"/g) ?? [];
  for (const c of iconStyles) {
    if (!/aspect=fixed/.test(c)) {
      warnings.push("resourceIcon missing 'aspect=fixed' → icon may become distorted when resized.");
      break;
    }
  }

  const audit = auditAesthetics(xml);
  audit.advice.push(...auditAwsConventions(catalog, xml));
  warnings.push(...validateAwsHierarchy(xml));
  audit.advice.push(...auditServiceFrames(catalog, xml));
  audit.advice.push(...auditVisualSemantics(xml));
  audit.advice.push(...auditEdgeLabels(xml));
  audit.advice.push(...auditGeometry(xml));
  audit.advice.push(...auditEdges(xml));
  audit.advice.push(...auditArchitecture(xml));

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    audit,
    stats: {
      resIcons: resIcons.length,
      grIcons: grIcons.length,
      shapes: shapes.length,
      uniqueStencils: new Set([...resIcons, ...grIcons, ...shapes]).size,
      cellIds: ids.size,
    },
  };
}

/** Enforce shared-trunk branching and merging. */
export function validateBranches(xml) {
  const errors = [];
  const cells = parseCells(xml);
  const byId = new Map(cells.filter((c) => c.id).map((c) => [c.id, c]));
  const branchIds = new Set(cells.filter((c) => /(?:^|;)branchPoint=1(?:;|$)/.test(c.style)).map((c) => c.id));
  const mergeIds = new Set(cells.filter((c) => /(?:^|;)mergePoint=1(?:;|$)/.test(c.style)).map((c) => c.id));
  const junctionIds = new Set([...branchIds, ...mergeIds]);
  const incoming = new Map(), outgoing = new Map();
  const edges = [];
  for (const c of cells) {
    if (c.edge !== "1") continue;
    if (c.source) (outgoing.get(c.source) ?? outgoing.set(c.source, []).get(c.source)).push(c.target || "?");
    if (c.target) (incoming.get(c.target) ?? incoming.set(c.target, []).get(c.target)).push(c.source || "?");
    if (c.source && c.target) edges.push(c);
  }

  const typeOf = (id) => {
    const style = byId.get(id)?.style || "";
    const fn = (style.match(/(?:^|;)functionGroup=([^;]+)/) || [])[1];
    if (fn) return `function:${fn}`;
    return (style.match(/(?:^|;)catalogIcon=([^;]+)/) || [])[1]
      || (style.match(/resIcon=mxgraph\.aws4\.([a-zA-Z0-9_]+)/) || [])[1]
      || (style.match(/(?:^|;)serviceIcon=([^;]+)/) || [])[1]
      || null;
  };
  const sideOf = (edge, end) => {
    const prefix = end === "source" ? "exit" : "entry";
    const x = num(edge.style, `${prefix}X`), y = num(edge.style, `${prefix}Y`);
    if (x === 0 && y !== 0 && y !== 1) return "left";
    if (x === 1 && y !== 0 && y !== 1) return "right";
    if (y === 0) return "top";
    if (y === 1) return "bottom";
    if (x === 0) return "left";
    if (x === 1) return "right";
    const here = byId.get(edge[end])?.absGeo, other = byId.get(edge[end === "source" ? "target" : "source"])?.absGeo;
    if (!here || !other) return "unknown";
    const dx = other.x + other.w / 2 - (here.x + here.w / 2), dy = other.y + other.h / 2 - (here.y + here.h / 2);
    return Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? "right" : "left") : (dy >= 0 ? "bottom" : "top");
  };
  // Group equivalent peers by where they are placed relative to the service. Router-selected
  // ports are a presentation detail and may spread one logical fan-out over several faces.
  const semanticSideOf = (edge, end) => {
    const here = byId.get(edge[end])?.absGeo, other = byId.get(edge[end === "source" ? "target" : "source"])?.absGeo;
    if (!here || !other) return sideOf(edge, end);
    const dx = other.x + other.w / 2 - (here.x + here.w / 2), dy = other.y + other.h / 2 - (here.y + here.h / 2);
    return Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? "right" : "left") : (dy >= 0 ? "bottom" : "top");
  };
  const grouped = (direction) => {
    const groups = new Map();
    for (const edge of edges) {
      const node = edge[direction === "out" ? "source" : "target"];
      if (junctionIds.has(node)) continue;
      const peer = edge[direction === "out" ? "target" : "source"], type = typeOf(peer);
      if (!type) continue;
      const side = semanticSideOf(edge, direction === "out" ? "source" : "target");
      const key = `${node}|${side}|${type}`;
      (groups.get(key) ?? groups.set(key, []).get(key)).push(peer);
    }
    return groups;
  };
  const typeLabel = (type) => type.startsWith("function:") ? `function group "${type.slice(9)}"` : `catalog type "${type}"`;
  for (const [key, peers] of grouped("out")) if (peers.length >= 3) {
    const [source, side, type] = key.split("|");
    errors.push(`Service "${source}" has ${peers.length} direct connections to equivalent targets in ${typeLabel(type)} on its ${side} side (${peers.join(", ")}) — group only these targets behind one branch point; keep different service types as individual links.`);
  }
  for (const [key, peers] of grouped("in")) if (peers.length >= 3) {
    const [target, side, type] = key.split("|");
    errors.push(`Service "${target}" has ${peers.length} direct inputs from equivalent sources in ${typeLabel(type)} on its ${side} side (${peers.join(", ")}) — group only these sources through one merge point; keep different service types as individual links.`);
  }
  const sideDegree = new Map();
  for (const edge of edges) for (const end of ["source", "target"]) {
    const id = edge[end]; if (junctionIds.has(id)) continue;
    const key = `${id}|${sideOf(edge, end)}`;
    sideDegree.set(key, (sideDegree.get(key) ?? 0) + 1);
  }
  for (const [key, count] of sideDegree) if (count > 4) {
    const [id, side] = key.split("|");
    errors.push(`Service "${id}" has ${count} incoming/outgoing connections on its ${side} side — keep at most 4; consolidate same-type groups with branch/merge points or move individual links to another side.`);
  }
  for (const id of branchIds) {
    const ins = incoming.get(id)?.length ?? 0, outs = outgoing.get(id)?.length ?? 0;
    if (ins !== 1 || outs < 3)
      errors.push(`Branch point "${id}" must have exactly 1 incoming trunk and at least 3 outgoing equivalent-service branches; found ${ins} incoming and ${outs} outgoing.`);
    const types = new Set((outgoing.get(id) || []).map(typeOf).filter(Boolean));
    if (outs >= 3 && (types.size !== 1 || (outgoing.get(id) || []).some((peer) => !typeOf(peer))))
      errors.push(`Branch point "${id}" may connect only equivalent targets — use the same catalog icon type or functionGroup, and keep different service types on individual links.`);
  }
  for (const id of mergeIds) {
    const ins = incoming.get(id)?.length ?? 0, outs = outgoing.get(id)?.length ?? 0;
    if (ins < 3 || outs !== 1)
      errors.push(`Merge point "${id}" must have at least 3 incoming equivalent-service branches and exactly 1 outgoing trunk; found ${ins} incoming and ${outs} outgoing.`);
    const types = new Set((incoming.get(id) || []).map(typeOf).filter(Boolean));
    if (ins >= 3 && (types.size !== 1 || (incoming.get(id) || []).some((peer) => !typeOf(peer))))
      errors.push(`Merge point "${id}" may connect only equivalent sources — use the same catalog icon type or functionGroup, and keep different service types on individual links.`);
  }
  const styleValue = (style, key, fallback = "") => {
    const matches = [...style.matchAll(new RegExp(`(?:^|;)${key}=([^;]+)`, "g"))];
    return matches.length ? matches[matches.length - 1][1] : fallback;
  };
  const lineType = (edge) => [
    styleValue(edge.style, "strokeColor", "default"),
    styleValue(edge.style, "strokeWidth", "1"),
    styleValue(edge.style, "dashed", "0"),
    styleValue(edge.style, "dashPattern", ""),
    styleValue(edge.style, "rounded", "0"),
    styleValue(edge.style, "flowAnimation", "0"),
    styleValue(edge.style, "edgeArrow", styleValue(edge.style, "endArrow", "classic")),
    styleValue(edge.style, "startArrow", "none"),
    styleValue(edge.style, "endFill", "1"),
    styleValue(edge.style, "endSize", "8"),
  ].join("|");
  for (const id of junctionIds) {
    const incident = edges.filter((edge) => edge.source === id || edge.target === id);
    const types = new Map();
    for (const edge of incident) (types.get(lineType(edge)) ?? types.set(lineType(edge), []).get(lineType(edge))).push(edge.id || `${edge.source}→${edge.target}`);
    if (types.size > 1) {
      const details = [...types.values()].map((ids) => ids.join(", ")).join(" versus ");
      errors.push(`${branchIds.has(id) ? "Branch" : "Merge"} point "${id}" uses inconsistent line types (${details}) — every trunk and branch must use the same stroke, width, dash pattern, corner style, animation, and arrow selection.`);
    }
  }
  for (const id of branchIds) if (mergeIds.has(id))
    errors.push(`Junction "${id}" cannot be both a branch point and a merge point.`);
  return errors;
}

const RE_OPENCELL = /<mxCell\b[^>]*?>/g;
function attr(tag, name) {
  // nosemgrep: detect-non-literal-regexp -- `name` is an internal attribute name (fixed set), not external input; pattern is linear
  const m = tag.match(new RegExp(`\\b${name}="([^"]*)"`));
  return m ? m[1] : null;
}
/** Read a numeric style key (exitX=0.5 …) from a style string. */
// nosemgrep: detect-non-literal-regexp -- `k` is an internal style-key name (fixed set), not external input; pattern is linear
const num = (style, k) => { const m = style.match(new RegExp(`(?:^|;)${k}=([\\d.]+)`)); return m ? +m[1] : null; };

const styleToken = (style, key, fallback = null) => {
  const matches = [...String(style || "").matchAll(new RegExp(`(?:^|;)${key}=([^;]+)`, "g"))];
  return matches.length ? matches[matches.length - 1][1] : fallback;
};

/** Enforce one directional arrowhead selection across the complete diagram. */
export function validateArrowConsistency(xml) {
  const errors = [];
  const byArrow = new Map();
  for (const edge of parseCells(xml).filter((c) => c.edge === "1")) {
    const end = styleToken(edge.style, "endArrow", "classic");
    const arrow = styleToken(edge.style, "edgeArrow", end);
    if (arrow && arrow !== "none") (byArrow.get(arrow) ?? byArrow.set(arrow, []).get(arrow)).push(edge.id || `${edge.source}→${edge.target}`);
    if (end && end !== "none" && arrow && arrow !== "none" && end !== arrow)
      errors.push(`Edge "${edge.id || `${edge.source}→${edge.target}`}" renders endArrow=${end} while its diagram arrow is ${arrow} — use the selected diagram arrowhead.`);
    const start = styleToken(edge.style, "startArrow", "none");
    if (start && start !== "none" && arrow && arrow !== "none" && start !== arrow)
      errors.push(`Edge "${edge.id || `${edge.source}→${edge.target}`}" uses startArrow=${start} with diagram arrow=${arrow} — use the same arrowhead at both ends.`);
  }
  if (byArrow.size > 1) {
    const details = [...byArrow.entries()].map(([arrow, ids]) => `${arrow}: ${ids.slice(0, 5).join(", ")}${ids.length > 5 ? "…" : ""}`).join("; ");
    errors.push(`Diagram uses multiple directional arrowheads (${details}) — select one arrowhead type and apply it to every directional edge.`);
  }
  return errors;
}

/** Flow animation requires a deliberate marker emitted by an explicitly enabled Diagram. */
export function validateFlowAnimations(xml) {
  const errors = [];
  for (const edge of parseCells(xml).filter((c) => c.edge === "1")) {
    if (styleToken(edge.style, "flowAnimation", "0") === "1" && styleToken(edge.style, "flowExplicit", "0") !== "1")
      errors.push(`Edge "${edge.id || `${edge.source}→${edge.target}`}" enables flow animation without explicit diagram opt-in — remove flowAnimation or rebuild with Diagram({ allowFlowAnimation: true }) after the user requests animation.`);
  }
  return errors;
}

/** Ensure terminal segments meet the declared service edge without crossing its body. */
export function validateEndpointApproaches(xml) {
  const errors = [];
  const cells = parseCells(xml);
  const byId = new Map(cells.filter((c) => c.id).map((c) => [c.id, c]));
  const rectOf = (c) => c?.absGeo || c?.geo || null;
  const side = (style, prefix) => {
    const x = num(style, `${prefix}X`), y = num(style, `${prefix}Y`);
    if (y === 0 && x !== 0 && x !== 1) return "top";
    if (y === 1 && x !== 0 && x !== 1) return "bottom";
    if (x === 0) return "left";
    if (x === 1) return "right";
    if (y === 0) return "top";
    if (y === 1) return "bottom";
    return null;
  };
  const wrongSide = (point, rect, declared) => {
    const EPS = 1;
    if (declared === "left") return point.x > rect.x + EPS;
    if (declared === "right") return point.x < rect.x + rect.w - EPS;
    if (declared === "top") return point.y > rect.y + EPS;
    if (declared === "bottom") return point.y < rect.y + rect.h - EPS;
    return false;
  };
  for (const edge of cells) {
    if (edge.edge !== "1" || !edge.source || !edge.target || !(edge.wp || []).length) continue;
    const sourceRect = rectOf(byId.get(edge.source)), targetRect = rectOf(byId.get(edge.target));
    if (!sourceRect || !targetRect) continue;
    const sourceJunction = /(?:^|;)(?:branchPoint|mergePoint)=1(?:;|$)/.test(byId.get(edge.source)?.style || "");
    const targetJunction = /(?:^|;)(?:branchPoint|mergePoint)=1(?:;|$)/.test(byId.get(edge.target)?.style || "");
    const exitSide = side(edge.style, "exit"), entrySide = side(edge.style, "entry");
    if (!sourceJunction && exitSide && wrongSide(edge.wp[0], sourceRect, exitSide))
      errors.push(`Edge "${edge.id || `${edge.source}→${edge.target}`}" departs service "${edge.source}" through its ${exitSide} edge while the first segment lies inside or across the service — shift the port to the nearest outward edge.`);
    if (!targetJunction && entrySide && wrongSide(edge.wp[edge.wp.length - 1], targetRect, entrySide))
      errors.push(`Edge "${edge.id || `${edge.source}→${edge.target}`}" approaches service "${edge.target}" from the wrong side of its ${entrySide} edge — shift the arrow to the nearest edge so the terminal segment stays outside the service body.`);
  }
  return errors;
}

/**
 * Aesthetics check derived from comparing the AI-drawn version against the human-corrected one.
 * Only considers edge routing / layout / visual consistency. Returns advisories (not hard errors).
 */
export function auditAesthetics(xml) {
  const advice = [];

  // 1) Font sizes: limit to 3–4 VERTEX sizes (edge-label size is an engine
  //    constant, not a design choice — don't count it against the budget).
  const fontSizes = [];
  let bigCells = 0;
  for (const tag of xml.match(RE_OPENCELL) ?? []) {
    if (/\bedge="1"/.test(tag)) continue;
    const s = num(attr(tag, "style") || "", "fontSize");
    if (s == null) continue;
    fontSizes.push(s);
    if (s >= 16) bigCells++;
  }
  const uniqFonts = [...new Set(fontSizes)].sort((a, b) => a - b);
  if (uniqFonts.length > 4)
    advice.push(`Too many font sizes (${uniqFonts.length}): [${uniqFonts.join(", ")}] — limit to 3–4 sizes for consistency.`);
  // One hero title/band per page may be large; flag repeated oversizing or extremes.
  const big = uniqFonts.filter((s) => s >= 16);
  if (bigCells > 1 || big.some((s) => s > 20))
    advice.push(`Font sizes too large [${big.join(", ")}] on ${bigCells} cells — use ≤ 14 for labels; at most one hero title per page.`);

  // 2) Palette: only count BACKGROUND/BOX colors — ignore AWS icon/group colors (mandated by category).
  const fills = [];
  for (const tag of xml.match(RE_OPENCELL) ?? []) {
    const st = attr(tag, "style") || "";
    if (/mxgraph\.aws4\.(resourceIcon|group)/.test(st)) continue; // icon/group colors are canonical
    const fm = st.match(/fillColor=([^;"}]+)/);
    if (fm) fills.push(fm[1].trim().toLowerCase());
  }
  const uniqFills = [...new Set(fills.filter((c) => c && c !== "none" && c !== "default"))];
  if (uniqFills.length > 8)
    advice.push(`Palette too scattered (${uniqFills.length} background colors) — use a limited palette, reserve strong colors for accents/notes.`);
  if (uniqFills.length && !/light-dark\(/.test(xml))
    advice.push("Consider light-dark(...) color tokens for backgrounds/accents so the diagram looks good in both light & dark mode.");

  // 3) Edges: collect source/target/style of every edge.
  const edges = [];
  for (const tag of xml.match(RE_OPENCELL) ?? []) {
    if (attr(tag, "edge") !== "1") continue;
    edges.push({ source: attr(tag, "source"), target: attr(tag, "target"), style: attr(tag, "style") || "" });
  }
  const bySource = new Map();
  for (const e of edges) {
    if (!e.source) continue;
    if (!bySource.has(e.source)) bySource.set(e.source, []);
    bySource.get(e.source).push(e);
  }
  // fan-out (1 source → ≥3 targets): should use sharp corners + pinned connection points so the parallel edges align.
  for (const [src, list] of bySource) {
    if (list.length < 3) continue;
    if (list.every((e) => /rounded=1/.test(e.style)))
      advice.push(`Fan-out branch from "${src}" (${list.length} edges) should use rounded=0 (sharp corners) instead of rounded.`);
    if (list.every((e) => !/(exitX|entryX)=/.test(e.style)))
      advice.push(`Pin connection points (exitX/exitY, entryX/entryY) for the fan-out branch from "${src}" so the parallel edges align.`);
  }

  // 4) Consistent icon sizes.
  const iconW = [
    ...xml.matchAll(/<mxCell\b[^>]*resourceIcon[^>]*>\s*<mxGeometry\b[^>]*\bwidth="([\d.]+)"/g),
  ].map((m) => Number(m[1]));
  const uniqW = [...new Set(iconW)];
  if (uniqW.length > 2)
    advice.push(`Inconsistent icon sizes [${uniqW.sort((a, b) => a - b).join(", ")}] — should use a single size (e.g. 48 or 78).`);

  return {
    advice,
    metrics: { fontSizes: uniqFonts, fillColors: uniqFills.length, edges: edges.length, fanOutSources: [...bySource.values()].filter((l) => l.length >= 3).length },
  };
}

/**
 * Check conventions specific to AWS architecture:
 *  - icons recolored away from their standard category color (loss of recognizability).
 * Returns advisories.
 */
export function auditAwsConventions(catalog, xml) {
  const advice = [];
  const cells = (xml.match(RE_OPENCELL) ?? []).map((tag) => ({
    id: attr(tag, "id"),
    parent: attr(tag, "parent"),
    edge: attr(tag, "edge"),
    style: attr(tag, "style") || "",
  }));
  // 1) Icon recolored relative to its own standard color.
  for (const c of cells) {
    const m = c.style.match(/resIcon=mxgraph\.aws4\.([a-zA-Z0-9_]+)/);
    if (!m) continue;
    const entry = catalog.byName.get(m[1]);
    if (!entry?.color) continue;
    const fm = c.style.match(/fillColor=([^;]+)/);
    if (!fm) continue;
    const used = fm[1].trim().toLowerCase();
    if (used.startsWith("light-dark")) continue;
    if (used !== String(entry.color).trim().toLowerCase())
      advice.push(`Icon "${m[1]}" has been recolored (fillColor=${fm[1].trim()} ≠ standard color ${entry.color}) — keep the category color for easy recognition.`);
  }

  // 2) Rounded frames — AWS architecture diagrams use SQUARE corners for boxes/frames.
  //    (Skip edges: rounded on an edge smooths its corners, unrelated. Skip AWS stencils & text.)
  const roundedFrames = cells
    .filter((c) => c.edge !== "1" && /(?:^|;)rounded=1/.test(c.style) && !/mxgraph\.aws4\./.test(c.style) && !/(?:^|;)text;/.test(c.style))
    .map((c) => c.id || "?");
  if (roundedFrames.length)
    advice.push(`Rounded frame(s) found (${roundedFrames.length}: ${roundedFrames.slice(0, 6).join(", ")}${roundedFrames.length > 6 ? "…" : ""}) — AWS diagrams use SQUARE corners; set rounded=0 on these boxes/frames.`);

  return advice;
}

const AWS_CLOUD_GROUP = "group_aws_cloud_alt";
const AWS_GROUP_CHAIN = {
  group_account: ["cloud"],
  group_region: ["group_account", "cloud"],
  group_vpc: ["group_region", "group_account", "cloud"],
  group_vpc2: ["group_region", "group_account", "cloud"],
  group_availability_zone: ["group_vpc", "group_region", "group_account", "cloud"],
  group_subnet: ["group_availability_zone", "group_vpc", "group_region", "group_account", "cloud"],
  group_security_group: ["group_subnet", "group_availability_zone", "group_vpc", "group_region", "group_account", "cloud"],
};

/** Enforce the structural AWS parent chain used by diagrams with official AWS services. */
export function validateAwsHierarchy(xml) {
  if (!/mxgraph\.aws4\./.test(xml)) return [];
  const warnings = [];
  const cells = parseCells(xml);
  const byId = new Map(cells.filter((c) => c.id).map((c) => [c.id, c]));
  const groupName = (c) => (c?.style.match(/grIcon=mxgraph\.aws4\.([a-zA-Z0-9_]+)/) || [])[1] || null;
  const serviceName = (c) => {
    const resource = (c.style.match(/resIcon=mxgraph\.aws4\.([a-zA-Z0-9_]+)/) || [])[1];
    if (resource) return resource;
    const shape = (c.style.match(/shape=mxgraph\.aws4\.([a-zA-Z0-9_]+)/) || [])[1];
    if (!shape || ["group", "groupCenter", "productIcon", "resourceIcon", "resourceIcon2"].includes(shape)) return null;
    return shape;
  };
  const ancestors = (c) => {
    const out = [];
    let parent = byId.get(c.parent);
    let guard = 0;
    while (parent && guard++ < 50) {
      const group = groupName(parent);
      if (group) out.push(group === AWS_CLOUD_GROUP ? "cloud" : group === "group_vpc2" ? "group_vpc" : group);
      parent = byId.get(parent.parent);
    }
    return out;
  };
  const follows = (actual, required) => {
    let cursor = 0;
    for (const token of actual) if (token === required[cursor]) cursor++;
    return cursor === required.length;
  };
  const label = (required) => [...required].reverse().map((name) => name === "cloud" ? "AWS Cloud" : ({
    group_account: "AWS Account",
    group_region: "AWS Region",
    group_vpc: "VPC",
    group_availability_zone: "Availability Zone",
    group_subnet: "Subnet",
  }[name] || name)).join(" → ");

  for (const c of cells) {
    if (!c.id || c.edge === "1") continue;
    const group = groupName(c);
    if (group === "group_aws_cloud")
      warnings.push(`AWS container "${c.id}" uses group_aws_cloud — use the black AWS Cloud container group_aws_cloud_alt.`);
    const required = group ? AWS_GROUP_CHAIN[group] : null;
    if (required && !follows(ancestors(c), required))
      warnings.push(`AWS container "${c.id}" (${group}) requires parent chain ${label(required)}.`);

    const service = serviceName(c);
    const serviceFrame = /(?:^|;)serviceFrame=1(?:;|$)/.test(c.style);
    const decorativeBadge = /__ci$/.test(c.id) || (c.geo && c.geo.w < 32 && c.geo.h < 32);
    if ((service || serviceFrame) && !decorativeBadge) {
      const requiredServiceChain = ["group_region", "group_account", "cloud"];
      if (!follows(ancestors(c), requiredServiceChain))
        warnings.push(`AWS service "${c.id}"${service ? ` (${service})` : ""} requires parent chain ${label(requiredServiceChain)}.`);
    }
  }

  return warnings;
}

const IMPLICIT_CROSS_CUTTING_RE = /(?:^|_)(?:identity_and_access_management|iam|cloudformation|cloudwatch(?:_logs)?|cloudtrail|config|audit_manager|security_hub|guardduty|inspector|x_ray|organizations|control_tower|trusted_advisor)(?:_|$)/;

/** Flag prose-heavy cells and operational AWS services with no incident relationship. */
export function auditVisualSemantics(xml) {
  const advice = [];
  if (!/mxgraph\.aws4\.|serviceFrame=1(?:;|")/.test(xml)) return advice;
  const cells = parseCells(xml);
  const hasChildren = new Set(cells.map((c) => c.parent).filter(Boolean));
  const incident = new Set();
  for (const c of cells) {
    if (c.edge !== "1") continue;
    if (c.source) incident.add(c.source);
    if (c.target) incident.add(c.target);
  }
  const serviceName = (c) => {
    const resource = (c.style.match(/resIcon=mxgraph\.aws4\.([a-zA-Z0-9_]+)/) || [])[1];
    if (resource) return resource;
    const shape = (c.style.match(/shape=mxgraph\.aws4\.([a-zA-Z0-9_]+)/) || [])[1];
    if (!shape || ["group", "groupCenter", "productIcon", "resourceIcon", "resourceIcon2"].includes(shape)) return null;
    return shape;
  };
  const words = (value) => {
    const text = String(value || "")
      .replace(/&lt;br\s*\/?&gt;/gi, " ")
      .replace(/&[a-zA-Z0-9#]+;/g, " ")
      .replace(/<[^>]*>/g, " ")
      .replace(/[^\p{L}\p{N}+#/.:-]+/gu, " ")
      .trim();
    return text ? text.split(/\s+/).length : 0;
  };
  const isText = (c) => /(?:^|;)text;/.test(c.style) || c.id === "__title";
  const isContainer = (c) => hasChildren.has(c.id) || /container=1|shape=mxgraph\.aws4\.group|grIcon=/.test(c.style);
  const verbose = [];
  const deploymentNames = [];
  for (const c of cells) {
    if (c.edge === "1" || !c.id || isText(c)) continue;
    const count = words(c.value);
    if (!count) continue;
    const service = serviceName(c);
    const limit = service ? 4 : isContainer(c) ? 5 : 8;
    if (count > limit) verbose.push(`${c.id} (${count} words; cap ${limit})`);
    if (service && /&lt;|&gt;|[<>{}$]|(?:account|region)[_-]?id|\b\d{12}\b|\b(?:us|af|ap|ca|eu|il|me|mx|sa)-(?:gov-)?[a-z]+-\d\b/i.test(c.value || ""))
      deploymentNames.push(c.id);
  }
  if (verbose.length)
    advice.push(`Prose-heavy architecture label(s): ${verbose.slice(0, 5).join(", ")}${verbose.length > 5 ? "…" : ""} — replace explanatory text with icons, containers, and short edge labels; move details to the surrounding document.`);
  if (deploymentNames.length)
    advice.push(`AWS service label(s) contain deployment data, variables, or placeholders: ${deploymentNames.slice(0, 6).join(", ")}${deploymentNames.length > 6 ? "…" : ""} — use short human-readable service names.`);

  const orphans = [];
  for (const c of cells) {
    if (c.edge === "1" || !c.id || incident.has(c.id)) continue;
    const frameIcon = (c.style.match(/(?:^|;)serviceIcon=([^;]+)/) || [])[1];
    const name = serviceName(c) || (/(?:^|;)serviceFrame=1(?:;|$)/.test(c.style) ? frameIcon : null);
    if (!name || IMPLICIT_CROSS_CUTTING_RE.test(name)) continue;
    const geometry = c.absGeo || c.geo;
    if (!geometry || geometry.w < 32 || geometry.h < 32 || /__ci$/.test(c.id)) continue;
    orphans.push(`${c.id} (${name})`);
  }
  if (orphans.length)
    advice.push(`Orphan operational AWS service icon(s): ${orphans.slice(0, 6).join(", ")}${orphans.length > 6 ? "…" : ""} — add a direct producer, consumer, dependency, or data-flow edge. Decorative badges and cross-cutting governance, observability, or provisioning services may remain unwired.`);
  return advice;
}

/** Validate the reusable serviceFrame visual contract emitted by the layout engine. */
export function auditServiceFrames(catalog, xml) {
  const advice = [];
  const cells = parseCells(xml);
  const byId = new Map(cells.filter((c) => c.id).map((c) => [c.id, c]));
  const frames = cells.filter((c) => /(?:^|;)serviceFrame=1(?:;|$)/.test(c.style));
  const borderPatterns = {
    solid: /(?:^|;)dashed=0(?:;|$)/,
    dashed: /(?:^|;)dashPattern=8 4(?:;|$)/,
    dotted: /(?:^|;)dashPattern=1 4(?:;|$)/,
    "dash-dot": /(?:^|;)dashPattern=8 4 1 4(?:;|$)/,
  };
  for (const frame of frames) {
    const iconName = (frame.style.match(/(?:^|;)serviceIcon=([^;]+)/) || [])[1];
    const borderStyle = (frame.style.match(/(?:^|;)serviceBorder=([^;]+)/) || [])[1];
    const fontStyle = Number((frame.style.match(/(?:^|;)fontStyle=(\d+)/) || [])[1] || 0);
    const badge = byId.get(`${frame.id}__ci`);
    const entry = iconName ? catalog.byName.get(iconName) : null;
    const stroke = (frame.style.match(/(?:^|;)strokeColor=([^;]+)/) || [])[1] || "";
    const children = cells.filter((c) => c.parent === frame.id && c.id !== `${frame.id}__ci`);
    if (!iconName || !entry)
      advice.push(`Service frame "${frame.id}" has an unknown or missing serviceIcon — create it with serviceFrame(id, icon, name, opts, children).`);
    if (fontStyle !== 0)
      advice.push(`Service frame "${frame.id}" title is bold or italic — use normal fontStyle=0.`);
    if (!badge || badge.parent !== frame.id || !badge.geo || Math.abs(badge.geo.x) > 0.1 || Math.abs(badge.geo.y) > 0.1)
      advice.push(`Service frame "${frame.id}" corner icon is not flush with the top-left border — place its badge at relative x=0, y=0.`);
    if (!borderPatterns[borderStyle]?.test(frame.style))
      advice.push(`Service frame "${frame.id}" has an invalid border style — use solid, dashed, dotted, or dash-dot.`);
    if (entry?.color && (!stroke.startsWith("light-dark(") || !stroke.toLowerCase().includes(String(entry.color).toLowerCase())))
      advice.push(`Service frame "${frame.id}" border does not follow the ${iconName} category colour in light/dark mode.`);
    if (!children.length)
      advice.push(`Service frame "${frame.id}" has no owned child nodes — use a normal service icon instead.`);
    if (/[<>{}$]|(?:account|region)[_-]?id|\b\d{12}\b|\b(?:us|af|ap|ca|eu|il|me|mx|sa)-(?:gov-)?[a-z]+-\d\b/i.test(frame.value || ""))
      advice.push(`Service frame "${frame.id}" name contains deployment data, a variable, or a placeholder — use a short human-readable service name.`);
    let parent = byId.get(frame.parent);
    let depth = 1;
    while (parent) {
      if (/(?:^|;)serviceFrame=1(?:;|$)/.test(parent.style)) depth++;
      parent = byId.get(parent.parent);
    }
    if (depth > 2)
      advice.push(`Service frame "${frame.id}" is nested ${depth} service boundaries deep — flatten the diagram or use an edge.`);
  }
  return advice;
}

/** Parse every mxCell (with geometry & waypoint flag) for coordinate-based checks. */
function parseCells(xml) {
  const out = [];
  for (const ch of xml.split(/<mxCell\b/).slice(1)) {
    const end = ch.indexOf(">");
    const head = ch.slice(0, end + 1);
    const body = ch.slice(end + 1);
    // nosemgrep: detect-non-literal-regexp -- `n` is an internal attribute name (fixed set), not external input; pattern is linear
    const a = (n) => { const m = head.match(new RegExp(`\\b${n}="([^"]*)"`)); return m ? m[1] : null; };
    let geo = null;
    const g = body.match(/<mxGeometry\b[^>]*?(?:\/>|>)/);
    if (g) {
      const t = g[0];
      const gx = t.match(/\bx="(-?[\d.]+)"/), gy = t.match(/\by="(-?[\d.]+)"/);
      const gw = t.match(/\bwidth="([\d.]+)"/), gh = t.match(/\bheight="([\d.]+)"/);
      if (gx && gy && gw && gh) geo = { x: +gx[1], y: +gy[1], w: +gw[1], h: +gh[1] };
    }
    const wp = [...body.matchAll(/<mxPoint\s+x="(-?[\d.]+)"\s+y="(-?[\d.]+)"\s*\/>/g)].map((m) => ({ x: +m[1], y: +m[2] }));
    out.push({ id: a("id"), parent: a("parent"), source: a("source"), target: a("target"), edge: a("edge"), value: a("value"), style: a("style") || "", hasPoints: /as="points"/.test(body), wp, geo });
  }
  // resolve ABSOLUTE coordinates for nested cells (geometry in the XML is relative to the parent)
  const byId = new Map(out.filter((c) => c.id).map((c) => [c.id, c]));
  for (const c of out) {
    if (!c.geo) continue;
    let ax = c.geo.x, ay = c.geo.y, p = byId.get(c.parent), guard = 0;
    while (p && p.geo && guard++ < 50) { ax += p.geo.x; ay += p.geo.y; p = byId.get(p.parent); }
    c.absGeo = { x: ax, y: ay, w: c.geo.w, h: c.geo.h };
  }
  return out;
}

const MIN_EDGE_CLEARANCE = 10;

/** Ask for an explicit decision whenever a visible container has no reader-facing name. */
export function validateContainerLabels(xml) {
  const warnings = [];
  const cells = parseCells(xml);
  const hasChildren = new Set(cells.map((c) => c.parent).filter(Boolean));
  const isJunction = (c) => /(?:^|;)(?:branchPoint|mergePoint)=1(?:;|$)/.test(c.style || "");
  const isText = (c) => /(?:^|;)text;/.test(c.style || "") || c.id === "__title";
  const isVisibleContainer = (c) => {
    if (!c.id || c.edge === "1" || !c.geo || isJunction(c) || isText(c)) return false;
    if (hasChildren.has(c.id)) return true;
    return /(?:^|;)container=1(?:;|$)|grIcon=|serviceFrame=1|shape=mxgraph\.aws4\.group/.test(c.style || "")
      || (c.parent === "boundaries" && !/_icon$/.test(c.id));
  };
  for (const c of cells.filter(isVisibleContainer)) {
    const label = String(c.value || "").replace(/<[^>]*>/g, "").replace(/&nbsp;/gi, " ").trim();
    if (!label)
      warnings.push(`Container "${c.id}" has an empty name — confirm that it communicates meaningful ownership, scope, or grouping; add a short label, or replace the visible frame with a phantom/layout grouping when it exists only for alignment.`);
  }
  return warnings;
}

/** Detect routed paths that are technically valid but visibly broken, jagged, or looped back. */
export function validateEdgePathQuality(xml) {
  const errors = [], warnings = [];
  const cells = parseCells(xml);
  const byId = new Map(cells.filter((c) => c.id).map((c) => [c.id, c]));
  const rectOf = (c) => c?.absGeo || c?.geo || null;
  const pointOn = (r, x, y) => ({ x: r.x + (x ?? 0.5) * r.w, y: r.y + (y ?? 0.5) * r.h });
  const EPS = 0.5;
  const between = (v, a, b) => v > Math.min(a, b) + EPS && v < Math.max(a, b) - EPS;
  for (const edge of cells) {
    if (edge.edge !== "1" || !edge.source || !edge.target || !(edge.wp || []).length) continue;
    const sg = rectOf(byId.get(edge.source)), tg = rectOf(byId.get(edge.target));
    if (!sg || !tg) continue;
    const start = pointOn(sg, num(edge.style, "exitX"), num(edge.style, "exitY"));
    const end = pointOn(tg, num(edge.style, "entryX"), num(edge.style, "entryY"));
    const points = [start, ...edge.wp, end].filter((p, i, all) => !i || Math.abs(p.x - all[i - 1].x) > EPS || Math.abs(p.y - all[i - 1].y) > EPS);
    const name = `Edge "${edge.id || `${edge.source}→${edge.target}`}" (${edge.source}→${edge.target})`;
    const segments = points.slice(0, -1).map((a, i) => ({ a, b: points[i + 1], i }));
    const diagonal = segments.find((s) => Math.abs(s.a.x - s.b.x) > EPS && Math.abs(s.a.y - s.b.y) > EPS);
    if (diagonal) {
      errors.push(`${name} contains a diagonal or jagged segment — route it as a clean orthogonal path.`);
      continue;
    }
    const dx = end.x - start.x, dy = end.y - start.y;
    const horizontal = Math.abs(dx) >= Math.abs(dy), direction = Math.sign(horizontal ? dx : dy);
    const directAxis = Math.abs(horizontal ? dx : dy);
    let reverse = 0, length = 0;
    for (const s of segments) {
      const sx = s.b.x - s.a.x, sy = s.b.y - s.a.y;
      length += Math.abs(sx) + Math.abs(sy);
      const movement = horizontal ? sx : sy;
      if (direction && movement && Math.sign(movement) !== direction) reverse += Math.abs(movement);
    }
    if (reverse > Math.max(32, directAxis * 0.12))
      errors.push(`${name} backtracks ${Math.round(reverse)}px against its main ${horizontal ? "horizontal" : "vertical"} direction — reroute it through a monotonic corridor or reposition the endpoints.`);

    let selfCrosses = false;
    for (let i = 0; i < segments.length && !selfCrosses; i++) for (let j = i + 2; j < segments.length; j++) {
      const a = segments[i], b = segments[j];
      const ah = Math.abs(a.a.y - a.b.y) <= EPS, bh = Math.abs(b.a.y - b.b.y) <= EPS;
      if (ah === bh) continue;
      const h = ah ? a : b, v = ah ? b : a;
      if (between(v.a.x, h.a.x, h.b.x) && between(h.a.y, v.a.y, v.b.y)) selfCrosses = true;
    }
    if (selfCrosses) errors.push(`${name} crosses itself — use one traceable orthogonal corridor.`);

    const bends = Math.max(0, points.length - 2);
    const manhattan = Math.abs(dx) + Math.abs(dy);
    if (bends > 4 || (manhattan > 0 && length > manhattan * 1.6 + 80))
      warnings.push(`${name} uses ${bends} bends and ${Math.round(length)}px of routing for a ${Math.round(manhattan)}px Manhattan path — simplify the corridor or move the connected services closer.`);
  }
  return { errors, warnings };
}

/** Hard geometry gate for routed edges: protect unrelated primitives and separate independent links. */
export function validateEdgeClearance(xml, { minClearance = MIN_EDGE_CLEARANCE } = {}) {
  const errors = [];
  const cells = parseCells(xml);
  const byId = new Map(cells.filter((c) => c.id).map((c) => [c.id, c]));
  const rectOf = (c) => c?.absGeo || c?.geo || null;
  const isJunction = (c) => /(?:^|;)(?:branchPoint|mergePoint)=1(?:;|$)/.test(c?.style || "");
  const pointOn = (r, x, y) => ({ x: r.x + (x ?? 0.5) * r.w, y: r.y + (y ?? 0.5) * r.h });
  const holds = (outer, inner) => inner.x >= outer.x - 2 && inner.y >= outer.y - 2 && inner.x + inner.w <= outer.x + outer.w + 2 && inner.y + inner.h <= outer.y + outer.h + 2;
  const cleanPoints = (points) => points.filter((p, i) => !i || Math.abs(p.x - points[i - 1].x) > 0.1 || Math.abs(p.y - points[i - 1].y) > 0.1);
  const hasChildren = new Set(cells.map((c) => c.parent).filter(Boolean));
  const isContainer = (c) => hasChildren.has(c.id) || /container=1|shape=mxgraph\.aws4\.group|grIcon=|serviceFrame=1/.test(c.style || "");

  const routed = [];
  for (const edge of cells) {
    if (edge.edge !== "1" || !edge.source || !edge.target) continue;
    const sg = rectOf(byId.get(edge.source)), tg = rectOf(byId.get(edge.target));
    if (!sg || !tg) continue;
    const start = pointOn(sg, num(edge.style, "exitX"), num(edge.style, "exitY"));
    const end = pointOn(tg, num(edge.style, "entryX"), num(edge.style, "entryY"));
    let points = [start, ...(edge.wp || []), end];
    if (!(edge.wp || []).length && Math.abs(start.x - end.x) > 1 && Math.abs(start.y - end.y) > 1) {
      const horizontal = num(edge.style, "exitX") != null;
      points = horizontal
        ? [start, { x: (start.x + end.x) / 2, y: start.y }, { x: (start.x + end.x) / 2, y: end.y }, end]
        : [start, { x: start.x, y: (start.y + end.y) / 2 }, { x: end.x, y: (start.y + end.y) / 2 }, end];
    }
    points = cleanPoints(points);
    routed.push({ edge, sg, tg, points, segments: points.slice(0, -1).map((a, i) => ({ a, b: points[i + 1], index: i, last: points.length - 2 })) });
  }

  const segmentHitsRect = (a, b, rect) => {
    const inset = Math.min(rect.w, rect.h) > 4 ? 1 : 0;
    const r = { x: rect.x + inset, y: rect.y + inset, w: Math.max(0, rect.w - inset * 2), h: Math.max(0, rect.h - inset * 2) };
    let t0 = 0, t1 = 1;
    const dx = b.x - a.x, dy = b.y - a.y;
    for (const [p, q] of [[-dx, a.x - r.x], [dx, r.x + r.w - a.x], [-dy, a.y - r.y], [dy, r.y + r.h - a.y]]) {
      if (Math.abs(p) < 1e-9) { if (q < 0) return false; continue; }
      const t = q / p;
      if (p < 0) { if (t > t1) return false; t0 = Math.max(t0, t); }
      else { if (t < t0) return false; t1 = Math.min(t1, t); }
    }
    return t1 - t0 > 1e-4;
  };

  const primitives = cells.filter((c) => c.edge !== "1" && c.id && rectOf(c) && !isJunction(c) && !isContainer(c) && c.id !== "0" && c.id !== "1");
  for (const route of routed) {
    for (const primitive of primitives) {
      if (primitive.id === route.edge.source || primitive.id === route.edge.target) continue;
      const pr = rectOf(primitive);
      if (holds(pr, route.sg) || holds(pr, route.tg)) continue;
      if (route.segments.some((segment) => segmentHitsRect(segment.a, segment.b, pr)))
        errors.push(`Edge "${route.edge.id || `${route.edge.source}→${route.edge.target}`}" (${route.edge.source}→${route.edge.target}) crosses unrelated primitive "${primitive.id}" — route around its visible geometry or connect directly to it.`);
    }
  }

  // Container bodies are routing space. Protect their reader-facing header strip so compact paths
  // may cross a logical frame without running through its title.
  const headers = cells.filter((c) => c.edge !== "1" && c.id && rectOf(c) && isContainer(c) && String(c.value || "").trim())
    .map((c) => ({ c, rect: { ...rectOf(c), h: Math.min(30, rectOf(c).h) } }));
  for (const route of routed) for (const { c, rect } of headers) {
    if (c.id === route.edge.source || c.id === route.edge.target) continue;
    if (route.segments.some((segment) => segmentHitsRect(segment.a, segment.b, rect)))
      errors.push(`Edge "${route.edge.id || `${route.edge.source}→${route.edge.target}`}" (${route.edge.source}→${route.edge.target}) crosses container header "${c.id}" — cross the frame through open body space and keep its title clear.`);
  }

  const parallelDistance = (s, t) => {
    const sv = Math.abs(s.a.x - s.b.x) < 1, tv = Math.abs(t.a.x - t.b.x) < 1;
    const sh = Math.abs(s.a.y - s.b.y) < 1, th = Math.abs(t.a.y - t.b.y) < 1;
    if ((!sv && !sh) || (!tv && !th) || sv !== tv) return Infinity;
    const overlap = sv
      ? Math.min(Math.max(s.a.y, s.b.y), Math.max(t.a.y, t.b.y)) - Math.max(Math.min(s.a.y, s.b.y), Math.min(t.a.y, t.b.y))
      : Math.min(Math.max(s.a.x, s.b.x), Math.max(t.a.x, t.b.x)) - Math.max(Math.min(s.a.x, s.b.x), Math.min(t.a.x, t.b.x));
    if (overlap <= 1) return Infinity;
    return sv ? Math.abs(s.a.x - t.a.x) : Math.abs(s.a.y - t.a.y);
  };
  const touches = (segment, route, node) => (node === route.edge.source && segment.index === 0) || (node === route.edge.target && segment.index === segment.last);
  const pairErrors = new Set();
  for (let i = 0; i < routed.length; i++) for (let j = i + 1; j < routed.length; j++) {
    const a = routed[i], b = routed[j];
    if (a.edge.source === b.edge.source && a.edge.target === b.edge.target) {
      pairErrors.add(`Edges "${a.edge.id || i}" and "${b.edge.id || j}" duplicate the same ${a.edge.source}→${a.edge.target} route — keep one link.`);
      continue;
    }
    const sameBundle = [a.edge.source, a.edge.target].some((n) => isJunction(byId.get(n)) && (n === b.edge.source || n === b.edge.target));
    const shared = [a.edge.source, a.edge.target].filter((id) => id === b.edge.source || id === b.edge.target);
    let best = Infinity;
    for (const sa of a.segments) for (const sb of b.segments) {
      if (sameBundle) continue;
      if (shared.some((node) => touches(sa, a, node) && touches(sb, b, node))) continue;
      best = Math.min(best, parallelDistance(sa, sb));
    }
    if (best < minClearance) pairErrors.add(`Edges "${a.edge.id || i}" (${a.edge.source}→${a.edge.target}) and "${b.edge.id || j}" (${b.edge.source}→${b.edge.target}) ${best < 0.5 ? "overlap on the same track" : `run ${best.toFixed(1)}px apart`} — maintain at least ${minClearance}px clearance between parallel independent links.`);
  }
  errors.push(...pairErrors);
  return errors;
}

/**
 * Edge labels on bent routes (L/Z): when source & target are offset in both X and Y but the edge
 * has no waypoint, the label (by default at the midpoint of the arc) tends to fall on the bend / box
 * edge → it looks misaligned.
 * Recommendation: add one waypoint in the middle of the corridor so the label sits centered on a straight segment.
 */
export function auditEdgeLabels(xml) {
  const advice = [];
  const bentLabels = [];
  const cells = parseCells(xml);
  const geoOf = new Map();
  for (const c of cells) if (c.geo && c.id) geoOf.set(c.id, c.absGeo || c.geo);
  // absolute connection point: prefer pinned exit/entry, otherwise use the node center
  const point = (g, fx, fy) => ({ x: g.x + (fx != null ? fx : 0.5) * g.w, y: g.y + (fy != null ? fy : 0.5) * g.h });
  for (const c of cells) {
    if (c.edge !== "1") continue;
    const label = (c.value || "").trim();
    if (!label || c.hasPoints) continue;
    const sg = geoOf.get(c.source), tg = geoOf.get(c.target);
    if (!sg || !tg) continue;
    const ep = point(sg, num(c.style, "exitX"), num(c.style, "exitY"));
    const np = point(tg, num(c.style, "entryX"), num(c.style, "entryY"));
    const straight = Math.abs(ep.y - np.y) <= 8 || Math.abs(ep.x - np.x) <= 8; // horizontally or vertically straight
    if (!straight) bentLabels.push(`"${label}"`);
  }
  // ponytail: one aggregated line — the per-label sentence repeated N times cost ~170 B per finding
  // in every validate pass of every fix iteration
  if (bentLabels.length)
    advice.push(`Edge label(s) ${bentLabels.join(", ")} sit on a bent route (L/Z) — add one waypoint in the middle of each corridor so the label sits centered on a straight segment.`);
  return advice;
}

/**
 * Geometric audit — catches the visual bugs that name/color/nesting checks miss, WITHOUT a render:
 *  1. a child cell spilling outside its parent container ("box exceeds its frame"),
 *  2. two sibling leaf cells whose boxes PARTIALLY overlap (a real collision, not intentional layering),
 *  3. multiple edges entering one target at the same point (stacked arrowheads).
 * Works off absolute geometry resolved through the parent chain. Tuned to avoid false positives on
 * intentional layering (a badge icon fully inside a box, a bus spanning across a container).
 */
export function auditGeometry(xml) {
  const advice = [];
  const cells = parseCells(xml);
  const byId = new Map(cells.filter((c) => c.id).map((c) => [c.id, c]));
  const hasChildren = new Set(cells.map((c) => c.parent).filter(Boolean));
  const TOL = 3;
  const box = (c) => c.absGeo || c.geo;
  const isText = (c) => /(?:^|;)text;/.test(c.style) || c.id === "__title";
  const isContainer = (c) => /container=1|shape=mxgraph\.aws4\.group|grIcon=/.test(c.style) || hasChildren.has(c.id);
  const isVertex = (c) => c.edge !== "1" && c.geo && c.id && !isText(c);
  const contains = (a, b) => b.x >= a.x - TOL && b.y >= a.y - TOL && b.x + b.w <= a.x + a.w + TOL && b.y + b.h <= a.y + a.h + TOL;

  // 1) child spilling outside its parent container
  for (const c of cells) {
    if (!isVertex(c)) continue;
    const p = byId.get(c.parent);
    if (!p || !p.geo) continue;                 // parent must be a real container box (not root layer "1")
    const cb = box(c), pb = box(p);
    if (cb.x < pb.x - TOL || cb.y < pb.y - TOL || cb.x + cb.w > pb.x + pb.w + TOL || cb.y + cb.h > pb.y + pb.h + TOL)
      advice.push(`Cell "${c.id}" spills outside its container "${c.parent}" — enlarge the frame or shrink/reposition the child.`);
  }

  // 2) overlapping sibling LEAF cells (same parent, neither a container, partial overlap only)
  const sibsOf = new Map();
  for (const c of cells) {
    if (!isVertex(c) || isContainer(c)) continue;
    (sibsOf.get(c.parent) ?? sibsOf.set(c.parent, []).get(c.parent)).push(c);
  }
  const seen = new Set();
  for (const [, sibs] of sibsOf) {
    for (let i = 0; i < sibs.length; i++) for (let j = i + 1; j < sibs.length; j++) {
      const a = box(sibs[i]), b = box(sibs[j]);
      const ix = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      const iy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      if (ix <= TOL || iy <= TOL) continue;                       // not overlapping
      if (contains(a, b) || contains(b, a)) continue;             // intentional layering (badge in box)
      const minArea = Math.min(a.w * a.h, b.w * b.h);
      if (ix * iy < minArea * 0.2) continue;                      // ignore slight touches
      const key = [sibs[i].id, sibs[j].id].sort().join("|");
      if (seen.has(key)) continue; seen.add(key);
      advice.push(`Cells "${sibs[i].id}" and "${sibs[j].id}" overlap — space them apart (the layout engine keeps siblings from colliding).`);
    }
  }

  // 3) stacked arrowheads: ≥2 edges into the same target at the same entry point
  const entryCount = new Map();
  const junctionIds = new Set(cells.filter((c) => /(?:^|;)(?:branchPoint|mergePoint)=1(?:;|$)/.test(c.style)).map((c) => c.id));
  for (const c of cells) {
    if (c.edge !== "1" || !c.target) continue;
    if (junctionIds.has(c.target)) continue; // hidden junction targets intentionally have no arrowhead
    const ex = (c.style.match(/entryX=([\d.]+)/) ?? [, "c"])[1];
    const ey = (c.style.match(/entryY=([\d.]+)/) ?? [, "c"])[1];
    const k = `${c.target}@${ex},${ey}`;
    entryCount.set(k, (entryCount.get(k) ?? 0) + 1);
  }
  for (const [k, n] of entryCount) if (n > 1)
    advice.push(`${n} edges enter "${k.split("@")[0]}" at the same point — spread their entry points so the arrowheads don't stack (fan-in).`);

  return advice;
}

// Databases are detected by name (the catalog "Database" category is noisy — it also tags cloud9,
// application_composer, cdk…). This list covers the data stores that must not sit in a public subnet.
const DB_NAME_RE = /^(rds|aurora|dynamodb|documentdb|docdb|redshift|elasticache|memorydb|neptune|timestream|database|memcached|opensearch|elasticsearch)/;

/**
 * Architecture / Well-Architected audit — semantic best-practice checks on the topology the diagram
 * already encodes (subnet placement, AZ count, gateways), NOT visual checks. Runs in the same
 * validate pass, so the advice lands in the same issues checklist the agent already loops on — it
 * catches design flaws at diagram time, before any IaC exists. AWS-only (gated on aws4 stencils).
 * Each advice cites the risk, the fix, and the pillar.
 *
 * ponytail: only rules that flag something PRESENT in the diagram (a DB literally in a public subnet,
 * a literally-singular NAT across AZs). Rules that infer from ABSENCE (e.g. "no gateway → missing
 * egress") fire on legitimate conceptual/simplified diagrams — a diagram-time tool can't read intent
 * — so they're left out; false positives erode trust in the advice faster than misses do.
 */
export function auditArchitecture(xml) {
  const advice = [];
  if (!/mxgraph\.aws4\./.test(xml)) return advice;   // gate: only AWS diagrams
  const cells = parseCells(xml);
  const byId = new Map(cells.filter((c) => c.id).map((c) => [c.id, c]));
  const iconName = (c) => (c.style.match(/resIcon=mxgraph\.aws4\.([a-z0-9_]+)/) ?? [])[1] ?? null;
  const isSubnet = (c) => /grIcon=mxgraph\.aws4\.group_subnet\b/.test(c.style);
  const isAZ = (c) => /grIcon=mxgraph\.aws4\.group_availability_zone\b/.test(c.style);
  const ancestors = (c) => { const o = []; let p = byId.get(c.parent), g = 0; while (p && g++ < 50) { o.push(p); p = byId.get(p.parent); } return o; };

  const icons = cells.map((c) => ({ c, name: iconName(c) })).filter((x) => x.name);
  const natCount = icons.filter((x) => /^nat_gateway/.test(x.name)).length;
  const azCount = cells.filter(isAZ).length;

  // Rule 1 — database in a PUBLIC subnet (Security)
  for (const { c, name } of icons) {
    if (!DB_NAME_RE.test(name)) continue;
    const sub = ancestors(c).find(isSubnet);
    if (sub && /public/i.test(sub.value || "")) {
      advice.push(`[well-arch] Database "${c.id}" (${name}) sits in a PUBLIC subnet ("${(sub.value || "").trim()}") — risk: the data store is directly reachable from the internet. Fix: move it to a private subnet and reach it via the app tier or a VPC endpoint. (Well-Architected: Security)`);
    }
  }

  // Rule 2 — single NAT gateway across multiple AZs (Reliability SPOF)
  if (azCount >= 2 && natCount === 1) {
    advice.push(`[well-arch] A single NAT gateway serves ${azCount} availability zones — risk: it is a single point of failure; if that AZ fails, every private subnet loses outbound internet. Fix: deploy one NAT gateway per AZ. (Well-Architected: Reliability)`);
  }

  return advice;
}

/**
 * Edge orchestration advice for long connectors and invisible endpoint placeholders.
 * Primitive collisions, parallel overlap, and parallel link clearance are hard errors in
 * validateEdgeClearance(); perpendicular link crossings remain valid.
 */
export function auditEdges(xml) {
  const advice = [];
  const cells = parseCells(xml);
  const boxOf = (c) => c.absGeo || c.geo;
  const geoOf = new Map();
  for (const c of cells) if (c.edge !== "1" && (c.absGeo || c.geo) && c.id) geoOf.set(c.id, boxOf(c));
  if (geoOf.size === 0) return advice;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const g of geoOf.values()) { minX = Math.min(minX, g.x); minY = Math.min(minY, g.y); maxX = Math.max(maxX, g.x + g.w); maxY = Math.max(maxY, g.y + g.h); }
  const W = Math.max(1, maxX - minX), H = Math.max(1, maxY - minY);
  const center = (g) => ({ x: g.x + g.w / 2, y: g.y + g.h / 2 });

  const segs = [];
  for (const c of cells) {
    if (c.edge !== "1" || !c.source || !c.target) continue;
    const s = geoOf.get(c.source), t = geoOf.get(c.target);
    if (!s || !t) continue;
    segs.push({ a: center(s), b: center(t), src: c.source, tgt: c.target, dashed: /dashed=1/.test(c.style) });
  }
  if (segs.length === 0) return advice;

  const hasChildren = new Set(cells.map((c) => c.parent).filter(Boolean));
  const serviceNodes = cells.filter((c) => c.edge !== "1" && c.id && (c.absGeo || c.geo)
    && !hasChildren.has(c.id) && !/(?:^|;)text;|branchPoint=1|mergePoint=1/.test(c.style || "")).length;
  if (segs.length >= 40 || (segs.length >= 30 && segs.length > Math.max(1, serviceNodes) * 1.2))
    advice.push(`Dense dependency view (${segs.length} links across ${serviceNodes} service nodes) — keep the primary end-to-end flow in the overview and move secondary CRUD, operational, or record-level relationships into one or more focused detail diagrams.`);

  // 1) long detour connectors: edges spanning most of the diagram. A few are normal (a DR link,
  //    a cross-account trust); but ≥3 is the signature of a node parked far from its consumers
  //    (e.g. shared ECR/S3/CloudWatch dumped in a far row) — every reference becomes a long line.
  // absolute floor: in a tiny diagram (a handful of nodes) EVERY edge spans "most of the diagram" —
  // proportional-only thresholds misfire there. Long means proportionally AND absolutely long.
  const longs = segs.filter((e) =>
    (Math.abs(e.a.y - e.b.y) > 0.45 * H && Math.abs(e.a.y - e.b.y) > 500) ||
    (Math.abs(e.a.x - e.b.x) > 0.55 * W && Math.abs(e.a.x - e.b.x) > 700));
  if (longs.length >= 3) {
    const names = longs.slice(0, 4).map((e) => `${e.src}→${e.tgt}`);
    advice.push(`Long connector(s) spanning most of the diagram (${longs.length}: ${names.join(", ")}${longs.length > 4 ? "…" : ""}) — place these nodes closer; keep shared resources (ECR/S3/CloudWatch/registries) in a band NEXT TO their consumers instead of a far-away row, to avoid long detour edges.`);
  }

  // Floating arrowheads: edges anchored to a transparent leaf (not a real container)
  // hasChildren guards out AWS Cloud/Region/AZ/VPC group frames — those use fillColor=none legitimately.
  const isEmptyLeaf = (x) => {
    if (x.edge === "1" || hasChildren.has(x.id)) return false;
    // clusterBox boundary frames (kit puts them on the "boundaries" layer) are LEGITIMATE edge
    // anchors — the rules explicitly say to link the cluster, not each replica inside it.
    if (x.parent === "boundaries") return false;
    const style = x.style || "";
    if (/(?:^|;)(?:branchPoint|mergePoint)=1(?:;|$)/.test(style)) return false;
    if (/(?:^|;)text;/.test(style) || x.id === "__title") return false;
    return /fillColor=none/.test(style) && !/grIcon=/.test(style);
  };
  const emptyLeaves = new Set(cells.filter(isEmptyLeaf).map((x) => x.id));
  const floaters = [];
  for (const c of cells) {
    if (c.edge !== "1") continue;
    if (c.target && emptyLeaves.has(c.target)) floaters.push(`${c.source}→${c.target}`);
    if (c.source && emptyLeaves.has(c.source)) floaters.push(`${c.source}→${c.target} (source)`);
  }
  if (floaters.length) {
    advice.push(`Edge(s) connect to an invisible leaf node (${[...new Set(floaters)].slice(0, 4).join(", ")}${floaters.length > 4 ? "…" : ""}) — anchor to a solid icon card instead of a transparent placeholder.`);
  }

  return advice;
}
export function listCategories(catalog, { excludePacks } = {}) {
  const counts = new Map();
  for (const e of catalog.byName.values()) {
    if (excludePacks?.has(e.pack)) continue;
    const c = e.category ?? "(none)";
    counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([category, count]) => ({ category, count }));
}

export function getIcon(catalog, name) {
  const e = catalog.byName.get(name);
  return e ? decorate(catalog, e) : null;
}
