/**
 * normalizePolygons — validates a polygon list, drops degenerate inputs,
 * triangulates non-coplanar N-gons, strips bad UVs, sanitizes data, and
 * returns the cleaned polygons + a list of human-readable warnings.
 *
 * Validation rules are encoded here and covered by the normalization tests.
 *
 * Pure: no DOM, no I/O, deterministic. Bbox is NOT computed here — that's
 * derived on demand by `buildSceneContext` / consumers.
 */
import type { Polygon, Vec2, Vec3 } from "../types";
import { parseColor } from "../color/lighting";

export interface NormalizeResult {
  polygons: Polygon[];
  warnings: string[];
}

const DEFAULT_COLOR = "#cccccc";

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);

function bboxDiagonal(verts: Vec3[]): number {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const v of verts) {
    if (v[0] < minX) minX = v[0]; if (v[0] > maxX) maxX = v[0];
    if (v[1] < minY) minY = v[1]; if (v[1] > maxY) maxY = v[1];
    if (v[2] < minZ) minZ = v[2]; if (v[2] > maxZ) maxZ = v[2];
  }
  const dx = maxX - minX, dy = maxY - minY, dz = maxZ - minZ;
  return Math.hypot(dx, dy, dz);
}

/**
 * Best-effort dev-mode detection. We can't import `import.meta.env.DEV`
 * because core is plain TS (no Vite). This treats common environment hints
 * (NODE_ENV !== "production" or a runtime DEV flag on globalThis) as dev.
 */
function isDevMode(): boolean {
  const g = globalThis as unknown as { __GLYPH_DEV__?: boolean; process?: { env?: { NODE_ENV?: string } } };
  if (g.__GLYPH_DEV__ === true) return true;
  if (g.__GLYPH_DEV__ === false) return false;
  const env = g.process?.env?.NODE_ENV;
  if (typeof env === "string") return env !== "production";
  return false;
}

export function normalizePolygons(input: Polygon[]): NormalizeResult {
  const out: Polygon[] = [];
  const warnings: string[] = [];

  if (!input || input.length === 0) {
    return { polygons: out, warnings };
  }

  for (let i = 0; i < input.length; i++) {
    const p = input[i];
    if (!p || !Array.isArray(p.vertices)) {
      warnings.push(`Polygon ${i}: missing vertices, dropped`);
      continue;
    }
    const verts = p.vertices;

    // Rule 1: < 3 vertices → drop
    if (verts.length < 3) {
      warnings.push(`Polygon ${i}: ${verts.length} vertices (need >= 3), dropped`);
      continue;
    }

    // Rule 2/3: collinear / zero-area triangle → drop
    // For triangles we check both at once: cross of (v1-v0, v2-v0) == 0 means
    // collinear OR the polygon has zero area. For N-gons we also check the
    // first triangle to catch fully-degenerate inputs.
    const e1 = sub(verts[1], verts[0]);
    const e2 = sub(verts[2], verts[0]);
    const baseNormal = cross(e1, e2);
    const baseNormalLen = len(baseNormal);

    if (verts.length === 3) {
      if (baseNormalLen < 1e-12) {
        // Distinguish collinear (some non-zero edges, parallel) from
        // coincident (vertices identical) for the warning text.
        if (len(e1) < 1e-12 || len(e2) < 1e-12) {
          warnings.push(`Polygon ${i}: zero-area triangle (coincident vertices), dropped`);
        } else {
          warnings.push(`Polygon ${i}: vertices collinear, dropped`);
        }
        continue;
      }
    } else {
      // N >= 4. If the first three are collinear we can't establish a plane.
      if (baseNormalLen < 1e-12) {
        warnings.push(`Polygon ${i}: first 3 vertices collinear, dropped`);
        continue;
      }
    }

    // Rule 4: N >= 4 non-coplanar → fan-triangulate
    let polysFromHere: Polygon[] = [{ ...p, vertices: verts.slice() }];
    if (verts.length >= 4) {
      // Plane defined by first three vertices; epsilon proportional to bbox
      // diagonal so the check is scale-invariant.
      const planeNormal: Vec3 = [
        baseNormal[0] / baseNormalLen,
        baseNormal[1] / baseNormalLen,
        baseNormal[2] / baseNormalLen,
      ];
      const planeD = dot(planeNormal, verts[0]);
      const diag = bboxDiagonal(verts);
      const eps = Math.max(1e-6, diag * 1e-3);
      let maxDev = 0;
      for (let k = 3; k < verts.length; k++) {
        const dev = Math.abs(dot(planeNormal, verts[k]) - planeD);
        if (dev > maxDev) maxDev = dev;
      }
      if (maxDev > eps) {
        // Fan-triangulate from vertex 0.
        const tris: Polygon[] = [];
        const sourceUvs = p.uvs && p.uvs.length === verts.length ? p.uvs : undefined;
        for (let k = 1; k < verts.length - 1; k++) {
          const triVerts: Vec3[] = [
            verts[0].slice() as Vec3,
            verts[k].slice() as Vec3,
            verts[k + 1].slice() as Vec3,
          ];
          // Skip any triangle that turned out degenerate post-split.
          const tn = cross(sub(triVerts[1], triVerts[0]), sub(triVerts[2], triVerts[0]));
          if (len(tn) < 1e-12) continue;
          const tri: Polygon = { ...p, vertices: triVerts };
          if (sourceUvs) {
            tri.uvs = [
              sourceUvs[0].slice() as Vec2,
              sourceUvs[k].slice() as Vec2,
              sourceUvs[k + 1].slice() as Vec2,
            ];
          }
          tris.push(tri);
        }
        if (tris.length === 0) {
          warnings.push(`Polygon ${i}: ${verts.length} non-coplanar vertices, fan-triangulation produced no valid triangles, dropped`);
          continue;
        }
        warnings.push(`Polygon ${i}: ${verts.length} non-coplanar vertices, fan-triangulated to ${tris.length} triangles`);
        polysFromHere = tris;
      }
    }

    // Apply per-polygon validation to each output (handles both the original
    // pass-through case and the per-triangle case after fan-triangulation).
    for (const poly of polysFromHere) {
      const cleaned = sanitizeFields(poly, i, warnings);
      if (cleaned) out.push(cleaned);
    }
  }

  return { polygons: out, warnings };
}

/**
 * Validate the non-vertex fields: uvs length, color string, texture string,
 * data values. Returns null only on catastrophic field shapes (none of the
 * current rules drop a polygon at this stage).
 */
function sanitizeFields(p: Polygon, originalIndex: number, warnings: string[]): Polygon | null {
  const out: Polygon = { vertices: p.vertices };

  // Texture: empty string treated as unset (no warning per spec).
  let texture = p.texture;
  if (typeof texture === "string" && texture === "") {
    texture = undefined;
  }

  // Rule: color + texture coexistence → keep both, dev-mode warn.
  if (p.color !== undefined && texture !== undefined) {
    if (isDevMode()) {
      warnings.push(`Polygon ${originalIndex}: color and texture both set; texture wins`);
    }
  }

  // Rule: invalid CSS color → replace with default gray, warn.
  if (p.color !== undefined) {
    const parsed = parseColor(p.color);
    if (!parsed) {
      warnings.push(`Polygon ${originalIndex}: invalid color "${p.color}", replaced with ${DEFAULT_COLOR}`);
      out.color = DEFAULT_COLOR;
    } else {
      out.color = p.color;
    }
  }

  if (texture !== undefined) {
    out.texture = texture;
  }

  // Rule: uvs.length !== vertices.length → strip uvs, warn.
  if (p.uvs !== undefined) {
    if (!Array.isArray(p.uvs) || p.uvs.length !== p.vertices.length) {
      warnings.push(`Polygon ${originalIndex}: uvs length ${Array.isArray(p.uvs) ? p.uvs.length : "?"} != vertices length ${p.vertices.length}, uvs stripped`);
    } else {
      out.uvs = p.uvs;
    }
  }

  // Rule: data with non-string/number/boolean values → drop offending key.
  if (p.data !== undefined && p.data !== null && typeof p.data === "object") {
    const cleanData: Record<string, string | number | boolean> = {};
    let droppedAny = false;
    for (const key of Object.keys(p.data)) {
      const v = (p.data as Record<string, unknown>)[key];
      if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
        cleanData[key] = v;
      } else {
        droppedAny = true;
        warnings.push(`Polygon ${originalIndex}: data["${key}"] has non-primitive value, key dropped`);
      }
    }
    if (Object.keys(cleanData).length > 0) {
      out.data = cleanData;
    } else if (droppedAny) {
      // All keys were invalid — leave data unset rather than emit empty {}.
    }
  }

  return out;
}
