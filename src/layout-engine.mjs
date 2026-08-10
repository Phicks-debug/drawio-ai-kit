// drawio-ai-kit — declarative layout engine (flexbox-style for AWS diagrams).
// You DECLARE the nested structure (group/row/col + icon/box); the engine COMPUTES
// all x/y/w/h: frames hug their children snugly, rows/columns spread out evenly. NO hardcoded coordinates.
//
//   const tree = group("region","group_region","AWS Region",{dir:"row"},[
//     group("acc","group_account","Account",{dir:"col"},[ icon("s3","s3","S3"), ... ]),
//   ]);
//   renderTree(d, tree, [40, 70]);   // emit into the Diagram builder, auto-set page
//   d.title("...");  d.link("a","b","...");

import { THEME, stageFill, stageStroke } from "./theme.mjs";

const ICON = 48;
const SERVICE_FRAME_BORDERS = new Set(["solid", "dashed", "dotted", "dash-dot"]);

// ---- node creators ----
export const icon = (id, name, label = "", opts = {}) => ({ kind: "icon", id, name, label, ...opts });
// A text box AUTO-SIZES to its label (longest wrapped line → width, line count → height), so you
// don't hand-pick w/h. Pass w/h only to override (e.g. a deliberately tall source/consumer card).
function autoBox(label) {
  const lines = String(label ?? "").split("\n");
  const maxLen = Math.max(1, ...lines.map((l) => l.length));
  return {
    w: Math.min(260, Math.max(120, Math.round(maxLen * 6.6 + 28))),
    h: Math.max(44, lines.length * 18 + 26),
  };
}
export const box = (id, label = "", opts = {}) => {
  const a = autoBox(label);
  return { kind: "box", id, label, ...opts, w: opts.w ?? a.w, h: opts.h ?? a.h };
};
/** Small junction used to split one shared trunk into three or more equivalent branches. Place it on the
 * main flow between the source and primary target, then link source → branch → targets. */
export const branch = (id, opts = {}) => ({
  kind: "branch", id,
  size: opts.size ?? 1,
  atBend: opts.atBend ?? false,
});
/** Small junction used to combine three or more equivalent inputs into one shared trunk. */
export const merge = (id, opts = {}) => ({
  kind: "merge", id,
  size: opts.size ?? 1,
  atBend: opts.atBend ?? false,
});
export const group = (id, gname, label = "", opts = {}, children = []) => ({
  kind: "group", id, gname: gname || null, label, children,
  dir: opts.dir ?? "row", gap: opts.gap ?? 30, pad: opts.pad ?? 24,
  header: label ? (opts.header ?? 36) : (opts.header ?? 0),   // no label → no dead title strip (issue #58)
  align: opts.align ?? "center", fill: opts.fill, stroke: opts.stroke,
  // cornerIcon: a catalog icon name drawn at the container's top-left (Azure/GCP frames — mimics the
  // corner icon baked into AWS group stencils; the label shifts right to sit next to it).
  cornerIcon: opts.cornerIcon ?? null,
  serviceFrame: opts.serviceFrame ?? false,
  borderStyle: opts.borderStyle ?? "solid",
  graphOrder: opts.graphOrder ?? false,
  // routeGap: minimum gap enforced between children when routing lanes need to pass between them.
  // Set to ≥ 2×BM (48px) so the A* router has clearance. Overrides gap only when larger.
  routeGap: opts.routeGap ?? 0,
});
/** A group with no AWS stencil = a plain square frame (for logical layers/bands). */
export const frame = (id, label, opts = {}, children = []) => group(id, null, label, opts, children);
/** AWS service-owned boundary with a flush top-left service icon and category-coloured border.
 * Use only when the named parent service owns or controls every child. Independent sibling
 * services use normal icons in a normal group. The border is solid unless explicitly overridden. */
export const serviceFrame = (id, iconName, name, opts = {}, children = []) => {
  if (Array.isArray(opts)) { children = opts; opts = {}; }
  const borderStyle = opts.borderStyle ?? "solid";
  if (!SERVICE_FRAME_BORDERS.has(borderStyle))
    throw new Error(`serviceFrame: invalid borderStyle "${borderStyle}" — use solid, dashed, dotted, or dash-dot.`);
  return group(id, null, name, { ...opts, cornerIcon: iconName, serviceFrame: true, borderStyle }, children);
};
/** PHANTOM frame: an invisible layout-only wrapper distinct from visible containers. Lays out EXACTLY
 *  like a group (children in row/col, hugs them snugly) but emits NO mxCell — its children are
 *  reparented to the nearest VISIBLE ancestor (its own parent id is passed straight through the emit
 *  recursion). Use it to shape geometry without adding a visible frame (e.g. an alignment band). */
export const phantom = (id, label = "", opts = {}, children = []) => ({
  kind: "phantom", id, gname: null, label, children,
  // A phantom emits NO cell — with no label it must reserve NO pad/header, else the invisible wrapper
  // silently pads the content (compounds across nested row/col wrappers — issue #58). Big waste win.
  dir: opts.dir ?? "row", gap: opts.gap ?? 30, pad: opts.pad ?? (label ? 24 : 0),
  header: label ? (opts.header ?? 36) : (opts.header ?? 0),
  align: opts.align ?? "center", fill: opts.fill, stroke: opts.stroke,
  cornerIcon: opts.cornerIcon ?? null, routeGap: opts.routeGap ?? 0,
  graphOrder: opts.graphOrder ?? false,
});
/** Grid of `cols` columns: children laid out evenly into rows, each cell = the largest cell size (centered).
 *  Use when the element count doesn't match another row's column count (e.g. 4 icons under 3 columns). */
export const grid = (id, gname, label = "", opts = {}, children = []) => ({
  kind: "grid", id, gname: gname || null, label, children,
  cols: Math.max(1, opts.cols ?? 2), gap: opts.gap ?? 30, pad: opts.pad ?? 24,
  header: label ? (opts.header ?? 36) : (opts.header ?? 0),   // no label → no dead title strip (issue #58)
  fill: opts.fill, stroke: opts.stroke, graphOrder: opts.graphOrder ?? false,
});
// ---- themed creators (apply the THEME so diagrams inherit the house style by default) ----
// Big frames use a WHITE (theme-aware) background; the AWS icons carry the color. A per-stage
// border colour keeps layers distinguishable without tinting the fill.
/** Pipeline STAGE frame i (0-based) → white fill, per-stage coloured border. */
export const stage = (id, i, label, children = [], opts = {}) =>
  group(id, null, label, { dir: "col", gap: THEME.gaps.item, fill: THEME.base, stroke: stageStroke(i), graphOrder: true, ...opts }, children);
/** Cross-cutting band (governance / security / ops) — white fill, neutral border, laid out as a row. */
export const band = (id, label, children = [], opts = {}) =>
  group(id, null, label, { dir: "row", gap: 36, fill: THEME.base, stroke: THEME.bandStroke, ...opts }, children);
/** Subnet frame (AWS group_subnet stencil). Colour comes from the label: "Public…" → green,
 *  "Private…" → blue (builder.group applies it). */
export const subnet = (id, label, children = [], opts = {}) =>
  group(id, "group_subnet", label, { dir: "col", gap: THEME.gaps.item, ...opts }, children);
/** Source / consumer endpoint card (entry/exit of the diagram). */
export const endpoint = (id, label, opts = {}) =>
  box(id, label, { fill: THEME.endpoint, stroke: THEME.endpointStroke, bold: true, ...opts });
/** Plain OSS / component box (theme-aware white). */
export const ossBox = (id, label, opts = {}) =>
  box(id, label, { fill: THEME.base, stroke: THEME.baseStroke, fs: THEME.fonts.small, ...opts });
/** On-premise / external site frame — uses the AWS corporate-data-center group stencil so it gets
 *  a top-left corner icon like the cloud/Region zones; white fill, neutral border. */
export const onpremFrame = (id, label, children = [], opts = {}) =>
  group(id, "group_corporate_data_center", label, { dir: "row", gap: 26, fill: THEME.base, stroke: THEME.onpremStroke, ...opts }, children);

// ---- per-type layout registry ----
// Each node kind maps to a { measure, place, emit } triple. The top-level measure/place/emit
// dispatch through this map instead of switching on n.kind, so a new container kind is one new
// registry entry — no shared switch to edit. icon/box have place:null: place() still sets n.x/n.y
// for every kind (the round happens unconditionally at the top).
function mIcon(n) {
  const s = n.size ?? ICON;
  n.w = Math.max(96, s + 20, Math.min(200, (n.label?.length ?? 0) * 7 + 24)); // cell never narrower than the glyph
  n.h = s + 34; // icon + label below
}
function mBox(n) { /* w,h provided */ }
function mBranch(n) { n.w = n.size; n.h = n.size; }
const mMerge = mBranch;
/** Shared container measure: recurse into children, then grid/row/col sizing + floor by title width.
 *  Runs for both `group` and `grid` (the grid cell math lives inside the dir switch on n.kind). */
function measureContainer(n) {
  n.children.forEach(measure);
  const ch = n.children, p = n.pad, head = n.header;
  const eg = Math.max(n.gap, n.routeGap ?? 0); // effective gap: routeGap wins when larger
  const sum = (f) => ch.reduce((s, c) => s + f(c), 0);
  const max = (f) => ch.reduce((m, c) => Math.max(m, f(c)), 0);
  if (n.kind === "grid") {
    const rows = Math.ceil(ch.length / n.cols);
    n.cellW = max((c) => c.w); n.cellH = max((c) => c.h);
    n.w = p * 2 + n.cols * n.cellW + n.gap * (n.cols - 1);
    n.h = head + p * 2 + rows * n.cellH + n.gap * (rows - 1);
  } else if (n.dir === "row") {
    // Equal-height siblings: stretch each container block in a row up to the tallest sibling, so
    // side-by-side frames share a bottom edge (leaf icons/boxes keep their natural size, top-aligned).
    const maxH = max((c) => c.h);
    for (const c of ch) if (c.kind === "group" || c.kind === "grid") c.h = Math.max(c.h, maxH);
    n.w = p * 2 + sum((c) => c.w) + eg * Math.max(0, ch.length - 1);
    n.h = head + p * 2 + max((c) => c.h);
  } else { // col
    // Equal-width siblings: stretch each group frame in a column up to the widest sibling, so
    // stacked frames (e.g. subnet tiers) share left/right edges. Only `group` — it re-places its
    // children to fill the new width; grid has self-computed internal geometry that a forced
    // outer width would leave a gap inside, and leaf icons/boxes keep their natural size.
    const maxW = max((c) => c.w);
    for (const c of ch) if (c.kind === "group") c.w = Math.max(c.w, maxW);
    n.w = p * 2 + max((c) => c.w);
    n.h = head + p * 2 + sum((c) => c.h) + eg * Math.max(0, ch.length - 1);
  }
  // floor by title width: a frame is never narrower than its label (avoids clipping text).
  if (n.label) n.w = Math.max(n.w, Math.ceil(n.label.length * 6.6) + p * 2);
}
const mGroup = measureContainer, mGrid = measureContainer;

// ---- place: assign x,y (top-down) ----
function pGrid(n) {
  const innerX = n.x + n.pad, innerTop = n.y + n.header + n.pad;
  n.children.forEach((c, i) => {
    const r = Math.floor(i / n.cols), col = i % n.cols;
    const cellX = innerX + col * (n.cellW + n.gap), cellY = innerTop + r * (n.cellH + n.gap);
    place(c, cellX + (n.cellW - c.w) / 2, cellY + (n.cellH - c.h) / 2); // center in cell
  });
}
function pGroup(n) {
  const innerX = n.x + n.pad, innerTop = n.y + n.header + n.pad;
  const innerW = n.w - n.pad * 2, innerH = n.h - n.header - n.pad * 2;
  const eg = Math.max(n.gap, n.routeGap ?? 0);
  // Distribute-to-fill: when a frame is stretched past its content (by equal-height/equal-width or a
  // long label), spread the SLACK evenly between children (space-between) instead of clustering them
  // with dead space. This makes 2 small blocks span the same extent as a big sibling (nested balance)
  // and removes the empty margins. Not stretched → slack≈0 → behaves like the old fixed-gap layout.
  // Extra spacing from slack is CAPPED at one base gap (max gap = 2×eg), then the moderately-filled
  // cluster is CENTRED. Fills the dead space enough to look intentional without blowing a stretched
  // frame into a sparse void — compact beats fully-spread once slack is large.
  const ch = n.children, k = ch.length, sizes = ch.map((c) => n.dir === "row" ? c.w : c.h);
  const sumSz = sizes.reduce((s, v) => s + v, 0);
  const inner = n.dir === "row" ? innerW : innerH;
  const gap = k > 1 ? eg + Math.min(eg, Math.max(0, (inner - sumSz - eg * (k - 1)) / (k - 1))) : eg;
  const span = sumSz + gap * Math.max(0, k - 1);
  let cur = (n.dir === "row" ? innerX : innerTop) + Math.max(0, (inner - span) / 2);   // centre the filled cluster
  for (const c of ch) {
    if (n.dir === "row") { place(c, cur, n.align === "top" ? innerTop : innerTop + (innerH - c.h) / 2); cur += c.w + gap; }
    else { place(c, n.align === "left" ? innerX : innerX + (innerW - c.w) / 2, cur); cur += c.h + gap; }
  }
}
// ---- emit: output to the Diagram builder ----
function eIcon(d, n, parent) {
  const s = n.size ?? ICON;
  d.icon(n.id, n.name, [Math.round(n.x + (n.w - s) / 2), n.y], { parent, label: n.label, size: s, functionGroup: n.functionGroup });
}
function eBox(d, n, parent) {
  if (n.style) { const marker = n.functionGroup ? `functionGroup=${n.functionGroup};` : ""; const r = d._put(n.id, parent, n.x, n.y, n.w, n.h, `${n.style}${n.style.endsWith(";") ? "" : ";"}${marker}`, n.label); r.ob = true; return; }   // curated shape: raw style, leaf obstacle
  d.box(n.id, [n.x, n.y], [n.w, n.h], n.label, { parent, fill: n.fill, stroke: n.stroke, round: n.round, va: n.va, bold: n.bold, functionGroup: n.functionGroup });
}
function eBranch(d, n, parent) {
  d.junction(n.id, [n.x, n.y], { parent, size: n.size, atBend: n.atBend });
}
function eMerge(d, n, parent) {
  d.mergeJunction(n.id, [n.x, n.y], { parent, size: n.size, atBend: n.atBend });
}
function eGroup(d, n, parent) {
  if (n.gname) d.group(n.id, n.gname, [n.x, n.y], [n.w, n.h], n.label, { parent, fill: n.fill, stroke: n.stroke });
  else if (n.serviceFrame) {
    const CI = 22;
    const entry = d.c.byName.get(n.cornerIcon);
    const iconColor = entry?.color ?? "#5A6B7B";
    const darkColor = brightenHex(iconColor, 0.35);
    const border = serviceBorderStyle(n.borderStyle);
    const fill = n.fill ?? "light-dark(#FFFFFF,#0F1620)";
    const stroke = `light-dark(${iconColor},${darkColor})`;
    const marker = `serviceFrame=1;serviceIcon=${n.cornerIcon};serviceBorder=${n.borderStyle};`;
    const style = `rounded=0;whiteSpace=wrap;html=1;fillColor=${fill};strokeColor=${stroke};strokeWidth=2;${border}${marker}fontColor=light-dark(#1A1A1A,#E8EEF5);fontSize=12;fontStyle=0;verticalAlign=top;align=left;spacingLeft=${CI + 8};spacingTop=4;`;
    const r = d._put(n.id, parent, n.x, n.y, n.w, n.h, style, n.label); r.ob = false;
    d.cornerIcon(`${n.id}__ci`, n.cornerIcon, [Math.round(n.x), Math.round(n.y)], CI, n.id);
  }
  else if (n.cornerIcon) {
    // Azure/GCP-style container: corner icon top-left, label beside it (like an AWS group stencil).
    const CI = 22;
    const style = `rounded=0;whiteSpace=wrap;html=1;fillColor=${n.fill ?? "#FFFFFF"};strokeColor=${n.stroke ?? "#999999"};fontColor=#1A1A1A;fontSize=12;fontStyle=1;verticalAlign=top;align=left;spacingLeft=${CI + 12};spacingTop=8;`;
    const r = d._put(n.id, parent, n.x, n.y, n.w, n.h, style, n.label); r.ob = false;
    d.cornerIcon(`${n.id}__ci`, n.cornerIcon, [Math.round(n.x + 8), Math.round(n.y + 7)], CI, n.id);
  } else {
    // stroke:"none" = layout-only wrapper (no visible border) → ob:null so the router ignores it
    // entirely. Registering it as a container (ob:false) made insideAny() true across the whole
    // page (a root wrapper encloses everything), which silently disabled the border-hugging
    // penalty for every renderTree diagram — and gave pushOff phantom borders to jump outside of.
    d.box(n.id, [n.x, n.y], [n.w, n.h], n.label, { parent, va: "top", bold: true, fill: n.fill ?? "#FFFFFF", stroke: n.stroke ?? "#999999", ob: n.stroke === "none" ? null : false });
  }
  for (const c of n.children) emit(d, c, n.id);
}

function brightenHex(hex, ratio) {
  const match = String(hex).match(/^#([0-9a-f]{6})$/i);
  if (!match) return hex;
  const value = Number.parseInt(match[1], 16);
  const channel = (shift) => Math.round(((value >> shift) & 255) + (255 - ((value >> shift) & 255)) * ratio);
  return `#${[channel(16), channel(8), channel(0)].map((v) => v.toString(16).padStart(2, "0")).join("").toUpperCase()}`;
}

function serviceBorderStyle(style) {
  if (style === "dashed") return "dashed=1;dashPattern=8 4;";
  if (style === "dotted") return "dashed=1;dashPattern=1 4;lineCap=round;";
  if (style === "dash-dot") return "dashed=1;dashPattern=8 4 1 4;lineCap=round;";
  return "dashed=0;";
}
/** Phantom emit: emits NO cell and does NOT touch this.R. It records its id in d.phantoms (so link()
 *  can teach the distinction between a phantom and a typo) then recurses children with the SAME
 *  parent it received — that passes children straight through the phantom layer to the nearest
 *  VISIBLE ancestor (the reparent mechanism: the phantom never inserts its id into the parent chain). */
function ePhantom(d, n, parent) {
  d.phantoms.add(n.id);
  for (const c of n.children) emit(d, c, parent);
}

const LAYOUT = {
  icon:    { measure: mIcon,   place: null,   emit: eIcon },
  box:     { measure: mBox,    place: null,   emit: eBox },
  branch:  { measure: mBranch, place: null,   emit: eBranch },
  merge:   { measure: mMerge,  place: null,   emit: eMerge },
  group:   { measure: mGroup,  place: pGroup, emit: eGroup },
  grid:    { measure: mGrid,   place: pGrid,  emit: eGroup },
  phantom: { measure: mGroup,  place: pGroup, emit: ePhantom },   // group geometry, NO cell emit
};

function measure(n) { LAYOUT[n.kind].measure(n); }
function place(n, x, y) {
  n.x = Math.round(x); n.y = Math.round(y);   // set for ALL kinds (even icon/box with place:null)
  const t = LAYOUT[n.kind];
  if (t.place) t.place(n, x, y);
}
function emit(d, n, parent) { LAYOUT[n.kind].emit(d, n, parent); }

/** Compute the layout for the tree + emit into Diagram d; auto-set the page to the actual size. */
// Global icon size from the Diagram flows to every icon that didn't set its own — per-icon {size} wins.
function applyIconSize(n, s) {
  if (n.kind === "icon") n.size = n.size ?? s;
  (n.children ?? []).forEach((c) => applyIconSize(c, s));
}
export function renderTree(d, root, [x = 40, y = 70] = []) {
  if (d.iconSize && d.iconSize !== ICON) applyIconSize(root, d.iconSize);
  measure(root);
  place(root, x, y);
  emit(d, root, "1");
  d.page = [Math.round(root.x + root.w + 40), Math.round(root.y + root.h + 50)];
  return root;
}

const graphLink = (link) => Array.isArray(link)
  ? { source: link[0], target: link[1], label: link[2] ?? "", opts: link[3] ?? {} }
  : { source: link.source ?? link.src, target: link.target ?? link.tgt, label: link.label ?? "", opts: link.opts ?? {} };

/** Sugiyama-style crossing reduction within declared semantic ranks. The tree supplies hierarchy
 *  and layer assignment; containers marked graphOrder:true supply reorderable ranks. */
export function orderGraph(root, links = [], { sweeps = 8 } = {}) {
  const edges = links.map(graphLink).filter((e) => e.source && e.target);
  const ranks = [];
  const walk = (node) => {
    if (node.graphOrder && (node.children?.length ?? 0) > 1) ranks.push(node);
    for (const child of node.children ?? []) walk(child);
  };
  const idsBelow = (node, out = new Set()) => {
    if (node.id) out.add(node.id);
    for (const child of node.children ?? []) idsBelow(child, out);
    return out;
  };
  walk(root);
  if (ranks.length < 2 || !edges.length) return root;
  const peers = new Map();
  for (const edge of edges) {
    (peers.get(edge.source) ?? peers.set(edge.source, []).get(edge.source)).push(edge.target);
    (peers.get(edge.target) ?? peers.set(edge.target, []).get(edge.target)).push(edge.source);
  }
  const position = new Map();
  const rebuildPositions = () => {
    position.clear();
    for (const rank of ranks) rank.children.forEach((child, i) => {
      for (const id of idsBelow(child)) if (!position.has(id)) position.set(id, i);
    });
  };
  const sortRank = (rank) => {
      const scored = rank.children.map((child, index) => {
        const values = [];
        for (const id of idsBelow(child)) for (const peer of peers.get(id) ?? []) if (position.has(peer)) values.push(position.get(peer));
        return { child, index, score: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : index };
      });
      scored.sort((a, b) => a.score - b.score || a.index - b.index);
      rank.children = scored.map((entry) => entry.child);
      rebuildPositions();
  };
  rebuildPositions();
  for (let sweep = 0; sweep < Math.max(1, sweeps); sweep++) {
    for (let i = 1; i < ranks.length; i++) sortRank(ranks[i]);
    for (let i = ranks.length - 2; i >= 0; i--) sortRank(ranks[i]);
  }
  return root;
}

/** Layout-first public workflow: order nodes inside semantic ranks, emit coordinates, then link. */
export function renderGraph(d, root, links = [], origin = [40, 70], opts = {}) {
  const normalized = links.map(graphLink);
  orderGraph(root, normalized, opts);
  renderTree(d, root, origin);
  placeJunctionsAtBends(d, normalized);
  for (const link of normalized) d.link(link.source, link.target, link.label, link.opts);
  return root;
}

function placeJunctionsAtBends(d, links) {
  const center = (r) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
  for (const [id, junction] of Object.entries(d.R)) {
    if (!junction.junctionAtBend) continue;
    const incoming = links.filter((link) => link.target === id).map((link) => d.R[link.source]).filter(Boolean);
    const outgoing = links.filter((link) => link.source === id).map((link) => d.R[link.target]).filter(Boolean);
    const branchLike = junction.junction === "branchPoint" && incoming.length === 1 && outgoing.length;
    const mergeLike = junction.junction === "mergePoint" && outgoing.length === 1 && incoming.length;
    if (!branchLike && !mergeLike) continue;
    const sources = incoming, targets = outgoing;
    const sourceCenter = branchLike ? center(sources[0]) : {
      x: sources.reduce((sum, r) => sum + center(r).x, 0) / sources.length,
      y: sources.reduce((sum, r) => sum + center(r).y, 0) / sources.length,
    };
    const targetCenter = mergeLike ? center(targets[0]) : {
      x: targets.reduce((sum, r) => sum + center(r).x, 0) / targets.length,
      y: targets.reduce((sum, r) => sum + center(r).y, 0) / targets.length,
    };
    const dx = targetCenter.x - sourceCenter.x, dy = targetCenter.y - sourceCenter.y;
    let x, y;
    if (Math.abs(dx) >= Math.abs(dy)) {
      const forward = dx >= 0;
      const sourceEdge = branchLike
        ? (forward ? sources[0].x + sources[0].w : sources[0].x)
        : (forward ? Math.max(...sources.map((r) => r.x + r.w)) : Math.min(...sources.map((r) => r.x)));
      const targetEdge = mergeLike
        ? (forward ? targets[0].x : targets[0].x + targets[0].w)
        : (forward ? Math.min(...targets.map((r) => r.x)) : Math.max(...targets.map((r) => r.x + r.w)));
      x = (sourceEdge + targetEdge) / 2;
      y = branchLike ? sourceCenter.y : targetCenter.y;
    } else {
      const forward = dy >= 0;
      const sourceEdge = branchLike
        ? (forward ? sources[0].y + sources[0].h : sources[0].y)
        : (forward ? Math.max(...sources.map((r) => r.y + r.h)) : Math.min(...sources.map((r) => r.y)));
      const targetEdge = mergeLike
        ? (forward ? targets[0].y : targets[0].y + targets[0].h)
        : (forward ? Math.min(...targets.map((r) => r.y)) : Math.max(...targets.map((r) => r.y + r.h)));
      x = branchLike ? sourceCenter.x : targetCenter.x;
      y = (sourceEdge + targetEdge) / 2;
    }
    const parent = d.R[junction.parent];
    let left = x - junction.w / 2, top = y - junction.h / 2;
    if (parent) {
      left = Math.max(parent.x + 2, Math.min(parent.x + parent.w - junction.w - 2, left));
      top = Math.max(parent.y + 2, Math.min(parent.y + parent.h - junction.h - 2, top));
    }
    d._move(id, left, top);
  }
}
