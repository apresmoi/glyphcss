/**
 * 3D graph layout. Two layouts share one output shape
 * (`GlyphDiagram3dLayout`): `"layered"` (the default) and `"force"` (a
 * hand-rolled, SEEDED Fruchterman-Reingold simulation in full 3D,
 * UNCHANGED by this round).
 *
 * **D2 round 7 ("stage-by-stage 3D flow" — user, verbatim: "they could be
 * like in the same plane at each depth, but not in the same line... like
 * one in front two in the back... or two in the front one in the back,
 * etc... triangulated").** Replaces round 5/6's shared-PLANE embedding
 * outright — that model put every node's front face on ONE wall (2D x/y
 * mapped straight onto two ground vectors chosen so the flow read with zero
 * row drift), which is exactly why it could only ever show a doubled top
 * line: a genuine LEFT/RIGHT side face is mathematically impossible when
 * every node sits on the same flat wall (round 6's own proof — `n`'s column
 * coefficient is forced to zero by the camera's own trig identity). This
 * round drops the shared plane and puts each dagre RANK in its OWN
 * cross-section plane, perpendicular to a flow axis chosen from the graph's
 * own direction:
 *
 * - `LR`/`RL`: flow runs along world X (`+X` for LR, `-X` for RL); a rank's
 *   own cross-section plane is spanned by Z ("vertical") and Y ("depth").
 * - `TB`/`BT`: flow runs along world Z (`-Z`, i.e. genuinely top-to-bottom,
 *   for TB; `+Z` for BT); a rank's own cross-section plane is spanned by X
 *   ("horizontal") and Y ("depth").
 *
 * Every node's own BOX stays a plain, world-axis-aligned box in EVERY case
 * — width always X, depth (extrusion) always Y, height always Z (exactly
 * `boxPolygons`'s own convention, `@glyphcss/core`) — because whichever of
 * X/Z the flow axis happens to be for THIS direction is also, not
 * coincidentally, the axis the node's own along-flow extent (its label
 * width for LR/RL, its label height for TB/BT) already measures: consecutive
 * ranks are spaced apart using each rank's own along-flow half-extent, so a
 * rank's own "thickness" is real box geometry, never an invented gap. This
 * is why NO shared plane basis (`u`/`n`, round 5's own
 * `glyphDiagram3dPlaneAxes`) survives into this round at all — `nodePolygons`
 * in `glyphDiagramObject.ts` builds every box with the literal identity
 * axes now, and `resolveGlyphDiagram3dLabelPlacement`'s own `axes` parameter
 * defaults to (and is always called with) that same identity.
 *
 * Within one rank's own cross-section plane, siblings are placed on a
 * REGULAR RING (a single, uniform formula covering every count the brief
 * enumerated as separate cases): 1 node sits at the plane's own centre
 * (radius 0, so a join/merge with one member per rank stays exactly on the
 * flow axis); 2+ nodes sit at `count` evenly-spaced points around a circle,
 * dagre's own within-rank (crossing-minimized) order assigned to ring
 * position in order, starting at a BASE ANGLE that ROTATES per rank
 * (`GLYPH_DIAGRAM_3D_RING_BASE_ANGLE + rank * GLYPH_DIAGRAM_3D_RING_ROTATE_DEG`,
 * an increment with no small common period against 360°, so consecutive
 * fans never realign to the same pattern) — this single formula reproduces
 * every case the brief named: 2 points 180° apart at an off-axis base angle
 * read as "one in front, one behind, offset sideways too" (never purely
 * axis-aligned, so neither coordinate ever collides); 3 points are always a
 * non-degenerate triangle (never collinear, for any positive radius), and a
 * rotating base angle naturally alternates which side has 1 vs 2 members
 * (whichever point ends up with the ring's own largest DEPTH coordinate);
 * 4 points at a non-axis-aligned base angle read as a diamond; 5+ points
 * are the brief's own "regular ring" option directly. The ring's own
 * RADIUS is sized so adjacent points clear each other by
 * `GLYPH_DIAGRAM_3D_RING_GAP` world units PLUS both points' own in-plane
 * half-extents (never a flat constant), so blocks never overlap in
 * projection regardless of how large a rank's own members are.
 *
 * **Edges are now genuine straight 3D segments, not a 2D-routed polyline
 * embedded on a plane** — the 2D A* router (`route.ts`) and its port
 * reservation (`reserveGlyphGraphPorts`) are GONE from this path entirely
 * (this module still uses `measureGlyphGraph`/`layoutGlyphGraph` — dagre's
 * own rank assignment and within-rank crossing-minimized ORDER, exactly as
 * before, just read differently — never dagre's own x/y as a literal 3D
 * placement any more). An edge's own endpoints are the source's OUTGOING
 * face and the target's INCOMING face along the flow axis (whichever
 * direction the edge actually needs — a back-edge leaves its source's
 * BACKWARD face and arrives at its target's FORWARD one, so a cycle-closing
 * edge reads correctly too), falling back to a generic nearest-surface
 * anchor (`nodeSurfaceAnchor`, unchanged from force layout's own primitive)
 * for a same-rank edge or a self-loop. Because nothing here routes AROUND
 * other geometry any more, this layout can never report an `unroutable`
 * edge — `glyphDiagramObject.ts`'s own overlay draws every edge as
 * depth-tested ribbon/pyramid MESH geometry (this file's own doc has no
 * opinion on how it's drawn, only where its endpoints are), so a straight
 * segment that happens to pass behind an intervening block is correctly
 * hidden by it, never silently drawn through it.
 *
 * **Groups** get a plain world-axis-aligned bounding box (`min`/`max`,
 * literal per-axis extrema over their own members' boxes, padded by
 * `GLYPH_DIAGRAM_3D_GROUP_PAD`) — the SAME computation `force` layout
 * already used (this round makes `layered` match it exactly, since both are
 * now plain world-axis-aligned scenes with no shared-plane basis to
 * project through). `glyphDiagramObject.ts` draws it as a thin 12-edge
 * wireframe ribbon outline around the box, never a filled/recessed panel.
 *
 * **D2 round 8** (user, verbatim: "can we make them a bit more clear in
 * the separation between the same height/depth nodes? because its
 * difficult to see them separate"). The ring's own radius (`GLYPH_
 * DIAGRAM_3D_RING_GAP`/`triangulatedOffsets`) is now sized off the SAME
 * camera-aware conservative bound rank spacing already used
 * (`screenSafeFlowHalf`, both cross-axis AND depth) rather than a single
 * raw in-plane axis, plus extra room for this rank's own longest SIDE
 * LABEL (`GLYPH_DIAGRAM_3D_RING_LABEL_UNIT`) — labels now sit BESIDE a
 * node by default (`glyphDiagramObject.ts`'s own round-8 doc), radially
 * OUTWARD from the ring's own centre, so the ring must leave room for that
 * text or it reaches into the next sibling's own arc.
 */
import type { GlyphGraph, GlyphGraphDirection, GlyphGraphEdgeStyle, GlyphGraphNode, GlyphGraphNodeShape } from "../types";
import { measureGlyphGraph, layoutGlyphGraph, type GlyphDiagramLayoutOptions, type GlyphDiagramMeasuredNode, type GlyphDiagramPositionedNode } from "../pipeline";
import { glyphDiagramError } from "../validate";
import type { GlyphDiagramLedgerEntry } from "../ledger";
import type { Vec3 } from "glyphcss";

/**
 * The default "architecture view" camera for the layered layout — a 3/4
 * isometric-ish oblique view (user's own D2 round 7 direction: "yaw about
 * 30-40deg, pitch about 25-35deg from above... where the flow axis runs
 * diagonally across the screen and front/back siblings separate visibly in
 * both row and column"). Unlike round 5/6, this is no longer analytically
 * DERIVED from the layout geometry (there is no more shared plane for a
 * yaw to solve zero-row-drift against) — it is a plain, fixed, EMPIRICALLY
 * tuned pose (rendered and inspected directly, the same discipline round
 * 5/6 already used for their own constants), verified to keep siblings at
 * different ring positions visibly separated in BOTH screen row and column
 * (`layout3d.test.ts`'s own projected-silhouette-overlap gate).
 */
export const GLYPH_DIAGRAM_3D_CAMERA_ROT_X = 62;
export const GLYPH_DIAGRAM_3D_CAMERA_ROT_Y = 36;

/** Default node depth (world units, the box's own Y-extent/extrusion) when no explicit `size` is given — `0.35-0.5x` the smaller of the front face's own width/height, floored so a degenerate (near-zero) label box still reads as a real box. Unchanged from D2 round 6. */
const GLYPH_DIAGRAM_3D_DEPTH_FACTOR = 0.6;
const GLYPH_DIAGRAM_3D_MIN_DEPTH = 4;
/**
 * A node's front-face HEIGHT floor (world units, the box's own Z-extent)
 * for a node with NO explicit `size` — the 2D layout's own measured
 * `height` is a floor on READABILITY there, not a target for how tall a 3D
 * box should stand.
 *
 * USER FEEDBACK, verbatim: "the lenet5 the transformer ... suck" / "we need
 * better diagrams". This floor used to apply UNCONDITIONALLY, including to
 * an explicitly `size`d node — the shipped LeNet-5 fixture's own tensor
 * volumes (channel counts as low as 1, deliberately THIN) all floored to
 * this SAME 12, so every layer rendered at an identical height regardless
 * of its own authored shrink/grow story ("a chain of identical boxes" was
 * literally true on this axis). The rationale for the floor at all —
 * keeping a label legible INSIDE its own box — is also largely moot for a
 * sized node now: D2 round 8 made `"side"` (never `"inside"`) the label
 * default, so a tensor slab's own label sits beside it, not painted on its
 * front face. `GLYPH_DIAGRAM_3D_MIN_DEPTH_EXPLICIT` below is the analogous
 * fix for the depth (Y) axis's own two floors.
 */
const GLYPH_DIAGRAM_3D_MIN_HEIGHT = 12;
/**
 * The height/depth floor for a node that DID author an explicit `size` —
 * far below `GLYPH_DIAGRAM_3D_MIN_HEIGHT`/`GLYPH_DIAGRAM_3D_MIN_DEPTH`,
 * just enough to keep a literal `0` from degenerating into a zero-volume
 * slab. A real value (LeNet-5's channel-count-1 input layer) passes
 * through this floor untouched.
 */
const GLYPH_DIAGRAM_3D_MIN_HEIGHT_EXPLICIT = 1;
const GLYPH_DIAGRAM_3D_MIN_DEPTH_EXPLICIT = 1;
/** Padding (world units) around a group's member footprint before it becomes a bounding outline. */
export const GLYPH_DIAGRAM_3D_GROUP_PAD = 2;
/**
 * Clearance (world units), beyond both points' own in-plane half-extents,
 * between adjacent ring-placed siblings. **D2 round 8** (user, verbatim:
 * "can we make them a bit more clear in the separation between the same
 * height/depth nodes? because its difficult to see them separate") —
 * raised from `3` (round 7) after rendering the real fixtures: `3` gave
 * adjacent siblings a screen gap of 0-1 cells at 96x32, which the reader
 * cannot distinguish from a shared edge. Reused directly by
 * `triangulatedOffsets` below.
 */
const GLYPH_DIAGRAM_3D_RING_GAP = 7;
/**
 * Extra clearance (world units) per character of a rank's own LONGEST side
 * label, added on top of `GLYPH_DIAGRAM_3D_RING_GAP` (round 8) — a side
 * label now extends past its own node in the SAME cross-section plane the
 * ring packs siblings into (`glyphDiagram3dNodeSideVector`'s own doc,
 * `glyphDiagramObject.ts`), so the ring must leave room for it or an
 * outward-pointing label collides with the next sibling around the ring.
 * `1` world unit per character matches `measureGlyphGraph`'s own
 * character-to-cell ratio (`pipeline.ts`'s `width = lines[0].length + ...`),
 * so a label's WORLD footprint and its own rendered CHARACTER count agree.
 */
const GLYPH_DIAGRAM_3D_RING_LABEL_UNIT = 1;
/** Clearance (world units), beyond both ranks' own along-flow half-extents, between consecutive rank planes. */
const GLYPH_DIAGRAM_3D_RANK_GAP = 5;
/** First rank's own ring base angle (degrees) — chosen so the FIRST sibling (dagre order 0) lands front-left (negative cross-axis, positive depth) rather than on an axis. */
const GLYPH_DIAGRAM_3D_RING_BASE_ANGLE = 135;
/** Per-rank ring rotation increment (degrees) — has no small common period against 360, so consecutive fans never realign to the identical pattern ("alternate orientation rank to rank so consecutive fans interleave"). */
const GLYPH_DIAGRAM_3D_RING_ROTATE_DEG = 53;
/** Extra clearance (world units), beyond an intervening node's own cross-axis half-extent, that a residual/skip edge's own apex bows out by — tuned by direct rendering so the bow clears a typical intervening box's silhouette rather than skimming its edge. */
const GLYPH_DIAGRAM_3D_SKIP_EDGE_BOW = 6;

/**
 * D2 round 4, requirement 4 ("size scaling blows up... scale explicit
 * `size` into display units with a COMPRESSING map... clamp the largest:
 * smallest ratio to about 4x per axis"). Unchanged from D2 round 4/6.
 */
const GLYPH_DIAGRAM_3D_SIZE_COMPRESS_EXPONENT = 0.5;
const GLYPH_DIAGRAM_3D_SIZE_MAX_RATIO = 4;

function compressExplicitSizes(nodes: readonly GlyphGraphNode[]): ReadonlyMap<string, Vec3> {
  const withSize = nodes.filter((n): n is GlyphGraphNode & { size: NonNullable<GlyphGraphNode["size"]> } => !!n.size);
  const result = new Map<string, [number, number, number]>();
  if (withSize.length === 0) return result;
  for (const n of withSize) result.set(n.id, [0, 0, 0]);
  for (let axis = 0; axis < 3; axis++) {
    const max = Math.max(...withSize.map((n) => n.size[axis]));
    if (max <= 0) continue;
    for (const n of withSize) {
      const raw = Math.max(0, n.size[axis]);
      const compressed = max * Math.pow(raw / max, GLYPH_DIAGRAM_3D_SIZE_COMPRESS_EXPONENT);
      const clamped = Math.max(compressed, max / GLYPH_DIAGRAM_3D_SIZE_MAX_RATIO);
      result.get(n.id)![axis] = clamped;
    }
  }
  return result;
}

export type GlyphDiagram3dLayoutKind = "layered" | "force";

export interface GlyphDiagram3dNode {
  readonly id: string;
  readonly label: string;
  readonly shape: GlyphGraphNodeShape;
  readonly kind?: string;
  readonly group?: string;
  readonly degree: number;
  /** Box/sphere center, WORLD space. */
  readonly center: Vec3;
  /** Half-extents: index 0 = world X (width), index 1 = world Y (depth), index 2 = world Z (height) — ALWAYS this axis convention, both layouts. */
  readonly half: Vec3;
}

export interface GlyphDiagram3dEdge {
  readonly id: string;
  readonly from: string;
  readonly to: string;
  readonly label?: string;
  readonly style: GlyphGraphEdgeStyle;
  readonly priority: number;
  /** 2 points (a straight 3D segment, source face -> target face) or 3 (a self-loop's own bulge point). WORLD space. */
  readonly points: readonly Vec3[];
}

export interface GlyphDiagram3dGroup {
  readonly id: string;
  readonly label?: string;
  /** Kept for shape continuity across a group's consumers — the padded box's own Z centre. */
  readonly z: number;
  readonly min: Vec3;
  readonly max: Vec3;
}

export interface GlyphDiagram3dLayout {
  readonly nodes: readonly GlyphDiagram3dNode[];
  readonly edges: readonly GlyphDiagram3dEdge[];
  readonly groups: readonly GlyphDiagram3dGroup[];
  readonly ledger: readonly GlyphDiagramLedgerEntry[];
}

export interface GlyphDiagram3dLayoutOptions extends Pick<GlyphDiagramLayoutOptions, "labelWidth"> {
  readonly layout?: GlyphDiagram3dLayoutKind;
  readonly direction?: GlyphGraphDirection;
  readonly nodesep?: number;
  readonly ranksep?: number;
  /** `"inside" | "side" | "auto"` — layered only, read here ONLY to decide whether a node's front face may ever be smaller than its own label box (never, for `"inside"`/`"auto"`) — the actual placement lives in `glyphDiagramObject.ts`'s `resolveGlyphDiagram3dLabelPlacement`, which reads the SAME option again. */
  readonly labels?: "inside" | "side" | "auto";
  /** Force only. A fixed 32-bit seed — the SAME seed always produces the SAME layout. Default `1`. */
  readonly seed?: number;
  /** Force only. Fixed tick count — never a convergence check against a clock. Default `300`. */
  readonly iterations?: number;
}

// ---------------------------------------------------------------------------
// mulberry32 — a tiny, public-domain, deterministic 32-bit PRNG. No global
// state, no clock: the same `seed` always produces the same sequence.
// ---------------------------------------------------------------------------
function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A point on `boxHalf`-sized box (or sphere) surface, in the direction of `toward`, starting from `center` — the generic "an edge lands on a node face, never inside it" primitive, shared by every same-rank/self-loop edge in `layered` and every edge in `force`. Unchanged from D1/D2. */
function nodeSurfaceAnchor(center: Vec3, half: Vec3, sphere: boolean, toward: Vec3): Vec3 {
  const d: Vec3 = [toward[0] - center[0], toward[1] - center[1], toward[2] - center[2]];
  const len = Math.hypot(d[0], d[1], d[2]);
  if (len === 0) return [...center];
  if (sphere) {
    const r = Math.max(half[0], half[1], half[2]);
    const t = r / len;
    return [center[0] + d[0] * t, center[1] + d[1] * t, center[2] + d[2] * t];
  }
  let t = Infinity;
  for (let i = 0; i < 3; i++) if (d[i] !== 0) t = Math.min(t, half[i] / Math.abs(d[i]));
  if (!Number.isFinite(t)) return [...center];
  return [center[0] + d[0] * t, center[1] + d[1] * t, center[2] + d[2] * t];
}

/** A self-loop's own 3 points (D1 review finding: `toward === center` degenerates to a point otherwise) — unchanged. */
function selfLoopPoints(center: Vec3, half: Vec3, sphere: boolean): Vec3[] {
  const reach = Math.max(half[0], half[1], half[2]) || 1;
  const exitToward: Vec3 = [center[0] + reach, center[1] + reach * 0.35, center[2] + reach * 0.2];
  const enterToward: Vec3 = [center[0] + reach * 0.35, center[1] + reach, center[2] + reach * 0.2];
  const p0 = nodeSurfaceAnchor(center, half, sphere, exitToward);
  const p1 = nodeSurfaceAnchor(center, half, sphere, enterToward);
  const apex: Vec3 = [center[0] + reach * 1.6, center[1] + reach * 1.6, center[2] + reach * 0.4];
  return [p0, apex, p1];
}

/** Plain world-axis-aligned group bounding box — the SAME computation `force` layout has always used, now shared by `layered` too (D2 round 7: neither layout has a shared-plane basis to project a group through any more). */
function computeGroupBounds(members: readonly GlyphDiagram3dNode[]): { readonly z: number; readonly min: Vec3; readonly max: Vec3 } {
  const minX = Math.min(...members.map((m) => m.center[0] - m.half[0])) - GLYPH_DIAGRAM_3D_GROUP_PAD;
  const maxX = Math.max(...members.map((m) => m.center[0] + m.half[0])) + GLYPH_DIAGRAM_3D_GROUP_PAD;
  const minY = Math.min(...members.map((m) => m.center[1] - m.half[1])) - GLYPH_DIAGRAM_3D_GROUP_PAD;
  const maxY = Math.max(...members.map((m) => m.center[1] + m.half[1])) + GLYPH_DIAGRAM_3D_GROUP_PAD;
  const minZ = Math.min(...members.map((m) => m.center[2] - m.half[2])) - GLYPH_DIAGRAM_3D_GROUP_PAD;
  const maxZ = Math.max(...members.map((m) => m.center[2] + m.half[2])) + GLYPH_DIAGRAM_3D_GROUP_PAD;
  return { z: (minZ + maxZ) / 2, min: [minX, minY, minZ], max: [maxX, maxY, maxZ] };
}

type Axis3 = "x" | "y" | "z";
function axisOf(v: Vec3, axis: Axis3): number { return axis === "x" ? v[0] : axis === "y" ? v[1] : v[2]; }
function withAxis(v: Vec3, axis: Axis3, value: number): Vec3 {
  return axis === "x" ? [value, v[1], v[2]] : axis === "y" ? [v[0], value, v[2]] : [v[0], v[1], value];
}
function addAxis(v: Vec3, axis: Axis3, delta: number): Vec3 { return withAxis(v, axis, axisOf(v, axis) + delta); }

/**
 * Collapse a run of same-value samples (dagre positions same-rank nodes at
 * the IDENTICAL coordinate along the rank axis) into ordered rank groups —
 * a small tolerance absorbs float noise, never enough to merge two genuinely
 * different ranks (dagre's own `ranksep` floor is >= 3, an order of
 * magnitude above it). Returns groups of INDICES, in TOPOLOGICAL rank order
 * (`ascending` picks whether rank 0 is the smallest or largest raw value —
 * dagre's own `rankdir` convention: `TB`/`LR` place rank 0 at the minimum,
 * `BT`/`RL` at the maximum, since dagre computes the latter two as `TB`/`LR`
 * internally and flips the result).
 */
function clusterRanks(values: readonly number[], tolerance: number, ascending: boolean): number[][] {
  const order = values.map((v, i) => ({ v, i })).sort((a, b) => (ascending ? a.v - b.v : b.v - a.v));
  const groups: number[][] = [];
  let current: number[] = [];
  let prev: number | null = null;
  for (const { v, i } of order) {
    if (prev !== null && Math.abs(v - prev) > tolerance) { groups.push(current); current = []; }
    current.push(i);
    prev = v;
  }
  if (current.length) groups.push(current);
  return groups;
}

/**
 * Triangulated in-plane offsets for `count` ring-placed siblings, in the
 * SAME order they're handed in (dagre's own within-rank order) — see this
 * file's own top-of-file doc for why one ring formula covers every count
 * the brief enumerated. `spanA`/`spanB` are the rank's own largest
 * cross-axis-1/depth half-extents (for radius sizing); `baseAngleDeg`
 * rotates the whole ring for this rank. **D2 round 8**: `spanA`/`spanB` are
 * now the CAMERA-AWARE conservative bound (`screenSafeFlowHalf`, this
 * file's own doc) rather than a single raw world axis, and `labelRoom`
 * (world units, this rank's own longest side label) is added to the
 * required chord so a label pointing radially outward from one sibling
 * never reaches into its neighbour's own arc.
 */
function triangulatedOffsets(count: number, spanA: number, spanB: number, baseAngleDeg: number, labelRoom = 0): { readonly a: number; readonly b: number }[] {
  if (count <= 1) return [{ a: 0, b: 0 }];
  const need = Math.max(spanA, spanB) * 2 + GLYPH_DIAGRAM_3D_RING_GAP + labelRoom;
  const radius = need / (2 * Math.sin(Math.PI / count));
  const base = (baseAngleDeg * Math.PI) / 180;
  const out: { a: number; b: number }[] = [];
  for (let i = 0; i < count; i++) {
    const theta = base + (2 * Math.PI * i) / count;
    out.push({ a: radius * Math.cos(theta), b: radius * Math.sin(theta) });
  }
  return out;
}

function flowSignForDirection(direction: GlyphGraphDirection): 1 | -1 {
  switch (direction) {
    case "LR": return 1;
    case "RL": return -1;
    case "TB": return -1;
    default: return 1; // BT
  }
}

async function layoutLayered(graph: GlyphGraph, options: GlyphDiagram3dLayoutOptions): Promise<GlyphDiagram3dLayout> {
  const measured = measureGlyphGraph(graph, { labelWidth: options.labelWidth, direction: options.direction });
  const compressedSizes = compressExplicitSizes(graph.nodes);

  // Widen the 2D MEASUREMENT itself for a node whose compressed 3D size
  // needs more room than its label alone would reserve (explicit `size`),
  // or up to the module's own upright HEIGHT FLOOR — unchanged from D2
  // round 6. `laid.nodes[i].width`/`.height` below ARE these widened
  // values, dagre only ever repositions, never resizes.
  const widenedNodes: GlyphDiagramMeasuredNode[] = measured.nodes.map((node) => {
    const compressed = compressedSizes.get(node.id);
    // A node with an explicit `size` gets the SMALL explicit floor
    // (`GLYPH_DIAGRAM_3D_MIN_HEIGHT_EXPLICIT`) rather than the label-
    // readability one — the whole point of an authored `size[1]` (a CNN
    // layer's own shrinking/growing tensor volume) is to be genuinely
    // small on this axis sometimes, and the 12-unit floor used to erase
    // that for every node whose intended height fell under it (this
    // file's own `GLYPH_DIAGRAM_3D_MIN_HEIGHT` doc).
    // Width, too: `node.width` (the 2D-MEASURED label width, in characters)
    // used to be an unconditional floor even for a sized node — harmless
    // for a short label, but a real one ("pool 14x14x6", 12+ characters)
    // dominated every genuinely narrow tensor slab's own intended width,
    // flattening exactly the X-axis shrink the size data was authored to
    // show. Safe to drop now that a label defaults to `"side"` placement
    // (never painted ON the node's own face, so the box no longer needs to
    // be wide enough to hold it) — only `GLYPH_DIAGRAM_3D_MIN_HEIGHT_EXPLICIT`
    // (a tiny floor against literal zero) remains.
    if (compressed) return { ...node, width: Math.max(GLYPH_DIAGRAM_3D_MIN_HEIGHT_EXPLICIT, Math.ceil(compressed[0])), height: Math.max(node.height, Math.ceil(compressed[1]), GLYPH_DIAGRAM_3D_MIN_HEIGHT_EXPLICIT) };
    return { ...node, height: Math.max(node.height, GLYPH_DIAGRAM_3D_MIN_HEIGHT) };
  });

  const direction = measured.direction;
  const horizontalFlow = direction === "LR" || direction === "RL";
  const flowSign = flowSignForDirection(direction);
  const nodesep = options.nodesep ?? 4, ranksep = options.ranksep ?? 4;
  // `ports: []` short-circuits `layoutGlyphGraph`'s own
  // `reserveGlyphGraphPorts(measureGlyphGraph(...))` fallback (`"ports" in
  // graph` reads true) — this round has no A* router/port reservation left
  // to feed, so dagre sees each node's own PLAIN widened width/height with
  // no port-count padding added on top of it.
  const laid = await layoutGlyphGraph({ ...measured, nodes: widenedNodes, ports: [] }, { nodesep, ranksep });

  const degree = new Map<string, number>();
  for (const edge of laid.edges) {
    degree.set(edge.from, (degree.get(edge.from) ?? 0) + 1);
    degree.set(edge.to, (degree.get(edge.to) ?? 0) + 1);
  }

  const rankAxisValue = (n: GlyphDiagramPositionedNode) => horizontalFlow ? (n.x0 + n.x1) / 2 : (n.y0 + n.y1) / 2;
  const crossAxisValue = (n: GlyphDiagramPositionedNode) => horizontalFlow ? (n.y0 + n.y1) / 2 : (n.x0 + n.x1) / 2;
  const rank0IsMin = direction === "TB" || direction === "LR";
  const clusters = clusterRanks(laid.nodes.map(rankAxisValue), 1, rank0IsMin);

  // Per-node dims, ALWAYS in the literal box X/Y/Z convention (this file's
  // own top-of-file doc): width always X, depth (extrusion) always Y,
  // height always Z — `laid.nodes[i].width`/`.height` are already the
  // widened label footprint above.
  const flowHalfOf = (n: GlyphDiagramPositionedNode) => (horizontalFlow ? n.width : n.height) / 2;
  const crossHalfOf = (n: GlyphDiagramPositionedNode) => (horizontalFlow ? n.height : n.width) / 2;
  const depthHalfOf = (n: GlyphDiagramPositionedNode) => {
    const compressedDepth = compressedSizes.get(n.id)?.[2];
    // Same fix as the height floor above, for the depth (Y) axis: an
    // explicit `size[2]` is trusted against only a tiny floor
    // (`GLYPH_DIAGRAM_3D_MIN_DEPTH_EXPLICIT`), never against
    // `GLYPH_DIAGRAM_3D_MIN_DEPTH`/the label-derived heuristic — both of
    // which used to swamp a genuinely thin authored depth (a CNN's own
    // channel-count-1 input layer) the same way the height floor did.
    if (compressedDepth !== undefined) return Math.max(GLYPH_DIAGRAM_3D_MIN_DEPTH_EXPLICIT, compressedDepth) / 2;
    return Math.max(GLYPH_DIAGRAM_3D_MIN_DEPTH, GLYPH_DIAGRAM_3D_DEPTH_FACTOR * Math.min(n.width, n.height)) / 2;
  };

  // Rank-to-rank spacing along the flow axis: each rank's own CENTRE sits
  // past the previous rank's far edge (its own max flow-half-extent) by
  // `GLYPH_DIAGRAM_3D_RANK_GAP`, then extends this rank's own max
  // flow-half-extent further. **The gap must be sized off the box's own
  // SCREEN SILHOUETTE, not its raw flow-axis world extent** — under this
  // file's own fixed oblique camera (`GLYPH_DIAGRAM_3D_CAMERA_ROT_X`/`_ROT_Y`,
  // rotX=62/rotY=36), the box's DEPTH and HEIGHT axes contribute AS MUCH to
  // the projected screen column as the flow axis itself does (measured: at
  // this camera, |dcol/dY| > |dcol/dX|), so spacing ranks by flow-axis
  // half-width alone left every rank-adjacent pair's own projected COLUMN
  // WIDTH overlapping its neighbour's by 17-22% (measured against the real
  // LeNet-5 fixture's own auto-fit camera, `render3d.test.ts`'s own
  // "consecutive-RANK" gate) — visually compounding across an 8-rank chain
  // into the reported unreadable diagonal smear, even though no two boxes
  // ever overlapped in world X. `screenSafeFlowHalf` sums ALL THREE of a box's
  // own half-extents as its along-flow spacing unit — a conservative
  // bound on the true projected silhouette (every axis's own screen
  // contribution here is within the same order of magnitude, so summing
  // all three, rather than scaling by the camera's own per-axis
  // coefficients, is simple and safely over-spaces rather than under).
  const screenSafeFlowHalf = (n: GlyphDiagramPositionedNode) => flowHalfOf(n) + crossHalfOf(n) + depthHalfOf(n);
  let frontier = 0;
  const rankFlowCoord: number[] = [];
  for (const idxs of clusters) {
    const maxFlowHalf = Math.max(...idxs.map((i) => screenSafeFlowHalf(laid.nodes[i]!)));
    const center = frontier + maxFlowHalf;
    rankFlowCoord.push(center);
    frontier = center + maxFlowHalf + GLYPH_DIAGRAM_3D_RANK_GAP;
  }

  // D2 round 8 — a rank's own longest side-label text, in CHARACTERS
  // (`n2d.lines[0]` is the same folded first line `glyphDiagramObject.ts`'s
  // overlay places), fed into `triangulatedOffsets`' own `labelRoom` so the
  // ring leaves room for a label reaching past its own node's edge.
  const labelLenOf = (n: GlyphDiagramPositionedNode) => n.lines[0]?.length ?? 0;

  const positions: Vec3[] = new Array(laid.nodes.length);
  clusters.forEach((idxs, rank) => {
    const ordered = [...idxs].sort((ia, ib) => crossAxisValue(laid.nodes[ia]!) - crossAxisValue(laid.nodes[ib]!));
    // D2 round 8 — the ring's own radius is sized off the SAME camera-aware
    // conservative bound `screenSafeFlowHalf` already uses for rank
    // spacing (this function's own doc above), not a single raw in-plane
    // axis: under this file's oblique fixed camera every one of a box's
    // three axes contributes to its projected SCREEN silhouette, so
    // spacing siblings by only their cross/depth half-extents left them
    // reading as one fused block at 96x32 even though their WORLD-space
    // ring positions were already distinct (the reported "difficult to
    // see them separate").
    const spanSafe = Math.max(...ordered.map((i) => screenSafeFlowHalf(laid.nodes[i]!)));
    const maxLabelLen = Math.max(0, ...ordered.map((i) => labelLenOf(laid.nodes[i]!)));
    const labelRoom = maxLabelLen > 0 ? maxLabelLen * GLYPH_DIAGRAM_3D_RING_LABEL_UNIT + GLYPH_DIAGRAM_3D_RING_GAP : 0;
    const baseAngle = GLYPH_DIAGRAM_3D_RING_BASE_ANGLE + rank * GLYPH_DIAGRAM_3D_RING_ROTATE_DEG;
    const offsets = triangulatedOffsets(ordered.length, spanSafe, spanSafe, baseAngle, labelRoom);
    const flowCoord = flowSign * rankFlowCoord[rank]!;
    ordered.forEach((i, orderIdx) => {
      const { a, b } = offsets[orderIdx]!;
      positions[i] = horizontalFlow ? [flowCoord, b, a] : [a, b, flowCoord];
    });
  });

  const nodes: GlyphDiagram3dNode[] = laid.nodes.map((n2d, i) => ({
    id: n2d.id, label: n2d.lines.join("\n"), shape: n2d.shape ?? "rect", kind: n2d.kind, group: n2d.group,
    degree: degree.get(n2d.id) ?? 0,
    center: positions[i]!,
    half: [n2d.width / 2, depthHalfOf(n2d), n2d.height / 2],
  }));
  const byId = new Map(nodes.map((nd) => [nd.id, nd]));

  const flowAxis: Axis3 = horizontalFlow ? "x" : "z";
  // The OTHER in-plane axis (never Y, always depth) — this file's own
  // top-of-file doc: LR/RL's cross-section plane is Z/Y, TB/BT's is X/Y.
  // Used only to BOW a residual/skip edge out of the flow-axis line it
  // would otherwise draw straight through an intervening rank's own box.
  const crossAxis: Axis3 = horizontalFlow ? "z" : "x";
  // Rank INDEX per node (0-based, topological order) — distinct from the
  // continuous flow COORDINATE: a skip/residual edge is one whose two
  // ranks are 2+ apart (it bypasses at least one real node's own rank),
  // never a raw world-distance threshold, which a `size`-driven layout's
  // own uneven rank spacing would make unreliable.
  const rankIndexOf = new Map<string, number>();
  clusters.forEach((idxs, rank) => { for (const i of idxs) rankIndexOf.set(laid.nodes[i]!.id, rank); });

  /**
   * USER FEEDBACK (task brief, verbatim): "make the RESIDUAL/skip
   * connections visible as edges arcing over the stack; that is the one
   * thing 3D does better than 2D here." A skip edge (its two ranks 2+
   * apart) gets a 3RD point — a midpoint pushed OUT along the plane's own
   * cross axis, past whichever intervening node's own half-extent is
   * larger — so `glyphDiagramObject.ts`'s existing per-segment edge loop
   * (already built for a self-loop's own 3-point path) draws it as two
   * segments bowing around the stack instead of one straight line punched
   * through the bypassed node's box.
   */
  function skipEdgeApex(from: GlyphDiagram3dNode, to: GlyphDiagram3dNode): Vec3 {
    const mid: Vec3 = [(from.center[0] + to.center[0]) / 2, (from.center[1] + to.center[1]) / 2, (from.center[2] + to.center[2]) / 2];
    const bowClear = Math.max(axisOf(from.half, crossAxis), axisOf(to.half, crossAxis)) + GLYPH_DIAGRAM_3D_SKIP_EDGE_BOW;
    return withAxis(mid, crossAxis, axisOf(mid, crossAxis) + bowClear);
  }

  const edges: GlyphDiagram3dEdge[] = laid.edges.map((edge) => {
    const from = byId.get(edge.from)!, to = byId.get(edge.to)!;
    if (edge.from === edge.to) {
      return { id: edge.id, from: edge.from, to: edge.to, label: edge.label, style: edge.style ?? "solid", priority: edge.priority ?? 0, points: selfLoopPoints(from.center, from.half, from.shape === "circle") };
    }
    const flowDelta = axisOf(to.center, flowAxis) - axisOf(from.center, flowAxis);
    let points: Vec3[];
    if (Math.abs(flowDelta) > 1e-6) {
      // The edge genuinely spans ranks — leave the source's OWN
      // flow-facing side toward the target (a forward edge exits +flow,
      // a back-edge exits -flow) and arrive at the target's opposite
      // side, so a cycle-closing back-edge reads as re-entering from the
      // downstream direction rather than punching through the target's
      // forward face.
      const dir = Math.sign(flowDelta) as 1 | -1;
      const fromHalf = horizontalFlow ? from.half[0] : from.half[2];
      const toHalf = horizontalFlow ? to.half[0] : to.half[2];
      const p0 = addAxis(from.center, flowAxis, dir * fromHalf);
      const p1 = addAxis(to.center, flowAxis, -dir * toHalf);
      const rankSpan = Math.abs((rankIndexOf.get(edge.to) ?? 0) - (rankIndexOf.get(edge.from) ?? 0));
      points = rankSpan >= 2 ? [p0, skipEdgeApex(from, to), p1] : [p0, p1];
    } else {
      // Same-rank (or degenerate) edge — no flow-axis face to leave from;
      // fall back to the generic nearest-surface anchor.
      const p0 = nodeSurfaceAnchor(from.center, from.half, from.shape === "circle", to.center);
      const p1 = nodeSurfaceAnchor(to.center, to.half, to.shape === "circle", from.center);
      points = [p0, p1];
    }
    return { id: edge.id, from: edge.from, to: edge.to, label: edge.label, style: edge.style ?? "solid", priority: edge.priority ?? 0, points };
  });

  const groups: GlyphDiagram3dGroup[] = laid.groups.map((g) => {
    const members = g.members.map((id) => byId.get(id)).filter((m): m is GlyphDiagram3dNode => !!m);
    if (members.length === 0) return { id: g.id, label: g.label, z: 0, min: [0, 0, 0] as Vec3, max: [0, 0, 0] as Vec3 };
    const bounds = computeGroupBounds(members);
    return { id: g.id, label: g.label, ...bounds };
  });

  const ledger: GlyphDiagramLedgerEntry[] = [...measured.ledger, ...laid.ledger];
  return { nodes, edges, groups, ledger };
}

async function layoutForce(graph: GlyphGraph, options: GlyphDiagram3dLayoutOptions): Promise<GlyphDiagram3dLayout> {
  const seed = options.seed ?? 1;
  const iterations = options.iterations ?? 300;
  if (!Number.isInteger(seed)) glyphDiagramError("bad-options", "layout3d: seed must be an integer.");
  if (!Number.isInteger(iterations) || iterations < 1) glyphDiagramError("bad-options", "layout3d: iterations must be a positive integer.");

  const measured = measureGlyphGraph(graph, { labelWidth: options.labelWidth, direction: options.direction });
  const rand = mulberry32(seed);
  const count = measured.nodes.length;
  const degree = new Map<string, number>();
  for (const edge of measured.edges) {
    degree.set(edge.from, (degree.get(edge.from) ?? 0) + 1);
    degree.set(edge.to, (degree.get(edge.to) ?? 0) + 1);
  }

  const avgFootprint = measured.nodes.reduce((s, m) => s + Math.max(m.width, m.height), 0) / Math.max(1, count);
  const k = Math.max(4, avgFootprint * 1.5);
  const spread = k * Math.cbrt(count + 1);

  const pos: Vec3[] = measured.nodes.map(() => [
    (rand() - 0.5) * spread, (rand() - 0.5) * spread, (rand() - 0.5) * spread,
  ]);
  const idIndex = new Map(measured.nodes.map((m, i) => [m.id, i]));
  const EPS = 1e-6;

  let temperature = spread / 8;
  const cooling = Math.pow(0.01, 1 / iterations);
  for (let iter = 0; iter < iterations; iter++) {
    const disp: Vec3[] = pos.map(() => [0, 0, 0]);
    for (let i = 0; i < count; i++) {
      for (let j = i + 1; j < count; j++) {
        const dx = pos[i]![0] - pos[j]![0], dy = pos[i]![1] - pos[j]![1], dz = pos[i]![2] - pos[j]![2];
        const dist = Math.max(EPS, Math.hypot(dx, dy, dz));
        const force = (k * k) / dist;
        const ux = dx / dist, uy = dy / dist, uz = dz / dist;
        disp[i]![0] += ux * force; disp[i]![1] += uy * force; disp[i]![2] += uz * force;
        disp[j]![0] -= ux * force; disp[j]![1] -= uy * force; disp[j]![2] -= uz * force;
      }
    }
    for (const edge of measured.edges) {
      const i = idIndex.get(edge.from)!, j = idIndex.get(edge.to)!;
      const dx = pos[i]![0] - pos[j]![0], dy = pos[i]![1] - pos[j]![1], dz = pos[i]![2] - pos[j]![2];
      const dist = Math.max(EPS, Math.hypot(dx, dy, dz));
      const force = (dist * dist) / k;
      const ux = dx / dist, uy = dy / dist, uz = dz / dist;
      disp[i]![0] -= ux * force; disp[i]![1] -= uy * force; disp[i]![2] -= uz * force;
      disp[j]![0] += ux * force; disp[j]![1] += uy * force; disp[j]![2] += uz * force;
    }
    for (const group of measured.groups) {
      const memberIdx = group.members.map((id) => idIndex.get(id)).filter((i): i is number => i !== undefined);
      if (memberIdx.length < 2) continue;
      const cx = memberIdx.reduce((s, i) => s + pos[i]![0], 0) / memberIdx.length;
      const cy = memberIdx.reduce((s, i) => s + pos[i]![1], 0) / memberIdx.length;
      const cz = memberIdx.reduce((s, i) => s + pos[i]![2], 0) / memberIdx.length;
      for (const i of memberIdx) {
        disp[i]![0] += (cx - pos[i]![0]) * 0.1;
        disp[i]![1] += (cy - pos[i]![1]) * 0.1;
        disp[i]![2] += (cz - pos[i]![2]) * 0.1;
      }
    }
    for (let i = 0; i < count; i++) {
      const dist = Math.max(EPS, Math.hypot(disp[i]![0], disp[i]![1], disp[i]![2]));
      const limited = Math.min(dist, temperature);
      pos[i]![0] += (disp[i]![0] / dist) * limited;
      pos[i]![1] += (disp[i]![1] / dist) * limited;
      pos[i]![2] += (disp[i]![2] / dist) * limited;
    }
    temperature *= cooling;
  }

  const forceCompressedSizes = compressExplicitSizes(graph.nodes);
  const nodes: GlyphDiagram3dNode[] = measured.nodes.map((m, i) => {
    const compressed = forceCompressedSizes.get(m.id);
    const [width, height, depth] = compressed ?? [Math.max(m.width, 12), 7, 2.4];
    return {
      id: m.id, label: m.lines.join("\n"), shape: m.shape ?? "rect", kind: m.kind, group: m.group,
      degree: degree.get(m.id) ?? 0,
      center: pos[i]!,
      half: [width / 2, depth / 2, height / 2],
    };
  });
  const byId = new Map(nodes.map((nd) => [nd.id, nd]));

  const edges: GlyphDiagram3dEdge[] = measured.edges.map((e) => {
    const from = byId.get(e.from)!, to = byId.get(e.to)!;
    if (e.from === e.to) {
      return { id: e.id, from: e.from, to: e.to, label: e.label, style: e.style ?? "solid", priority: e.priority ?? 0, points: selfLoopPoints(from.center, from.half, from.shape === "circle") };
    }
    const p0 = nodeSurfaceAnchor(from.center, from.half, from.shape === "circle", to.center);
    const p1 = nodeSurfaceAnchor(to.center, to.half, to.shape === "circle", from.center);
    return { id: e.id, from: e.from, to: e.to, label: e.label, style: e.style ?? "solid", priority: e.priority ?? 0, points: [p0, p1] };
  });

  const groups: GlyphDiagram3dGroup[] = measured.groups.map((g) => {
    const members = g.members.map((id) => byId.get(id)).filter((nd): nd is GlyphDiagram3dNode => !!nd);
    if (members.length === 0) return { id: g.id, label: g.label, z: 0, min: [0, 0, 0] as Vec3, max: [0, 0, 0] as Vec3 };
    const bounds = computeGroupBounds(members);
    return { id: g.id, label: g.label, ...bounds };
  });

  return { nodes, edges, groups, ledger: [...measured.ledger] };
}

export async function layout3d(graph: GlyphGraph, options: GlyphDiagram3dLayoutOptions = {}): Promise<GlyphDiagram3dLayout> {
  const kind = options.layout ?? "layered";
  if (kind === "force") return layoutForce(graph, options);
  if (kind === "layered") return layoutLayered(graph, options);
  glyphDiagramError("bad-options", 'layout3d: layout must be "layered" or "force".');
}
