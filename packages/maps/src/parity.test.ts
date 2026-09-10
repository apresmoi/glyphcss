import { describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { glyphMapGlobe } from "./projection";
import { glyphMapGeoTileVertexLonLat, type GlyphMapGeoTile } from "./tile";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../..");
const FIXTURE = path.resolve(__dirname, "../fixtures/geo-tile-parity.json");
// The pre-projected reference tile is CHECKED IN at this path (MAPS.md §13
// slice 2's acceptance-gate harness) — CI needs no ETOPO1 to run this test.
const REFERENCE_TILE = path.join(REPO_ROOT, "website/public/data/tiles/0/0_0.json");
const REFERENCE_COLS = 180; // matches bake-globe.mjs's `--tiles` z0 COLS_PER_TILE.
const REFERENCE_LON_MIN = -180;
const REFERENCE_LAT_MAX = 90;
const REFERENCE_STEP_DEG = 2; // 360 / 180

/**
 * Acceptance gate 3 (MAPS.md §13 slice 2): a geographic tile projected
 * client-side equals the corresponding pre-projected `bake-globe.mjs`
 * output, vertex for vertex.
 *
 * KNOWN, DOCUMENTED DEVIATION — read before "fixing" this test.
 *
 * `bake-globe.mjs:150`'s `latLonToXYZ` NEGATES `Y`:
 *
 *     y = -radius * cos(lat) * sin(lon)
 *
 * `glyphMapGlobe` (this package's own projection, `projection.ts`)
 * DELIBERATELY does not:
 *
 *     y = +radius * cos(lat) * sin(lon)
 *
 * This is not an oversight and not tolerance-worthy float noise — it is an
 * exact, whole-value sign flip on `Y` alone (`X` and `Z` agree to float
 * precision, asserted below). Investigating why required verifying, through
 * `glyphcss`'s OWN real camera math (not this package's), which sign is
 * geographically correct: `chirality.test.ts` (acceptance gate 1) proves
 * `glyphMapGlobe`'s un-negated `Y` is the one that reads "30°E projects to a
 * GREATER col than 0°E" under a camera facing Greenwich with north up — the
 * literal, numbered assertion MAPS.md §7/§13 specifies, and a test anchored
 * OUTSIDE this package's own math (so it can't be satisfied by construction).
 * `bake-globe.mjs`'s negated `Y` FAILS that same assertion (verified: swap
 * the sign in `chirality.test.ts`'s formula and the `col` assertion goes
 * red) — meaning the checked-in reference tiles this test compares against
 * are themselves mirrored east-west relative to true Earth geography, a
 * pre-existing defect in `bake-globe.mjs` uncovered by writing this gate,
 * not introduced by this package.
 *
 * Corroborating evidence INSIDE `bake-globe.mjs` itself: its OWN flat-map
 * projection (`flatToPlane`, used by `bakeFlatTile`/`bakeFlatMap`) maps
 * longitude to `worldY = (lon - lonC) / 180` — UN-negated, i.e. already
 * chirality-correct by this same test's standard. Only the sphere path
 * (`latLonToXYZ`) negates `Y`; the flat path in the same file does not. This
 * reads as an isolated, one-formula bug rather than a deliberate, considered
 * convention applied consistently across the file.
 *
 * Literal byte/vertex parity as MAPS.md §13 states it is therefore NOT
 * achievable while `glyphMapGlobe` also satisfies the chirality gate — the
 * two gates contradict for the globe projection specifically (no other
 * projection in this slice has a checked-in reference to conflict with).
 * This test asserts the PRECISE, understood relationship instead of a fuzzy
 * tolerance: `X`/`Z` match to float-truncation precision (the reference
 * JSON is written through `bake-globe.mjs`'s own `trunc()`, 5 significant
 * decimal digits), and `Y` matches only once NEGATED — proven by also
 * asserting that a literal (non-negated) `Y` comparison is NOT close, so
 * this isn't silently passing on a loose bound.
 *
 * See also `AGENTS.md` / the PR description for the same finding and its
 * recommendation (fix `bake-globe.mjs`'s `latLonToXYZ`, out of this slice's
 * scope, separately).
 */
describe("parity with bake-globe.mjs's checked-in globe tiles (acceptance gate 3)", () => {
  async function loadFixture(): Promise<GlyphMapGeoTile> {
    const raw = await fs.readFile(FIXTURE, "utf8");
    const parsed = JSON.parse(raw) as { bounds: GlyphMapGeoTile["bounds"]; cols: number; rows: number; elevation: number[]; source: string; sampler: string };
    return { ...parsed, elevation: Float32Array.from(parsed.elevation) };
  }

  async function loadReferenceQuads(): Promise<{ vertices: [number, number, number][] }[]> {
    const raw = await fs.readFile(REFERENCE_TILE, "utf8");
    return JSON.parse(raw) as { vertices: [number, number, number][] }[];
  }

  /** The reference tile's own vertex(i, j) — quad(i, j)'s "a" (top-left/NW) corner, exactly bake-globe.mjs's own vertGrid[j][i]. */
  function referenceVertex(quads: { vertices: [number, number, number][] }[], i: number, j: number): [number, number, number] {
    return quads[j * REFERENCE_COLS + i].vertices[0];
  }

  it("the fixture's own grid step matches the reference tile's resolution (2°/quad) and lands exactly on its grid", async () => {
    const fixture = await loadFixture();
    const stepLon = (fixture.bounds.east - fixture.bounds.west) / fixture.cols;
    const stepLat = (fixture.bounds.north - fixture.bounds.south) / fixture.rows;
    expect(stepLon).toBe(REFERENCE_STEP_DEG);
    expect(stepLat).toBe(REFERENCE_STEP_DEG);
    expect((fixture.bounds.west - REFERENCE_LON_MIN) / REFERENCE_STEP_DEG).toBe(Math.round((fixture.bounds.west - REFERENCE_LON_MIN) / REFERENCE_STEP_DEG));
  });

  it("X and Z match the checked-in reference to float-truncation precision; Y matches only once negated (the known deviation)", async () => {
    const fixture = await loadFixture();
    const quads = await loadReferenceQuads();
    const projection = glyphMapGlobe({ radius: 1, exaggeration: 30 });

    const iBase = Math.round((fixture.bounds.west - REFERENCE_LON_MIN) / REFERENCE_STEP_DEG);
    const jBase = Math.round((REFERENCE_LAT_MAX - fixture.bounds.north) / REFERENCE_STEP_DEG);

    let maxDeltaX = 0;
    let maxDeltaZ = 0;
    let maxDeltaYNegated = 0;
    let maxDeltaYLiteral = 0;

    for (let row = 0; row <= fixture.rows; row++) {
      for (let col = 0; col <= fixture.cols; col++) {
        const [lon, lat] = glyphMapGeoTileVertexLonLat(fixture, col, row);
        const elev = fixture.elevation[row * (fixture.cols + 1) + col];
        const [x, y, z] = projection.project(lon, lat, elev);
        const [refX, refY, refZ] = referenceVertex(quads, iBase + col, jBase + row);

        maxDeltaX = Math.max(maxDeltaX, Math.abs(x - refX));
        maxDeltaZ = Math.max(maxDeltaZ, Math.abs(z - refZ));
        maxDeltaYNegated = Math.max(maxDeltaYNegated, Math.abs(y - -refY));
        maxDeltaYLiteral = Math.max(maxDeltaYLiteral, Math.abs(y - refY));
      }
    }

    // X/Z: exact agreement, up to the reference's own 5-sig-fig truncation.
    expect(maxDeltaX).toBeLessThan(2e-5);
    expect(maxDeltaZ).toBeLessThan(2e-5);
    // Y matches once negated, to the same truncation precision...
    expect(maxDeltaYNegated).toBeLessThan(2e-5);
    // ...and does NOT match literally — proving the deviation above is a
    // real, whole-value sign flip, not tolerance loosened to hide noise.
    expect(maxDeltaYLiteral).toBeGreaterThan(0.01);
  });
});
