/**
 * 3D graph layout (PLAN-3d.md §6, packet D1). Two layouts share one output
 * shape (`GlyphDiagram3dLayout`): a `"layered"` one (the default, for agent
 * architectures) that reuses the EXISTING 2D dagre pipeline
 * (`measureGlyphGraph`/`layoutGlyphGraph`) for the X/Y plane and adds a
 * semantic Z axis (`zBy`); and a `"force"` one, a hand-rolled, SEEDED
 * Fruchterman-Reingold-style simulation in full 3D (springs + repulsion +
 * group attraction), deterministic by construction — no `Date.now()`, no
 * `Math.random()`, a fixed iteration count.
 *
 * `zBy` only applies to `"layered"` — a force layout already places every
 * node's Z from the simulation itself, so there is no separate "floor" to
 * assign it to.
 */
import type { GlyphGraph, GlyphGraphDirection, GlyphGraphEdgeStyle, GlyphGraphNode, GlyphGraphNodeShape } from "../types";
import { measureGlyphGraph, layoutGlyphGraph, type GlyphDiagramLayoutOptions } from "../pipeline";
import { glyphDiagramError } from "../validate";
import type { Vec3 } from "glyphcss";

/**
 * D2 round 3 — architecture objects (codex/user finding): fix round 1's
 * `NODE_HEIGHT = 0.35` (a "thin plate") over-corrected — at that thickness,
 * against the tiny auto-fit zoom a many-node diagram forces, a node
 * rasterized to a handful of near-collinear outline cells with no visible
 * FACE at all ("a tiny thin slanted outline... floating in empty space",
 * the user's own words). A diagram node is an upright STANDING object —
 * `GLYPH_DIAGRAM_3D_LAYER_HEIGHT` grew to match (still comfortably above
 * height + a real gap for a TB-stacked tier).
 */
export const GLYPH_DIAGRAM_3D_LAYER_HEIGHT = 5;
/**
 * D2 round 4 (codex: "objects are slivers next to full-size labels"):
 * round 3's `3.2` was still too thin against a label's own FIXED
 * screen-cell footprint (a label never shrinks with zoom, since it is
 * stamped as literal characters — see `glyphDiagramObject.ts`'s own
 * `resolveGlyphDiagram3dLabelPlacement` doc) — at the zoom a many-node
 * diagram's own total span forces, a `3.2`-tall box under a 12-16-char
 * label rasterized to a handful of cells, all consumed by the label sitting
 * ON it. Bumped so a default box's own screen silhouette clears the
 * `>= 10 cols x 5 rows` legibility floor (`layout3d.test.ts`'s own gate)
 * for a modest (<= 8 node) graph at 96x32.
 */
export const GLYPH_DIAGRAM_3D_NODE_HEIGHT = 7;
/** Default node DEPTH (world Y, "into the screen") when `size` is absent — modest, so a box reads as upright rather than squat, bumped alongside `NODE_HEIGHT` (D2 round 4). */
export const GLYPH_DIAGRAM_3D_NODE_DEPTH = 2.4;
/** Padding (world units, = cells for a layered layout) added around a group's member footprint before it becomes a floor plate / wireframe volume. */
export const GLYPH_DIAGRAM_3D_GROUP_PAD = 2;
/**
 * D2 round 4 (codex: "gaps between objects should be about 0.5-1x an
 * object width, not many object widths"): the flow-axis clear gap between
 * two adjacent objects, as a FRACTION of the (average of the) two
 * neighbors' own half-extent along the flow axis — never a flat constant
 * (dagre's own `ranksep`/a fixed cell count), which reads as "many object
 * widths" apart the moment an object is small. `0.6` sits inside the
 * requested 0.5-1x band.
 */
const GLYPH_DIAGRAM_3D_FLOW_GAP_FACTOR = 0.5;
/** Absolute floor under the proportional gap above, so two zero/near-zero-width objects never fully touch. */
const GLYPH_DIAGRAM_3D_FLOW_GAP_MIN = 0.75;

/**
 * D2 round 4, requirement 4 ("size scaling blows up... scale explicit
 * `size` into display units with a COMPRESSING map (sqrt or log) and clamp
 * the largest:smallest ratio to about 4x per axis"): a CNN's own literal
 * activation-map extents can span an order of magnitude axis-to-axis (32
 * down to 5), and rendering that literally makes the smallest layer an
 * illegible speck beside the largest. Compressed PER AXIS, independently,
 * across every node that gave an explicit `size` (a node with none is
 * UNTOUCHED — "defaults are uniform", the same requirement's own second
 * half): `compressed = max * (raw/max) ** 0.5` (sqrt) keeps the axis's own
 * largest value exactly where it was and pulls every smaller one up
 * nonlinearly (a raw ratio of 1/8 becomes ~0.35, not 0.125), then the
 * smallest is clamped UP to at least `max / SIZE_MAX_RATIO` so a real CNN
 * still visibly shrinks across its own layers but never collapses past a
 * 4x spread. `Vec3`-shaped per node so `resolveNodeSize` below can read it
 * exactly like a literal `size`, just pre-processed once per graph.
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

/**
 * `[width, height, depth]` for one node — the graph's own COMPRESSED
 * explicit size when the caller gave one (`compressExplicitSizes` above),
 * else the label-derived WIDTH (dagre's own measured box) paired with the
 * upright HEIGHT/DEPTH defaults above.
 */
function resolveNodeSize(graphNode: GlyphGraphNode | undefined, labelWidthCells: number, compressed?: Vec3): Vec3 {
  if (compressed) return [...compressed];
  if (graphNode?.size) return [...graphNode.size];
  // D2 round 4: `12` (up from round 3's `3`) — a short label ("Coder")
  // still left its own box narrower than tall/deep even with dagre's own
  // padding folded in (measured: 9 world units), and the auto-fit zoom a
  // TB stack's own real HEIGHT total drives is the SAME zoom that box's
  // WIDTH renders at, so a too-narrow floor still fell under the
  // silhouette gate even once height/depth alone were legible.
  return [Math.max(labelWidthCells, 12), GLYPH_DIAGRAM_3D_NODE_HEIGHT, GLYPH_DIAGRAM_3D_NODE_DEPTH];
}

export type GlyphDiagram3dLayoutKind = "layered" | "force";
export type GlyphDiagram3dZBy = "group" | "kind" | "rank" | "none";

export interface GlyphDiagram3dNode {
  readonly id: string;
  readonly label: string;
  readonly shape: GlyphGraphNodeShape;
  readonly kind?: string;
  readonly group?: string;
  readonly degree: number;
  /** Box/sphere center, world space. */
  readonly center: Vec3;
  /** Half-extents along X (width), Y (depth), Z (height). */
  readonly half: Vec3;
}

export interface GlyphDiagram3dEdge {
  readonly id: string;
  readonly from: string;
  readonly to: string;
  readonly label?: string;
  readonly style: GlyphGraphEdgeStyle;
  readonly priority: number;
  /** >= 2 points; the first and last land on the source's/target's own box (or sphere) surface — never inside it, never floating off it. */
  readonly points: readonly Vec3[];
}

export interface GlyphDiagram3dGroup {
  readonly id: string;
  readonly label?: string;
  readonly z: number;
  readonly min: Vec3;
  readonly max: Vec3;
}

export interface GlyphDiagram3dLayout {
  readonly nodes: readonly GlyphDiagram3dNode[];
  readonly edges: readonly GlyphDiagram3dEdge[];
  readonly groups: readonly GlyphDiagram3dGroup[];
}

export interface GlyphDiagram3dLayoutOptions extends Pick<GlyphDiagramLayoutOptions, "labelWidth"> {
  readonly layout?: GlyphDiagram3dLayoutKind;
  readonly direction?: GlyphGraphDirection;
  /** Layered only (§6). Default `"group"`. */
  readonly zBy?: GlyphDiagram3dZBy;
  readonly nodesep?: number;
  readonly ranksep?: number;
  /** Force only. A fixed 32-bit seed — the SAME seed always produces the SAME layout (mutation: reseed from `Date.now()` → the digest test reddens). Default `1`. */
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

/** A point on `boxHalf`-sized box (or sphere, when `boxHalf` is uniform and `sphere` is true) surface, in the direction of `toward`, starting from `center` — the generic "edge endpoint lands on a node face" primitive. Works for a 2D difference (`toward.z === center.z`, e.g. a same-floor layered edge) and a full 3D one (a force-layout edge) alike. */
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

/**
 * D2 round 3 (codex, P1-2/user finding): a same-floor edge used to be one
 * STRAIGHT chord between the two nodes' own anchors — a diagonal line
 * through space wherever the two nodes aren't already X- or Y-aligned,
 * reading as "squiggles" rather than a structure. This is a 2-leg
 * Manhattan DOGLEG in the shared floor's XY plane instead: the DOMINANT
 * axis (the larger of `|dx|`, `|dy|`) is walked first, turning at `bend` —
 * built by copying ONE coordinate from each endpoint's own center, which
 * is what makes BOTH resulting legs exactly axis-aligned: `center -> bend`
 * has a zero component on whichever axis `bend` borrowed from that same
 * center, and `nodeSurfaceAnchor`'s own clip is a pure radial SCALE (never
 * a rotation), so clipping to the box/sphere surface preserves that
 * axis-alignment rather than introducing a new diagonal. Degenerates to
 * the old direct segment when the two centers already share an axis (a
 * bend point there would be redundant, not wrong).
 */
function orthogonalPlanePoints(
  fromCenter: Vec3, fromHalf: Vec3, fromSphere: boolean,
  toCenter: Vec3, toHalf: Vec3, toSphere: boolean,
  z: number,
): Vec3[] {
  const dx = toCenter[0] - fromCenter[0], dy = toCenter[1] - fromCenter[1];
  const EPS = 1e-9;
  if (Math.abs(dx) < EPS || Math.abs(dy) < EPS) {
    const p0 = nodeSurfaceAnchor(fromCenter, fromHalf, fromSphere, [toCenter[0], toCenter[1], z]);
    const p1 = nodeSurfaceAnchor(toCenter, toHalf, toSphere, [fromCenter[0], fromCenter[1], z]);
    return [p0, p1];
  }
  const xFirst = Math.abs(dx) >= Math.abs(dy);
  const bend: Vec3 = xFirst ? [toCenter[0], fromCenter[1], z] : [fromCenter[0], toCenter[1], z];
  const p0 = nodeSurfaceAnchor(fromCenter, fromHalf, fromSphere, bend);
  const p1 = nodeSurfaceAnchor(toCenter, toHalf, toSphere, bend);
  return [p0, bend, p1];
}

/**
 * A self-loop's `from`/`to` node is the SAME node, so `nodeSurfaceAnchor`'s
 * own `toward === center` degenerate case (`len === 0`) returned `center`
 * for both endpoints — a self-loop drawn as a single point (P1-c, D1 review
 * finding). Picks two DIFFERENT directions off the node's own footprint (the
 * +X-ish and +Y-ish faces, tilted up slightly so a `zBy` floor's own Z gap
 * doesn't collapse them either) so both endpoints land on a real face —
 * never inside the box, never floating off it, exactly like a normal edge —
 * and bulges a THIRD point out past the corner so the polyline reads as a
 * loop leaving and re-entering the node rather than a chord across it.
 */
function selfLoopPoints(center: Vec3, half: Vec3, sphere: boolean): Vec3[] {
  const reach = Math.max(half[0], half[1], half[2]) || 1;
  const exitToward: Vec3 = [center[0] + reach, center[1] + reach * 0.35, center[2] + reach * 0.2];
  const enterToward: Vec3 = [center[0] + reach * 0.35, center[1] + reach, center[2] + reach * 0.2];
  const p0 = nodeSurfaceAnchor(center, half, sphere, exitToward);
  const p1 = nodeSurfaceAnchor(center, half, sphere, enterToward);
  const apex: Vec3 = [center[0] + reach * 1.6, center[1] + reach * 1.6, center[2] + reach * 0.4];
  return [p0, apex, p1];
}

/** The smallest group (by member count, tied broken by id) that lists `nodeId` — mirrors `layoutGlyphGraph`'s own compound-parent choice (pipeline.ts), so a node's 3D "floor" agrees with which group dagre would nest it under. */
function smallestContainingGroup(nodeId: string, groups: readonly { id: string; members: readonly string[] }[]): string | undefined {
  const containing = groups.filter((g) => g.members.includes(nodeId));
  if (containing.length === 0) return undefined;
  containing.sort((a, b) => a.members.length - b.members.length || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return containing[0]!.id;
}

/** Builds a `key -> floor index` map from a sorted, deduplicated key list; `undefined`/`""` always maps to floor `0` (the ungrouped/kindless baseline), and every other key gets `1, 2, 3, …` in sorted order. */
function floorIndexTable(keys: readonly (string | undefined)[]): Map<string | undefined, number> {
  const distinct = [...new Set(keys.filter((k): k is string => !!k))].sort();
  const table = new Map<string | undefined, number>([[undefined, 0], ["", 0]]);
  distinct.forEach((k, i) => table.set(k, i + 1));
  return table;
}

async function layoutLayered(graph: GlyphGraph, options: GlyphDiagram3dLayoutOptions): Promise<GlyphDiagram3dLayout> {
  const laid = await layoutGlyphGraph(graph, {
    direction: options.direction, nodesep: options.nodesep, ranksep: options.ranksep, labelWidth: options.labelWidth,
  });
  const degree = new Map<string, number>();
  for (const edge of laid.edges) {
    degree.set(edge.from, (degree.get(edge.from) ?? 0) + 1);
    degree.set(edge.to, (degree.get(edge.to) ?? 0) + 1);
  }

  // The EFFECTIVE direction is `options.direction ?? graph.direction` — the
  // SAME fallback `pipeline.ts`'s `measureGlyphGraph` applies internally
  // (`options.direction ?? canonical.direction`) — never `options.direction`
  // alone, which is `undefined` in the ordinary case (a caller names the
  // direction on the GRAPH, not as a separate layout override) and would
  // otherwise misclassify every direction-on-the-graph-only LR/RL diagram
  // as "vertical" here.
  const effectiveDirection = options.direction ?? graph.direction;
  const isVertical = effectiveDirection === "TB" || effectiveDirection === "BT";
  // D2 round 4 (codex: "TB: the stack goes UP along world Z... not along a
  // floor diagonal"): the OLD default (`zBy: "group"`, unconditionally) left
  // every node of an UNGROUPED TB graph on floor 0 — a transformer's own
  // stages then rode dagre's plain Y (rank) position, still on ONE floor, so
  // the "vertical stack" the direction implies was really a flat diagonal
  // under any 3/4 camera. `zBy` LEFT UNSET on an ungrouped TB/BT graph now
  // means "stack along Z, one rank at a time" instead — the SAME real-size
  // sequential packer LR/RL's own flow axis uses below, just walking Z. A
  // graph that already has real groups (`agent-supervisor`) is UNCHANGED:
  // its own `zBy: "group"` floors already give a genuine Z read (supervisor
  // above workers), and an explicit `zBy` from the caller always wins,
  // exactly as before this round.
  const useRankZFlow = options.zBy === undefined && isVertical && laid.groups.length === 0;
  const zBy = options.zBy ?? "group";

  let zOf: (nodeId: string) => number = () => 0; // unused when `useRankZFlow` (Z comes from `flowOverride` directly)
  if (!useRankZFlow) {
    if (zBy === "none") {
      zOf = () => 0;
    } else if (zBy === "kind") {
      const table = floorIndexTable(laid.nodes.map((n) => n.kind));
      zOf = (id) => (table.get(laid.nodes.find((n) => n.id === id)?.kind) ?? 0) * GLYPH_DIAGRAM_3D_LAYER_HEIGHT;
    } else if (zBy === "rank") {
      // The layered X/Y plane already carries dagre's own rank order along one
      // axis (Y for TB/BT, X for LR/RL) — bucket by that axis's rounded center
      // rather than re-deriving ranks from dagre internals a second time.
      const rankAxis = effectiveDirection === "LR" || effectiveDirection === "RL" ? 0 : 1;
      const centers = laid.nodes.map((n) => Math.round(rankAxis === 0 ? (n.x0 + n.x1) / 2 : (n.y0 + n.y1) / 2));
      const ranks = [...new Set(centers)].sort((a, b) => a - b);
      const rankIndex = new Map(ranks.map((r, i) => [r, i]));
      zOf = (id) => {
        const node = laid.nodes.find((n) => n.id === id)!;
        const c = Math.round(rankAxis === 0 ? (node.x0 + node.x1) / 2 : (node.y0 + node.y1) / 2);
        return (rankIndex.get(c) ?? 0) * GLYPH_DIAGRAM_3D_LAYER_HEIGHT;
      };
    } else {
      const table = floorIndexTable(laid.nodes.map((n) => smallestContainingGroup(n.id, laid.groups)));
      zOf = (id) => (table.get(smallestContainingGroup(id, laid.groups)) ?? 0) * GLYPH_DIAGRAM_3D_LAYER_HEIGHT;
    }
  }

  const graphNodesById = new Map(graph.nodes.map((gn) => [gn.id, gn]));
  const compressedSizes = compressExplicitSizes(graph.nodes);
  // D2 round 4: `flowAxis` picks which WORLD axis a node's own FLOW-order
  // position is packed along, using its REAL half-extent plus a
  // size-PROPORTIONAL gap (`GLYPH_DIAGRAM_3D_FLOW_GAP_FACTOR`) instead of
  // dagre's own guess — this now runs UNCONDITIONALLY (round 3 gated it
  // behind "any node has a custom `size`"; a DEFAULT-sized graph needs the
  // same proportional-gap discipline just as much, or its own gaps stay
  // dagre's flat `nodesep`/`ranksep`, "many object widths" apart): `0` (X)
  // for LR/RL, `2` (Z) for TB/BT when `useRankZFlow` engaged above, `1` (Y,
  // dagre's own untouched rank axis) for a GROUPED or explicitly-`zBy`'d
  // TB/BT graph, where Z already carries the semantic floor and re-walking
  // Y too would fight it.
  const flowAxis: 0 | 1 | 2 = effectiveDirection === "LR" || effectiveDirection === "RL" ? 0 : useRankZFlow ? 2 : 1;
  const sizeComponentForFlowAxis = flowAxis === 0 ? 0 : flowAxis === 2 ? 1 : 2; // resolveNodeSize's own [width, height, depth]
  const flowOverride = new Map<string, number>();
  {
    const ordered = [...laid.nodes].sort((a, b) => {
      // The ORDER always comes from dagre's own rank axis (X for LR/RL, Y
      // for TB/BT) regardless of which WORLD axis the override finally
      // writes to — a Z-flow still walks nodes in RANK order, it just
      // ignores dagre's own Y VALUE once that order is known.
      const orderAxisIsX = effectiveDirection === "LR" || effectiveDirection === "RL";
      const ca = orderAxisIsX ? (a.x0 + a.x1) / 2 : (a.y0 + a.y1) / 2;
      const cb = orderAxisIsX ? (b.x0 + b.x1) / 2 : (b.y0 + b.y1) / 2;
      return ca - cb;
    });
    let cursor = 0, prevHalf = 0;
    ordered.forEach((n, i) => {
      const labelWidthCells = n.x1 - n.x0 + 1;
      const size = resolveNodeSize(graphNodesById.get(n.id), labelWidthCells, compressedSizes.get(n.id));
      const half = size[sizeComponentForFlowAxis] / 2;
      const gap = i === 0 ? 0 : Math.max(GLYPH_DIAGRAM_3D_FLOW_GAP_MIN, GLYPH_DIAGRAM_3D_FLOW_GAP_FACTOR * (prevHalf + half));
      cursor = i === 0 ? half : cursor + prevHalf + gap + half;
      flowOverride.set(n.id, cursor);
      prevHalf = half;
    });
  }

  const nodes: GlyphDiagram3dNode[] = laid.nodes.map((n) => {
    const labelWidthCells = n.x1 - n.x0 + 1;
    const [width, height, depth] = resolveNodeSize(graphNodesById.get(n.id), labelWidthCells, compressedSizes.get(n.id));
    const dagreX = (n.x0 + n.x1) / 2, dagreY = (n.y0 + n.y1) / 2;
    const flowOverrideValue = flowOverride.get(n.id)!;
    const cx = flowAxis === 0 ? flowOverrideValue : dagreX;
    // Z-flow abandons dagre's own Y (rank) value entirely — Z now carries
    // the rank progression, so every node sits at the SAME depth (a single
    // front-facing plane of boxes), matching "a vertical stack of wide
    // slabs" rather than spreading them front-to-back too.
    const cy = flowAxis === 2 ? 0 : dagreY;
    const cz = flowAxis === 2 ? flowOverrideValue : zOf(n.id) + height / 2;
    return {
      id: n.id, label: n.lines.join("\n"), shape: n.shape ?? "rect", kind: n.kind, group: n.group,
      degree: degree.get(n.id) ?? 0,
      center: [cx, cy, cz],
      half: [width / 2, depth / 2, height / 2],
    };
  });
  const byId = new Map(nodes.map((n) => [n.id, n]));

  const edges: GlyphDiagram3dEdge[] = laid.edges.map((e) => {
    const from = byId.get(e.from)!, to = byId.get(e.to)!;
    const fromSphere = from.shape === "circle", toSphere = to.shape === "circle";
    if (e.from === e.to) {
      return { id: e.id, from: e.from, to: e.to, label: e.label, style: e.style ?? "solid", priority: e.priority ?? 0, points: selfLoopPoints(from.center, from.half, fromSphere) };
    }
    const sameFloor = from.center[2] === to.center[2];
    if (sameFloor) {
      const points = orthogonalPlanePoints(from.center, from.half, fromSphere, to.center, to.half, toSphere, from.center[2]);
      return { id: e.id, from: e.from, to: e.to, label: e.label, style: e.style ?? "solid", priority: e.priority ?? 0, points };
    }
    // A cross-floor edge is an orthogonal 3D polyline: run at the source's
    // own floor to the XY midpoint, step Z there (the "rank gap"), then run
    // at the target's own floor into its face.
    const midXY: [number, number] = [(from.center[0] + to.center[0]) / 2, (from.center[1] + to.center[1]) / 2];
    const p0 = nodeSurfaceAnchor(from.center, from.half, fromSphere, [midXY[0], midXY[1], from.center[2]]);
    const p1: Vec3 = [midXY[0], midXY[1], from.center[2]];
    const p2: Vec3 = [midXY[0], midXY[1], to.center[2]];
    const p3 = nodeSurfaceAnchor(to.center, to.half, toSphere, [midXY[0], midXY[1], to.center[2]]);
    return { id: e.id, from: e.from, to: e.to, label: e.label, style: e.style ?? "solid", priority: e.priority ?? 0, points: [p0, p1, p2, p3] };
  });

  const groups: GlyphDiagram3dGroup[] = laid.groups.map((g) => {
    const members = g.members.map((id) => byId.get(id)).filter((n): n is GlyphDiagram3dNode => !!n);
    if (members.length === 0) return { id: g.id, label: g.label, z: 0, min: [0, 0, 0], max: [0, 0, 0] };
    const z = members.reduce((sum, m) => sum + m.center[2], 0) / members.length - GLYPH_DIAGRAM_3D_NODE_HEIGHT / 2;
    const minX = Math.min(...members.map((m) => m.center[0] - m.half[0])) - GLYPH_DIAGRAM_3D_GROUP_PAD;
    const maxX = Math.max(...members.map((m) => m.center[0] + m.half[0])) + GLYPH_DIAGRAM_3D_GROUP_PAD;
    const minY = Math.min(...members.map((m) => m.center[1] - m.half[1])) - GLYPH_DIAGRAM_3D_GROUP_PAD;
    const maxY = Math.max(...members.map((m) => m.center[1] + m.half[1])) + GLYPH_DIAGRAM_3D_GROUP_PAD;
    return { id: g.id, label: g.label, z, min: [minX, minY, z], max: [maxX, maxY, z] };
  });

  return { nodes, edges, groups };
}

async function layoutForce(graph: GlyphGraph, options: GlyphDiagram3dLayoutOptions): Promise<GlyphDiagram3dLayout> {
  const seed = options.seed ?? 1;
  const iterations = options.iterations ?? 300;
  if (!Number.isInteger(seed)) glyphDiagramError("bad-options", "layout3d: seed must be an integer.");
  if (!Number.isInteger(iterations) || iterations < 1) glyphDiagramError("bad-options", "layout3d: iterations must be a positive integer.");

  const measured = measureGlyphGraph(graph, { labelWidth: options.labelWidth, direction: options.direction });
  const rand = mulberry32(seed);
  const n = measured.nodes.length;
  const degree = new Map<string, number>();
  for (const edge of measured.edges) {
    degree.set(edge.from, (degree.get(edge.from) ?? 0) + 1);
    degree.set(edge.to, (degree.get(edge.to) ?? 0) + 1);
  }

  // Ideal edge length from the average node footprint — the classical
  // Fruchterman-Reingold `k`, generalized to 3D volume instead of 2D area.
  const avgFootprint = measured.nodes.reduce((s, m) => s + Math.max(m.width, m.height), 0) / Math.max(1, n);
  const k = Math.max(4, avgFootprint * 1.5);
  const spread = k * Math.cbrt(n + 1);

  const pos: Vec3[] = measured.nodes.map(() => [
    (rand() - 0.5) * spread, (rand() - 0.5) * spread, (rand() - 0.5) * spread,
  ]);
  const idIndex = new Map(measured.nodes.map((m, i) => [m.id, i]));
  const EPS = 1e-6;

  let temperature = spread / 8;
  const cooling = Math.pow(0.01, 1 / iterations);
  for (let iter = 0; iter < iterations; iter++) {
    const disp: Vec3[] = pos.map(() => [0, 0, 0]);
    // Repulsion — every pair.
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const dx = pos[i]![0] - pos[j]![0], dy = pos[i]![1] - pos[j]![1], dz = pos[i]![2] - pos[j]![2];
        const dist = Math.max(EPS, Math.hypot(dx, dy, dz));
        const force = (k * k) / dist;
        const ux = dx / dist, uy = dy / dist, uz = dz / dist;
        disp[i]![0] += ux * force; disp[i]![1] += uy * force; disp[i]![2] += uz * force;
        disp[j]![0] -= ux * force; disp[j]![1] -= uy * force; disp[j]![2] -= uz * force;
      }
    }
    // Attraction — springs along edges.
    for (const edge of measured.edges) {
      const i = idIndex.get(edge.from)!, j = idIndex.get(edge.to)!;
      const dx = pos[i]![0] - pos[j]![0], dy = pos[i]![1] - pos[j]![1], dz = pos[i]![2] - pos[j]![2];
      const dist = Math.max(EPS, Math.hypot(dx, dy, dz));
      const force = (dist * dist) / k;
      const ux = dx / dist, uy = dy / dist, uz = dz / dist;
      disp[i]![0] -= ux * force; disp[i]![1] -= uy * force; disp[i]![2] -= uz * force;
      disp[j]![0] += ux * force; disp[j]![1] += uy * force; disp[j]![2] += uz * force;
    }
    // Group attraction — every member is pulled toward its group's own centroid.
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
    for (let i = 0; i < n; i++) {
      const dist = Math.max(EPS, Math.hypot(disp[i]![0], disp[i]![1], disp[i]![2]));
      const limited = Math.min(dist, temperature);
      pos[i]![0] += (disp[i]![0] / dist) * limited;
      pos[i]![1] += (disp[i]![1] / dist) * limited;
      pos[i]![2] += (disp[i]![2] / dist) * limited;
    }
    temperature *= cooling;
  }

  const forceGraphNodesById = new Map(graph.nodes.map((gn) => [gn.id, gn]));
  const forceCompressedSizes = compressExplicitSizes(graph.nodes);
  const nodes: GlyphDiagram3dNode[] = measured.nodes.map((m, i) => {
    const [width, height, depth] = resolveNodeSize(forceGraphNodesById.get(m.id), Math.max(1, m.width), forceCompressedSizes.get(m.id));
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
    if (members.length === 0) return { id: g.id, label: g.label, z: 0, min: [0, 0, 0], max: [0, 0, 0] };
    const minX = Math.min(...members.map((m) => m.center[0] - m.half[0])) - GLYPH_DIAGRAM_3D_GROUP_PAD;
    const maxX = Math.max(...members.map((m) => m.center[0] + m.half[0])) + GLYPH_DIAGRAM_3D_GROUP_PAD;
    const minY = Math.min(...members.map((m) => m.center[1] - m.half[1])) - GLYPH_DIAGRAM_3D_GROUP_PAD;
    const maxY = Math.max(...members.map((m) => m.center[1] + m.half[1])) + GLYPH_DIAGRAM_3D_GROUP_PAD;
    const minZ = Math.min(...members.map((m) => m.center[2] - m.half[2])) - GLYPH_DIAGRAM_3D_GROUP_PAD;
    const maxZ = Math.max(...members.map((m) => m.center[2] + m.half[2])) + GLYPH_DIAGRAM_3D_GROUP_PAD;
    return { id: g.id, label: g.label, z: (minZ + maxZ) / 2, min: [minX, minY, minZ], max: [maxX, maxY, maxZ] };
  });

  return { nodes, edges, groups };
}

export async function layout3d(graph: GlyphGraph, options: GlyphDiagram3dLayoutOptions = {}): Promise<GlyphDiagram3dLayout> {
  const kind = options.layout ?? "layered";
  if (kind === "force") return layoutForce(graph, options);
  if (kind === "layered") return layoutLayered(graph, options);
  glyphDiagramError("bad-options", 'layout3d: layout must be "layered" or "force".');
}
