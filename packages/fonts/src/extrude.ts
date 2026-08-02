/**
 * Shared 2D→3D extrusion used by both `textPolygons` (single line) and
 * `composeText` (multiline / rich / WordArt). Callers place glyph and
 * decoration contours into a flat "type plane" (x → right, y → up, in world
 * units) and hand them here as pre-grouped shapes; this turns each shape into
 * front/back caps + side walls following the chosen depth profile.
 *
 * Type plane → glyphcss world: glyphcss maps world X → screen-down,
 * world Y → screen-right, world Z → toward the viewer. So world Y = plane x,
 * world X = -plane y (screen-up), and depth runs along world Z. That single
 * y-negation is a reflection, so it flips winding — every emitted polygon is
 * wound in reverse to stay outward-facing (glyphcss hides back-faces).
 */
import earcut from "earcut";
import type { Polygon, Vec2, Vec3 } from "@glyphcss/core";

export type Pt = [number, number];
export type Contour = Pt[];

/**
 * Cross-section of the extrusion along its depth:
 * - "flat"   — straight slab with vertical walls (a depth-only extrude).
 * - "round"  — a quarter-circle round-over on the front/back edges (bullnose).
 * - "bevel"  — a straight 45° chamfer on the front/back edges.
 * - "custom" — the edge profile is the CSS easing curve `profileBezier`
 *   (`cubic-bezier(x1,y1,x2,y2)` semantics), sampled along the depth.
 */
export type ExtrudeProfile = "flat" | "round" | "bevel" | "custom";

/** CSS cubic-bezier control points [x1, y1, x2, y2] (P0=(0,0), P3=(1,1)). */
export type CubicBezier = [number, number, number, number];

/**
 * CSS `cubic-bezier(x1,y1,x2,y2)` easing → a function mapping x∈[0,1] to y.
 * Solves x(t)=x by Newton's method (same approach browsers use), then reads y.
 */
export function cssCubicBezier([x1, y1, x2, y2]: CubicBezier): (x: number) => number {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const sampleX = (t: number) => ((ax * t + bx) * t + cx) * t;
  const sampleY = (t: number) => ((ay * t + by) * t + cy) * t;
  const slopeX = (t: number) => (3 * ax * t + 2 * bx) * t + cx;
  return (x: number) => {
    const xc = Math.min(1, Math.max(0, x));
    let t = xc;
    for (let i = 0; i < 8; i++) {
      const err = sampleX(t) - xc;
      if (Math.abs(err) < 1e-6) break;
      const d = slopeX(t);
      if (Math.abs(d) < 1e-6) break;
      t -= err / d;
    }
    return sampleY(Math.min(1, Math.max(0, t)));
  };
}

export interface Shape {
  outer: Contour;
  holes: Contour[];
}

/**
 * A material stop on the axial (depth) axis: `at` runs 0 (front face) → 1 (back
 * face). Each emitted polygon is colored/textured by the nearest stop to its
 * own depth, so any number of stops can band the solid down its length.
 */
export interface MaterialStop {
  at: number;
  /** Solid color (and fallback if a texture fails to load). */
  color?: string;
  /** Texture URL / data URL — UV-mapped across the word (caps & stretch walls). */
  texture?: string;
  /** Tile the texture every N world units (block look) instead of stretching. */
  tile?: number;
}

export interface ExtrudeOptions {
  depth: number;
  profile: ExtrudeProfile;
  profileSegments: number;
  /** Round only: flip the arc to a raised/convex bullnose (default concave). */
  roundConvex?: boolean;
  /**
   * Custom edge profile (profile === "custom"): a CSS cubic-bezier easing whose
   * curve is the edge cross-section, sampled over `profileSegments`.
   */
  profileBezier?: CubicBezier;
  /** Cap on inward edge inset (keeps round/bevel from pinching thin stems). */
  maxInset: number;
  /** Material stops down the depth axis (≥1). Each polygon takes the nearest. */
  stops: MaterialStop[];
  /** Type-plane bounds the face UVs normalize against (the whole word). */
  faceUvBounds?: { minX: number; minY: number; maxX: number; maxY: number };
  /** Outline stroke color, drawn as a halo just behind the front face. */
  outlineColor?: string;
  /** Outline stroke width in world units (only used with `outlineColor`). */
  outlineWidth?: number;
  /** [rightward, upward] in-plane shift of the back cap — the flat drop shadow. */
  backOffset?: [number, number];
  /** Depth offset applied to the whole shape (for layered/offset effects). */
  zOffset?: number;
  /**
   * Flat two-layer mode: emit only the front cap + an offset back cap, with no
   * connecting side walls — the classic WordArt "two flat meshes" drop shadow.
   */
  layered?: boolean;
}

interface Ring {
  z: number;
  inset: number;
}

const turn = (o: Pt, a: Pt, b: Pt): number =>
  (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

/** A simple polygon (no repeated vertices) whose turns never change sign. */
function isConvexLoop(loop: number[], vert: (i: number) => Pt): boolean {
  const n = loop.length;
  if (n < 3) return false;
  if (new Set(loop).size !== n) return false; // self-touching → not simple
  let sign = 0;
  for (let i = 0; i < n; i++) {
    const c = turn(vert(loop[i]), vert(loop[(i + 1) % n]), vert(loop[(i + 2) % n]));
    if (Math.abs(c) < 1e-9) continue; // collinear vertex — ignore
    const s = c > 0 ? 1 : -1;
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}

/**
 * Glue two index loops (same orientation) along their shared edge `a–b`,
 * returning the combined boundary in that same orientation, or null if the
 * edge isn't a clean P→Q / Q→P pair.
 */
function gluedLoop(P: number[], Q: number[], a: number, b: number): number[] | null {
  const dirIn = (loop: number[]): [number, number] | null => {
    const ia = loop.indexOf(a);
    if (ia < 0) return null;
    if (loop[(ia + 1) % loop.length] === b) return [a, b];
    const ib = loop.indexOf(b);
    if (ib >= 0 && loop[(ib + 1) % loop.length] === a) return [b, a];
    return null;
  };
  const dp = dirIn(P);
  const dq = dirIn(Q);
  if (!dp || !dq || dp[0] === dq[0]) return null; // must be opposite directions
  const [x, y] = dp; // P goes x→y along the shared edge
  const walk = (loop: number[], from: number, to: number): number[] => {
    const r: number[] = [];
    let i = loop.indexOf(from);
    for (let c = 0; c < loop.length; c++) {
      r.push(loop[i]);
      if (loop[i] === to) break;
      i = (i + 1) % loop.length;
    }
    return r;
  };
  const loop = walk(P, y, x).concat(walk(Q, x, y).slice(1, -1));
  return loop.length >= 3 ? loop : null;
}

/**
 * Greedily merge an earcut triangle list into maximal convex polygons (a
 * Hertel–Mehlmann-style partition). Each emitted loop keeps earcut's traversal
 * order, so the cap can wind front/back exactly as it did per-triangle. The
 * silhouette and holes are unchanged — this only erases interior diagonals,
 * cutting DOM-leaf count and the coplanar same-color seams between them.
 */
function convexPartition(flat: number[], tris: number[]): number[][] {
  const vert = (i: number): Pt => [flat[i * 2], flat[i * 2 + 1]];
  const polys: (number[] | null)[] = [];
  for (let t = 0; t < tris.length; t += 3) polys.push([tris[t], tris[t + 1], tris[t + 2]]);

  // Grow convex regions by absorbing neighbors a triangle at a time (a region
  // that swallows a triangle is likelier to stay convex than two quads glued
  // together). Each pass lets a region keep eating along its boundary; passes
  // repeat until one settles. Edge keys are numeric (a*stride+b) to keep the
  // per-pass rebuild cheap.
  const stride = flat.length / 2 + 1;
  let changed = true;
  while (changed) {
    changed = false;
    const edge = new Map<number, number[]>();
    for (let pi = 0; pi < polys.length; pi++) {
      const p = polys[pi];
      if (!p) continue;
      for (let i = 0; i < p.length; i++) {
        const a = p[i], b = p[(i + 1) % p.length];
        const k = a < b ? a * stride + b : b * stride + a;
        let l = edge.get(k);
        if (!l) edge.set(k, (l = []));
        l.push(pi);
      }
    }
    for (const [k, list] of edge) {
      if (list.length !== 2) continue;
      const [pi, pj] = list;
      // polys[pi] may have grown earlier in this pass; re-read both and re-check
      // that the recorded edge is still on each boundary (gluedLoop returns null
      // if the region already absorbed past it).
      const P = polys[pi], Q = polys[pj];
      if (!P || !Q) continue;
      const a = Math.floor(k / stride), b = k % stride;
      const merged = gluedLoop(P, Q, a, b);
      if (merged && isConvexLoop(merged, vert)) {
        polys[pi] = merged;
        polys[pj] = null;
        changed = true;
      }
    }
  }
  return polys.filter((p): p is number[] => p !== null);
}

const toWorld = (p: Pt, z: number): Vec3 => [-p[1], p[0], z];

/** Extrude pre-grouped 2D shapes (type-plane, world units) into polygons. */
export function extrudeContours(shapes: Shape[], opts: ExtrudeOptions): Polygon[] {
  const { profile, profileSegments, maxInset } = opts;
  const layered = opts.layered ?? false;
  const zCenter = opts.zOffset ?? 0;
  // Layered mode forces a minimum front/back separation so the offset shadow
  // sits behind the face even when depth is ~0.
  const depth = layered ? Math.max(opts.depth, 1) : opts.depth;
  const frontZ = zCenter + depth / 2;
  const backZ = zCenter - depth / 2;
  const rings = buildRings(profile, frontZ, backZ, depth, profileSegments, maxInset, opts.roundConvex ?? false, opts.profileBezier);
  const polygons: Polygon[] = [];

  const ZERO: Pt = [0, 0];
  const backOffset = opts.backOffset ?? ZERO;
  const place = (p: Pt, z: number, o: Pt): Vec3 => toWorld([p[0] + o[0], p[1] + o[1]], z);

  // Face UV: normalize a type-plane point to the whole-word bounds (v=0 bottom,
  // OBJ convention — matches glyphcss UV expectations).
  const fb = opts.faceUvBounds;
  const faceW = fb ? Math.max(fb.maxX - fb.minX, 1e-6) : 1;
  const faceH = fb ? Math.max(fb.maxY - fb.minY, 1e-6) : 1;
  // tile > 0 → repeat the texture every `tile` world units (crisp block look);
  // tile === 0 → stretch one copy across the whole word (gradient / photo).
  const uvAt = (p: Pt, tile: number): Vec2 => tile > 0
    ? [(p[0] - fb!.minX) / tile, (p[1] - fb!.minY) / tile]
    : [Math.min(1, Math.max(0, (p[0] - fb!.minX) / faceW)), Math.min(1, Math.max(0, (p[1] - fb!.minY) / faceH))];
  const REPEAT = { s: "repeat", t: "repeat" } as const;
  const outlineWidth = opts.outlineColor ? Math.max(0, opts.outlineWidth ?? 0) : 0;

  // Material by axial position t (0 = front face, 1 = back face): nearest stop.
  const stops = opts.stops.length ? [...opts.stops].sort((a, b) => a.at - b.at) : [{ at: 0.5 }];
  const materialAt = (t: number): MaterialStop => {
    let best = stops[0];
    let bestD = Infinity;
    // `<=` so a tie (a band exactly on a boundary, e.g. the single flat wall at
    // t=0.5 between two even stops) resolves toward the deeper stop — the wall
    // takes the side/back rather than the front.
    for (const s of stops) {
      const d = Math.abs(s.at - t);
      if (d <= bestD) { bestD = d; best = s; }
    }
    return best;
  };
  const tOf = (z: number) => (depth > 0 ? Math.min(1, Math.max(0, (frontZ - z) / depth)) : 0);

  const maxRingInset = rings.reduce((m, r) => Math.max(m, r.inset), 0);

  for (const shape of shapes) {
    const contours = [shape.outer, ...shape.holes];

    // Clamp the round/bevel inset to this glyph's thinnest feature so the offset
    // can't cross itself (the hairline strokes of high-contrast display faces
    // like Abril Fatface are thinner than a fixed inset would survive).
    const insetScale = maxRingInset > 1e-6
      ? Math.min(1, safeInset(contours, maxRingInset) / maxRingInset)
      : 1;
    const si = (inset: number) => inset * insetScale;

    // Emit a flat cap of `contours` at depth `z`, shifted in-plane by `o`,
    // painted with `mat` (UV-mapped to the word when it carries a texture).
    const cap = (offset: number, z: number, o: Pt, flip: boolean, mat: MaterialStop) => {
      const flat: number[] = [];
      const holeIndices: number[] = [];
      for (let r = 0; r < contours.length; r++) {
        if (r > 0) holeIndices.push(flat.length / 2);
        for (const [x, y] of offsetContour(contours[r], offset)) flat.push(x, y);
      }
      const tris = earcut(flat, holeIndices, 2);
      const vert = (i: number): Pt => [flat[i * 2], flat[i * 2 + 1]];
      const tile = mat.tile ?? 0;
      // earcut order winds the front cap; the back cap is its reverse. A merged
      // convex loop keeps that order, so the same flip rule winds N-gons.
      for (const loop of convexPartition(flat, tris)) {
        const order = flip ? loop.slice().reverse() : loop;
        const pts = order.map(vert);
        const poly: Polygon = {
          vertices: pts.map((p) => place(p, z, o)),
          color: mat.color ?? "#cccccc",
        };
        // Cap UVs are authored unconditionally (not just when textured), planar
        // in the glyph's own type-plane bounds — stable under mesh rotation,
        // since this coordinate is computed before the mesh's `rotation` is
        // applied. This is what lets surface-locked effects (`space: "auto"`)
        // resolve authored UVs on solid-colour text instead of falling back to
        // the generated world-surface basis, which is anchored to world space
        // and slides under the geometry as the mesh turns.
        if (fb) poly.uvs = pts.map((p) => uvAt(p, tile));
        if (mat.texture && fb) {
          // Inline `texture` (not just `material`) so the mesh atlas planner —
          // which reads polygon.texture — UV-maps the shared fill across the word.
          poly.texture = mat.texture;
          poly.material = { texture: mat.texture };
          if (tile > 0) poly.textureWrap = REPEAT;
        }
        polygons.push(poly);
      }
    };

    // Outline halo: a larger silhouette in the outline color sitting just behind
    // the front face, so it peeks out around every outer and counter edge.
    if (outlineWidth > 0) {
      cap(-outlineWidth, frontZ - 1e-3, ZERO, false, { at: 0, color: opts.outlineColor });
    }

    // Front + back caps (material at the two ends of the axis).
    cap(si(rings[0].inset), rings[0].z, ZERO, false, materialAt(0));
    if (layered) {
      // Flat two-layer shadow: offset back cap, no connecting walls.
      cap(si(rings[rings.length - 1].inset), backZ, backOffset, true, materialAt(1));
      continue;
    }
    cap(si(rings[rings.length - 1].inset), rings[rings.length - 1].z, ZERO, true, materialAt(1));

    for (const contour of contours) {
      // Wall strip UV: u = fractional arc-length position around this contour
      // (0..1, wrapping at the seam), v = fractional depth (0 front → 1 back,
      // via the same `tOf` axis the material bands use). This is a genuinely
      // depth-aware parameterization — unlike the planar cap mapping, whose
      // (x, y) barely changes between the front and back ring on a "flat"
      // profile (near-zero inset), which would leave a surface-locked effect
      // with no usable depth axis on the walls. Computed once per contour
      // (not per ring) since ring offsets only inset the contour, they don't
      // change vertex correspondence or perimeter topology.
      const arcFrac = arcLengthFractions(contour);
      let prevOffset = offsetContour(contour, si(rings[0].inset));
      for (let r = 1; r < rings.length; r++) {
        const curOffset = offsetContour(contour, si(rings[r].inset));
        const z0 = rings[r - 1].z;
        const z1 = rings[r].z;
        const mat = materialAt(tOf((z0 + z1) / 2));
        const tile = mat.tile ?? 0;
        const v0 = tOf(z0);
        const v1 = tOf(z1);
        for (let i = 0, len = contour.length; i < len; i++) {
          const j = (i + 1) % len;
          const wall: Polygon = {
            vertices: [
              place(curOffset[i], z1, ZERO),
              place(curOffset[j], z1, ZERO),
              place(prevOffset[j], z0, ZERO),
              place(prevOffset[i], z0, ZERO),
            ],
            color: mat.color ?? "#cccccc",
            uvs: [
              [arcFrac[i], v1],
              [arcFrac[j], v1],
              [arcFrac[j], v0],
              [arcFrac[i], v0],
            ],
          };
          if (mat.texture) {
            wall.texture = mat.texture;
            wall.material = { texture: mat.texture };
            if (tile > 0 || !fb) {
              // Block texture: one full tile per wall quad (voxel edge).
              wall.uvs = [[0, 1], [1, 1], [1, 0], [0, 0]];
            } else {
              // Stretch texture: UV-map the band to the word so it wraps the edge.
              wall.uvs = [
                uvAt(curOffset[i], 0),
                uvAt(curOffset[j], 0),
                uvAt(prevOffset[j], 0),
                uvAt(prevOffset[i], 0),
              ];
            }
          }
          polygons.push(wall);
        }
        prevOffset = curOffset;
      }
    }
  }

  return polygons;
}

function buildRings(
  profile: ExtrudeProfile,
  frontZ: number,
  backZ: number,
  depth: number,
  seg: number,
  maxInset: number,
  roundConvex: boolean,
  profileBezier?: CubicBezier,
): Ring[] {
  if (profile === "flat" || depth <= 0) {
    return [{ z: frontZ, inset: 0 }, { z: backZ, inset: 0 }];
  }
  const edge = Math.min(maxInset, depth / 2);
  const s = profile === "bevel" ? 1 : Math.max(2, seg);
  // `insetFrac(u)` is the inset (0..1 of `edge`) at depth fraction u into the
  // edge (u=0 at the face → 1 at the full-size shoulder). bevel = straight
  // ramp; round = quarter arc (concave, or convex when raised); custom = the
  // CSS cubic-bezier easing curve as the cross-section.
  const insetFrac = profile === "bevel"
    ? (u: number) => 1 - u
    : profile === "custom" && profileBezier
      ? ((b) => (u: number) => 1 - b(u))(cssCubicBezier(profileBezier))
      : roundConvex
        ? (u: number) => 1 - Math.sin((u * Math.PI) / 2)
        : (u: number) => Math.cos((u * Math.PI) / 2);

  const rings: Ring[] = [];
  for (let k = 0; k <= s; k++) {
    const u = k / s;
    rings.push({ z: frontZ - u * edge, inset: edge * insetFrac(u) });
  }
  if (backZ + edge < frontZ - edge - 1e-6) {
    rings.push({ z: backZ + edge, inset: 0 });
  }
  for (let k = 1; k <= s; k++) {
    const u = 1 - k / s;
    rings.push({ z: backZ + edge * u, inset: edge * insetFrac(u) });
  }
  return rings;
}

/**
 * Largest inset that's safe for this glyph: ~40% of the smallest gap between
 * any two non-adjacent contour vertices (across the outer + holes). That gap is
 * roughly the thinnest stroke / counter wall, so insetting less than half of it
 * keeps the offset outer and hole edges from crossing.
 */
function safeInset(contours: Contour[], desired: number): number {
  // Sample each contour at its vertices AND edge midpoints, so a thin stroke
  // between two long edges is found even when the glyph was flattened coarsely
  // (curve=1). `e` is a fractional edge index used to skip same/adjacent edges.
  const pts: { x: number; y: number; c: number; e: number; n: number }[] = [];
  contours.forEach((cont, ci) => {
    const n = cont.length;
    for (let i = 0; i < n; i++) {
      const a = cont[i];
      const b = cont[(i + 1) % n];
      pts.push({ x: a[0], y: a[1], c: ci, e: i, n });
      pts.push({ x: (a[0] + b[0]) / 2, y: (a[1] + b[1]) / 2, c: ci, e: i + 0.5, n });
    }
  });
  let minSq = Infinity;
  for (let a = 0; a < pts.length; a++) {
    for (let b = a + 1; b < pts.length; b++) {
      if (pts[a].c === pts[b].c) {
        const d = Math.abs(pts[a].e - pts[b].e);
        if (d <= 1.5 || d >= pts[a].n - 1.5) continue; // skip same/adjacent edges
      }
      const dx = pts[a].x - pts[b].x;
      const dy = pts[a].y - pts[b].y;
      const sq = dx * dx + dy * dy;
      if (sq < minSq) minSq = sq;
    }
  }
  return Math.min(desired, Math.sqrt(minSq) * 0.4);
}

/**
 * Cumulative perimeter fraction at each vertex of a closed contour (0 at
 * vertex 0, increasing monotonically, wrapping back toward 1 at the seam).
 * Used as the wall strip's `u` axis — continuous around the glyph outline,
 * independent of the ring's inward offset.
 */
function arcLengthFractions(c: Contour): number[] {
  const n = c.length;
  const cum = new Array<number>(n).fill(0);
  let total = 0;
  for (let i = 0; i < n; i++) {
    cum[i] = total;
    const next = c[(i + 1) % n];
    total += Math.hypot(next[0] - c[i][0], next[1] - c[i][1]);
  }
  if (total < 1e-9) return cum.map(() => 0);
  return cum.map((d) => d / total);
}

function leftNormal(a: Pt, b: Pt): Pt {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy) || 1;
  return [-dy / len, dx / len];
}

/**
 * Miter-offset a contour inward by `dist` (clamped miter so sharp corners
 * don't spike). Positive `dist` shrinks a CCW outer ring and grows a CW hole.
 */
export function offsetContour(c: Contour, dist: number): Contour {
  if (dist === 0) return c;
  const n = c.length;
  const out: Contour = new Array(n);
  for (let i = 0; i < n; i++) {
    const prev = c[(i - 1 + n) % n];
    const cur = c[i];
    const next = c[(i + 1) % n];
    const n1 = leftNormal(prev, cur);
    const n2 = leftNormal(cur, next);
    let mx = n1[0] + n2[0];
    let my = n1[1] + n2[1];
    const ml = Math.hypot(mx, my) || 1;
    mx /= ml;
    my /= ml;
    const cos = mx * n1[0] + my * n1[1];
    const len = dist * Math.min(1.5, 1 / Math.max(cos, 1e-3));
    out[i] = [cur[0] + mx * len, cur[1] + my * len];
  }
  return out;
}

/** Perpendicular distance from point p to the infinite line through a→b. */
function perpDistance(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  return Math.abs((p[0] - a[0]) * dy - (p[1] - a[1]) * dx) / len;
}

/** Ramer–Douglas–Peucker on an open polyline (keeps both endpoints). */
function rdp(points: Contour, eps: number): Contour {
  if (points.length < 3) return points;
  const a = points[0];
  const b = points[points.length - 1];
  let maxD = 0;
  let idx = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const d = perpDistance(points[i], a, b);
    if (d > maxD) {
      maxD = d;
      idx = i;
    }
  }
  if (maxD > eps) {
    const left = rdp(points.slice(0, idx + 1), eps);
    const right = rdp(points.slice(idx), eps);
    return left.slice(0, -1).concat(right);
  }
  return [a, b];
}

/**
 * Simplify a closed contour by dropping points within `tolerance` of the line
 * between their neighbours — cuts cap triangles and wall quads at the cost of
 * detail (higher tolerance = blockier glyphs, fewer polygons). Anchored at the
 * vertex farthest from point 0 so the closed loop simplifies symmetrically.
 *
 * The tolerance is clamped to a fraction of the contour's own size, so small
 * counters/holes (e.g. the centre of `o`, `e`, `a`) never collapse no matter
 * how high the global tolerance goes — holes stay holes.
 */
export function simplifyContour(c: Contour, tolerance: number): Contour {
  if (tolerance <= 0 || c.length < 5) return c;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [x, y] of c) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const eps = Math.min(tolerance, Math.hypot(maxX - minX, maxY - minY) * 0.12);
  if (eps <= 1e-3) return c;

  let far = 0;
  let best = -1;
  for (let i = 1; i < c.length; i++) {
    const d = Math.hypot(c[i][0] - c[0][0], c[i][1] - c[0][1]);
    if (d > best) {
      best = d;
      far = i;
    }
  }
  const first = rdp(c.slice(0, far + 1), eps);
  const second = rdp([...c.slice(far), c[0]], eps);
  const merged = first.concat(second.slice(1, -1));
  return merged.length >= 3 ? merged : c;
}

export function dedupeContour(c: Contour, eps = 0.05): Contour {
  const out: Contour = [];
  for (const p of c) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) > eps) out.push(p);
  }
  while (out.length > 1) {
    const a = out[0];
    const b = out[out.length - 1];
    if (Math.hypot(a[0] - b[0], a[1] - b[1]) <= eps) out.pop();
    else break;
  }
  return out;
}

export function signedArea(c: Contour): number {
  let a = 0;
  for (let i = 0, n = c.length; i < n; i++) {
    const [x0, y0] = c[i];
    const [x1, y1] = c[(i + 1) % n];
    a += x0 * y1 - x1 * y0;
  }
  return a / 2;
}

function pointInPolygon(p: Pt, poly: Contour): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    const hit = yi > p[1] !== yj > p[1] &&
      p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi;
    if (hit) inside = !inside;
  }
  return inside;
}

function withWinding(c: Contour, ccw: boolean): Contour {
  const positive = signedArea(c) > 0;
  return positive === ccw ? c : c.slice().reverse();
}

/** Proper segment intersection (excludes shared/collinear touches at a
 * tolerance) — a crossing, not a tangential touch. */
function segmentsCross(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const d1 = turn(c, d, a);
  const d2 = turn(c, d, b);
  const d3 = turn(a, b, c);
  const d4 = turn(a, b, d);
  const eps = 1e-9;
  if (Math.abs(d1) < eps || Math.abs(d2) < eps || Math.abs(d3) < eps || Math.abs(d4) < eps) return false;
  return d1 > 0 !== d2 > 0 && d3 > 0 !== d4 > 0;
}

/** Do two contour boundaries actually cross anywhere (not just touch)? */
function contoursCross(a: Contour, b: Contour): boolean {
  for (let i = 0; i < a.length; i++) {
    const a0 = a[i];
    const a1 = a[(i + 1) % a.length];
    for (let j = 0; j < b.length; j++) {
      if (segmentsCross(a0, a1, b[j], b[(j + 1) % b.length])) return true;
    }
  }
  return false;
}

/**
 * Group contours into filled shapes with holes by nesting depth (even depth =
 * filled, odd = hole of its immediate parent), independent of font winding.
 * Call this PER glyph / per decoration — never across overlapping pieces, or a
 * strikethrough bar would swallow the glyphs it crosses as "holes".
 */
export function groupShapes(contours: Contour[]): Shape[] {
  const valid = contours.filter((c) => c.length >= 3);
  const n = valid.length;
  const depth = new Array(n).fill(0);
  const parent = new Array<number>(n).fill(-1);

  for (let i = 0; i < n; i++) {
    const probe = valid[i][0];
    let bestParent = -1;
    let bestArea = Infinity;
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      // A single probe-point-in-polygon test only proves true containment
      // when the two boundaries never cross. Some TrueType sources (notably
      // hinted/autohinted Google Fonts static instances) draw a glyph as
      // several simple contours meant to be combined by the nonzero winding
      // fill rule — e.g. an "h" as a separate stem rectangle plus an
      // arch+leg contour that overlap without either nesting inside the
      // other. Contour i's first vertex can still land inside contour j by
      // coincidence of that overlap, which would wrongly turn j into a
      // "hole" subtracted from a shape it isn't actually contained by —
      // earcut then triangulates a hole that pokes outside its outer
      // boundary, producing a cap whose edges don't match the (correctly
      // built) extrusion walls: a non-watertight mesh. Requiring the
      // boundaries to never cross before counting containment routes this
      // case to the overlap-union fallback below instead.
      if (pointInPolygon(probe, valid[j]) && !contoursCross(valid[i], valid[j])) {
        depth[i]++;
        const a = Math.abs(signedArea(valid[j]));
        if (a < bestArea) {
          bestArea = a;
          bestParent = j;
        }
      }
    }
    parent[i] = bestParent;
  }

  // Every contour landed at odd depth (each is "inside" some other one) —
  // impossible for genuinely nested outer/hole shapes, which always have at
  // least one depth-0 root. This happens when contours actually overlap
  // rather than nest: some TrueType sources (notably hinted/autohinted
  // Google Fonts static instances) ship a glyph as two or more overlapping
  // simple contours that are meant to be combined by the nonzero winding
  // fill rule, not read as outer+hole pairs. We don't implement a true
  // winding-rule polygon union here — render each contour as its own filled
  // outer instead of silently dropping the whole glyph. The overlap region
  // just fills twice (harmless) instead of leaving a hole; this only
  // triggers when the strict-nesting path below would otherwise yield zero
  // shapes, so it never changes output for contours that already nest cleanly.
  if (n > 0 && depth.every((d) => d % 2 === 1)) {
    return valid.map((v) => ({ outer: withWinding(v, true), holes: [] }));
  }

  const shapes: Shape[] = [];
  const indexOfShape = new Map<number, number>();
  for (let i = 0; i < n; i++) {
    if (depth[i] % 2 === 0) {
      indexOfShape.set(i, shapes.length);
      shapes.push({ outer: withWinding(valid[i], true), holes: [] });
    }
  }
  for (let i = 0; i < n; i++) {
    if (depth[i] % 2 === 1) {
      const si = indexOfShape.get(parent[i]);
      if (si !== undefined) shapes[si].holes.push(withWinding(valid[i], false));
    }
  }
  return shapes;
}

/** Axis-aligned rectangle as a single shape (for underline / strike bars). */
export function rectShape(x0: number, y0: number, x1: number, y1: number): Shape {
  return { outer: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], holes: [] };
}

/** Multiply a hex color toward black by `f` (0..1). */
export function shade(hex: string, f: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const r = Math.round(((n >> 16) & 255) * f);
  const g = Math.round(((n >> 8) & 255) * f);
  const b = Math.round((n & 255) * f);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}
