/**
 * bench/synth-mesh.mjs — synthetic ParseResult-shaped objects for high-poly
 * stress testing.
 *
 * Generates UV-sphere meshes with controllable poly count for benchmarking
 * the dynamic CSS lighting path beyond real OBJ mesh sizes.
 *
 * Used by bench/perf.html when mesh=synth-Nk is passed as a URL param.
 * Exported as ES module so it can be imported directly by the browser.
 *
 * Polygon shape matches packages/core/src/types.ts `Polygon`:
 *   { vertices: Vec3[], color?: string }
 * ParseResult shape matches packages/core/src/parser/types.ts:
 *   { polygons: Polygon[], objectUrls: string[], dispose: () => void, warnings: string[] }
 *
 * UV-sphere formula: N longitude segments × M latitude rings.
 *   body quads = N × (M-1), each split into 2 triangles
 *   polar caps = N triangles (top + bottom)
 *   total polys ≈ 2 × N × M
 * To hit T target polys: N = M = round(sqrt(T / 2))
 */

const BASE_COLOR = "#94a3b8";
const RADIUS = 30; // world units — ~60-unit target size

/**
 * Generate a UV-sphere ParseResult with approximately `targetPolys` triangles.
 * @param {number} targetPolys — desired polygon count
 * @returns {object} ParseResult-shaped object
 */
export function buildSynthMesh(targetPolys) {
  // N × M grid: total ≈ 2NM. With N = M: 2N² = targetPolys → N = sqrt(T/2)
  const N = Math.max(4, Math.round(Math.sqrt(targetPolys / 2)));
  const M = N; // latitude rings (square grid for uniform poly size)

  const polygons = [];

  function vertex(lat, lon) {
    const sinLat = Math.sin(lat);
    const cosLat = Math.cos(lat);
    return [
      RADIUS * sinLat * Math.cos(lon),
      RADIUS * sinLat * Math.sin(lon),
      RADIUS * cosLat,
    ];
  }

  const TWO_PI = 2 * Math.PI;
  const PI = Math.PI;

  // Top polar cap: N triangles
  for (let i = 0; i < N; i++) {
    const lon0 = (i / N) * TWO_PI;
    const lon1 = ((i + 1) / N) * TWO_PI;
    const pole = vertex(0, 0);
    const v0 = vertex(PI / M, lon0);
    const v1 = vertex(PI / M, lon1);
    polygons.push({ vertices: [[...pole], [...v1], [...v0]], color: BASE_COLOR });
  }

  // Body quads: (M-1) rings × N segments, each quad → 2 triangles
  for (let ring = 0; ring < M - 1; ring++) {
    const lat0 = ((ring + 1) / M) * PI;
    const lat1 = ((ring + 2) / M) * PI;
    for (let seg = 0; seg < N; seg++) {
      const lon0 = (seg / N) * TWO_PI;
      const lon1 = ((seg + 1) / N) * TWO_PI;
      const v00 = vertex(lat0, lon0);
      const v01 = vertex(lat0, lon1);
      const v10 = vertex(lat1, lon0);
      const v11 = vertex(lat1, lon1);
      polygons.push({ vertices: [[...v00], [...v10], [...v11]], color: BASE_COLOR });
      polygons.push({ vertices: [[...v00], [...v11], [...v01]], color: BASE_COLOR });
    }
  }

  // Bottom polar cap: N triangles
  for (let i = 0; i < N; i++) {
    const lon0 = (i / N) * TWO_PI;
    const lon1 = ((i + 1) / N) * TWO_PI;
    const pole = vertex(PI, 0);
    const v0 = vertex(((M - 1) / M) * PI, lon0);
    const v1 = vertex(((M - 1) / M) * PI, lon1);
    polygons.push({ vertices: [[...pole], [...v0], [...v1]], color: BASE_COLOR });
  }

  return {
    polygons,
    objectUrls: [],
    dispose: () => {},
    warnings: [],
    metadata: {
      triangleCount: polygons.length,
      meshes: [`synth-sphere-${targetPolys}`],
      materials: ["synth"],
      sourceBytes: 0,
    },
  };
}

/**
 * Named presets matching the URL param convention used in perf.html:
 * mesh=synth-10k, mesh=synth-30k, mesh=synth-50k
 *
 * Values are target poly counts. Actual counts will be close but not exact
 * due to the N×M grid rounding.
 */
export const SYNTH_PRESETS = {
  "synth-10k": 10000,
  "synth-30k": 30000,
  "synth-50k": 50000,
  // Boundary probes: between saucer (4054 nodes) and 10k, to find the ceiling
  "synth-6k":  6000,
  "synth-8k":  8000,
};

/**
 * Get a ParseResult-shaped object for a named synth preset.
 * Called by bench/perf.html when meshId.startsWith("synth-").
 * @param {string} name — e.g. "synth-10k"
 * @returns {object|null}
 */
export function getSynthMesh(name) {
  const count = SYNTH_PRESETS[name];
  if (count == null) return null;
  return buildSynthMesh(count);
}
