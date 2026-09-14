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
import type { GlyphGraph, GlyphGraphDirection, GlyphGraphEdgeStyle, GlyphGraphNodeShape } from "../types";
import { measureGlyphGraph, layoutGlyphGraph, type GlyphDiagramLayoutOptions } from "../pipeline";
import { glyphDiagramError } from "../validate";
import type { Vec3 } from "glyphcss";

/** World units between two adjacent Z floors (`zBy` groups/kinds/ranks). */
export const GLYPH_DIAGRAM_3D_LAYER_HEIGHT = 3;
/** A node box's fixed thickness along world Z (up) — comfortably under `GLYPH_DIAGRAM_3D_LAYER_HEIGHT` so a floor's nodes never reach the next one. */
export const GLYPH_DIAGRAM_3D_NODE_HEIGHT = 1;
/** Padding (world units, = cells for a layered layout) added around a group's member footprint before it becomes a floor plate / wireframe volume. */
export const GLYPH_DIAGRAM_3D_GROUP_PAD = 2;

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
  const zBy = options.zBy ?? "group";
  const laid = await layoutGlyphGraph(graph, {
    direction: options.direction, nodesep: options.nodesep, ranksep: options.ranksep, labelWidth: options.labelWidth,
  });
  const degree = new Map<string, number>();
  for (const edge of laid.edges) {
    degree.set(edge.from, (degree.get(edge.from) ?? 0) + 1);
    degree.set(edge.to, (degree.get(edge.to) ?? 0) + 1);
  }

  let zOf: (nodeId: string) => number;
  if (zBy === "none") {
    zOf = () => 0;
  } else if (zBy === "kind") {
    const table = floorIndexTable(laid.nodes.map((n) => n.kind));
    zOf = (id) => (table.get(laid.nodes.find((n) => n.id === id)?.kind) ?? 0) * GLYPH_DIAGRAM_3D_LAYER_HEIGHT;
  } else if (zBy === "rank") {
    // The layered X/Y plane already carries dagre's own rank order along one
    // axis (Y for TB/BT, X for LR/RL) — bucket by that axis's rounded center
    // rather than re-deriving ranks from dagre internals a second time.
    const rankAxis = options.direction === "LR" || options.direction === "RL" ? 0 : 1;
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

  const nodes: GlyphDiagram3dNode[] = laid.nodes.map((n) => {
    const z = zOf(n.id);
    const halfX = (n.x1 - n.x0 + 1) / 2;
    const halfY = (n.y1 - n.y0 + 1) / 2;
    return {
      id: n.id, label: n.lines.join("\n"), shape: n.shape ?? "rect", kind: n.kind, group: n.group,
      degree: degree.get(n.id) ?? 0,
      center: [(n.x0 + n.x1) / 2, (n.y0 + n.y1) / 2, z + GLYPH_DIAGRAM_3D_NODE_HEIGHT / 2],
      half: [halfX, halfY, GLYPH_DIAGRAM_3D_NODE_HEIGHT / 2],
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
      const p0 = nodeSurfaceAnchor(from.center, from.half, fromSphere, to.center);
      const p1 = nodeSurfaceAnchor(to.center, to.half, toSphere, from.center);
      return { id: e.id, from: e.from, to: e.to, label: e.label, style: e.style ?? "solid", priority: e.priority ?? 0, points: [p0, p1] };
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

  const nodes: GlyphDiagram3dNode[] = measured.nodes.map((m, i) => ({
    id: m.id, label: m.lines.join("\n"), shape: m.shape ?? "rect", kind: m.kind, group: m.group,
    degree: degree.get(m.id) ?? 0,
    center: pos[i]!,
    half: [Math.max(1, m.width / 2), Math.max(1, m.height / 2), GLYPH_DIAGRAM_3D_NODE_HEIGHT / 2],
  }));
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
