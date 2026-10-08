/**
 * C2 fix round 7/8 gates (USER FEEDBACK, verbatim: "why is it that we
 * cannot see the axis not in the middle but at the sides of the shapes we
 * render :/ ... do not put the 0,0,0 in the center of the shape, put it
 * in one of the corners"; round 8 coordinator review: "the origin corner
 * is at the FRONT, so the z axis runs up through the middle of the
 * shape"). Exercised against the REAL vendored dataset fixtures
 * (`fixtures/3d/`, copies of the site's own Maunga Whau volcano and ETOPO1
 * Alps window — `packages/charts` cannot import from `website/`) at
 * `GLYPH_CHART_3D_DEFAULT_CAMERA`, never a synthetic grid: the whole point
 * is that the axis triad reads correctly on the two real surfaces that
 * prompted the redesign.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import * as glyph from "glyphcss";
import { createGlyphOrthographicCamera, createGlyphScene } from "glyphcss";
import type { CompileSceneOptions, Polygon } from "glyphcss";
import { glyphChartSurface } from "./surface";
import { glyphChartObject, glyphChart3dResolvedCorner } from "./object";
import { renderGlyphChart3d } from "./render";
import { GLYPH_CHART_3D_DEFAULT_CAMERA } from "./camera";

// A JSON fixture, loaded via `fs` (never a TS import, mirroring every other
// `packages/charts` test's own `fixturePath` idiom, e.g.
// `sankeyOrderGate.test.ts`) — `packages/charts/fixtures/3d/` sits outside
// the package's own `rootDir` (`./src`), which `tsc --noEmit` enforces for
// an IMPORTED module but not for a plain runtime file read.
const HERE = dirname(fileURLToPath(import.meta.url));
interface GridFixture { readonly z: readonly (readonly number[])[]; readonly x: readonly number[]; readonly y: readonly number[]; }
const maungaWhau: GridFixture = JSON.parse(readFileSync(join(HERE, "../../fixtures/3d/maungaWhauVolcano.json"), "utf8"));
const etopo1Alps: GridFixture = JSON.parse(readFileSync(join(HERE, "../../fixtures/3d/etopo1Alps.json"), "utf8"));

type Corner = readonly [0 | 1, 0 | 1, 0 | 1];

function flipBit(corner: Corner, axis: 0 | 1 | 2): Corner {
  const out: [0 | 1, 0 | 1, 0 | 1] = [corner[0], corner[1], corner[2]];
  out[axis] = corner[axis] ? 0 : 1;
  return out;
}

function cornerWorldPoint(corner: Corner, ext: readonly [number, number, number]): [number, number, number] {
  return [corner[0] ? ext[0]! : 0, corner[1] ? ext[1]! : 0, corner[2] ? ext[2]! : 0];
}

interface AxisMeasurement {
  /** The origin corner's own column position among the box's 8 vertices — `0` = the strict box-column minimum, `0.5` = the box's own column midpoint, `1` = the strict maximum. Never `1 - fraction`; this is the round-8 "how far toward the side" metric (`camera.ts`'s own doc). */
  readonly leftFraction: number;
  /** One visible-fraction per axis (x, y, z), counting its depth-tested braille dots before annotation overlays. */
  readonly visibleFraction: readonly [number, number, number];
  readonly text: string;
  readonly leftMargin: number;
  readonly rightMargin: number;
  readonly cols: number;
}

function brailleMask(char: string): number {
  const code = char.charCodeAt(0);
  return code >= 0x2800 && code <= 0x28ff ? code - 0x2800 : 0;
}

function bitCount(value: number): number {
  let count = 0;
  for (; value; value &= value - 1) count++;
  return count;
}

/**
 * Renders `mark` at `GLYPH_CHART_3D_DEFAULT_CAMERA` (via `renderGlyphChart3d`,
 * so the SAME auto-fit, plot width, decimation and thin axes a caller gets).
 * A whole-cell surface winner cannot say whether a sub-cell axis stroke is
 * hidden. Ask the real wireframe rasterizer instead, retaining every surface
 * for its depth test but tracing one axis at a time so coincident terrain
 * edges cannot pass for axis ink. Annotations have a separate contract: tick
 * marks deliberately replace line cells, so they are not terrain occlusion.
 */
async function measureAxisTriad(mark: ReturnType<typeof glyphChartSurface>, occluders: Polygon[] = []): Promise<AxisMeasurement> {
  const cols = 96, rows = 32;
  let compileOptions: CompileSceneOptions | undefined;
  const compileScene = glyph.compileScene;
  const spy = vi.spyOn(glyph, "compileScene").mockImplementation((options) => {
    compileOptions = options;
    return compileScene(options);
  });
  const result = (() => {
    try {
      const rendered = renderGlyphChart3d(mark, { target: "web", charset: "braille", color: "none", width: cols, height: rows });
      expect(spy).toHaveBeenCalledTimes(1);
      return rendered;
    } finally {
      spy.mockRestore();
    }
  })();
  expect(compileOptions).toMatchObject({ mode: "wireframe", charMode: "braille", hiddenLines: "hide" });
  const options = compileOptions!;
  const camera = options.camera!;
  const grid = { cols: options.cols!, rows: options.rows!, cellAspect: options.cellAspect! };
  const object = result.object;
  const polygons = [...options.polygons, ...object.meshes.flatMap((mesh) => mesh.polygons), ...occluders];
  const rasterOptions = { ...options, camera, grid, polygons };
  const unannotated = compileScene({
    ...options,
    polygons: [...options.polygons, ...occluders],
    objects: [{ ...object, overlays: [] }],
  }).grid!;
  // Keep this focused raster probe tied to the actual compile pipeline;
  // future render-option or object-composition drift must fail here.
  expect(glyph.rasterize(glyph.buildRasterizeContext(rasterOptions)).replace(/\n/g, "")).toBe(unannotated.char.join(""));

  const corner = glyphChart3dResolvedCorner(mark);
  const ext = object.bounds.max;
  const cornerPoint = cornerWorldPoint(corner, ext);

  let minCol = Infinity, maxCol = -Infinity, originCol = 0;
  for (const x of [0, ext[0]!]) for (const y of [0, ext[1]!]) for (const z of [0, ext[2]!]) {
    const [col] = camera.project([x, y, z], grid.cols, grid.rows, grid.cellAspect);
    minCol = Math.min(minCol, col); maxCol = Math.max(maxCol, col);
    if (x === 0 && y === 0 && z === 0) originCol = col;
  }
  const leftFraction = maxCol > minCol ? (originCol - minCol) / (maxCol - minCol) : 0.5;

  const axisMesh = object.meshes.find((mesh) => mesh.name === "axis-lines")!;
  expect(axisMesh.polygons).toHaveLength(3);
  const visibleFraction = ([0, 1, 2] as const).map((axis) => {
    const toPoint = cornerWorldPoint(flipBit(corner, axis), ext);
    const polygon = axisMesh.polygons[axis]!;
    expect(polygon.vertices).toEqual([cornerPoint, toPoint, toPoint, cornerPoint]);
    // Clipped reference strokes would shrink the denominator and disguise
    // missing axis length; the complete segment must fit before counting.
    for (const point of [cornerPoint, toPoint]) {
      const [col, row] = camera.project(point, grid.cols, grid.rows, grid.cellAspect);
      expect(col).toBeGreaterThanOrEqual(0);
      expect(col).toBeLessThan(grid.cols - 1);
      expect(row).toBeGreaterThanOrEqual(0);
      expect(row).toBeLessThan(grid.rows - 1);
    }
    const reference = compileScene({
      ...options,
      polygons: [],
      objects: [{ ...object, meshes: [{ ...axisMesh, polygons: [polygon] }], overlays: [] }],
    }).grid!;
    const axisOnly = glyph.buildRasterizeContext({ ...rasterOptions, polygons: [polygon] });
    expect(glyph.rasterize(axisOnly).replace(/\n/g, "")).toBe(reference.char.join(""));
    const wireframe = axisOnly.wireframe;
    const visibleChars = glyph.rasterize(glyph.buildRasterizeContext({ ...rasterOptions, wireframe })).replace(/\n/g, "");
    let visible = 0, total = 0;
    for (let i = 0; i < reference.char.length; i++) {
      const mask = brailleMask(reference.char[i]!);
      total += bitCount(mask);
      visible += bitCount(mask & brailleMask(visibleChars[i]!));
    }
    expect(total, "sanity: the unoccluded axis must render dots").toBeGreaterThan(0);
    return visible / total;
  }) as [number, number, number];

  const lines = result.text.split("\n");
  let inkMinCol = Infinity, inkMaxCol = -Infinity;
  for (const line of lines) for (let c = 0; c < line.length; c++) if (line[c] !== " ") { inkMinCol = Math.min(inkMinCol, c); inkMaxCol = Math.max(inkMaxCol, c); }

  return { leftFraction, visibleFraction, text: result.text, leftMargin: inkMinCol, rightMargin: cols - 1 - inkMaxCol, cols };
}

const FIXTURES = [
  { name: "Maunga Whau", z: maungaWhau.z, x: maungaWhau.x, y: maungaWhau.y },
  { name: "Alps (ETOPO1)", z: etopo1Alps.z, x: etopo1Alps.x, y: etopo1Alps.y },
] as const;

function buildMark(fixture: (typeof FIXTURES)[number]) {
  return glyphChartSurface({ z: fixture.z }, { x: fixture.x, y: fixture.y }, {
    axes: { x: { title: "x" }, y: { title: "y" }, z: { title: "z" } },
  });
}

describe("C2 fix round 7/8 — axis triad from one origin corner", () => {
  it("the origin corner is always the DATA-MIN box vertex [0,0,0] under 'auto'", () => {
    for (const fixture of FIXTURES) {
      const mark = buildMark(fixture);
      expect(glyphChart3dResolvedCorner(mark)).toEqual([0, 0, 0]);
    }
  });

  it("the visibility probe detects real foreground occlusion of all three axes", async () => {
    // Foreground faces hide the unchanged chart's axes; the cube's edges
    // stay away from the reference strokes so they cannot count as axis ink.
    const foreground = glyph.cubePolygons({ size: 10, center: [0, 0, 0] });
    const { visibleFraction } = await measureAxisTriad(buildMark(FIXTURES[1]), foreground);
    for (const fraction of visibleFraction) expect(fraction).toBe(0);
  });

  for (const fixture of FIXTURES) {
    it(`${fixture.name}: the corner sits noticeably left of the box's own column MIDPOINT — round 8's own "not merely near-centre" gate (\`camera.ts\`'s doc: strict box-leftmost is provably unreachable together with real axis-line visibility for this box shape, so this checks a real, measured, material move toward the side rather than the unreachable literal extreme)`, async () => {
      const mark = buildMark(fixture);
      const { leftFraction } = await measureAxisTriad(mark);
      // MUTATION: at round 7's own default (`rotY: 228`) this measures
      // ~0.474 on both fixtures — inside the middle band this gate
      // excludes — because 228 is the box's own NEAREST corner to the
      // camera, not a side one (the round-8 defect report: "the z axis
      // runs up through the middle of the shape").
      expect(leftFraction).toBeLessThan(0.45);
    });

    it(`${fixture.name}: each of the x/y/z axis lines is at least 85% visible (unoccluded by the surface) at the default camera`, async () => {
      const mark = buildMark(fixture);
      const { visibleFraction } = await measureAxisTriad(mark);
      for (const [i, name] of (["x", "y", "z"] as const).entries()) {
        expect(visibleFraction[i], `${name} axis`).toBeGreaterThanOrEqual(0.85);
      }
    });

    it(`${fixture.name}: LEFT and RIGHT frame ink margins are within +/-15% of each other (P1-B: no artificial one-sided column shift wastes frame space)`, async () => {
      const mark = buildMark(fixture);
      const { leftMargin, rightMargin } = await measureAxisTriad(mark);
      const bigger = Math.max(leftMargin, rightMargin);
      const smaller = Math.min(leftMargin, rightMargin);
      expect((bigger - smaller) / bigger).toBeLessThanOrEqual(0.15);
    });

    it(`${fixture.name}: at least 3 whole tick labels render per axis, with no '?' fold (P1-C: a negative tick must show ASCII '-', never the U+2212 minus the chrome tiers can't paint)`, () => {
      const mark = buildMark(fixture);
      const result = renderGlyphChart3d(mark, { target: "web", charset: "braille", width: 96, height: 32 });
      for (const axisName of ["x", "y", "z"] as const) {
        const labels = mark.axes[axisName].tickLabels;
        const present = labels.filter((label) => result.text.includes(label));
        expect(present.length, `${axisName} labels`).toBeGreaterThanOrEqual(3);
        for (const label of labels) expect(label.includes("−")).toBe(false);
      }
      expect(result.text.includes("?")).toBe(false);
    });

    it(`${fixture.name}: the DEFAULT-guides braille render contains no stamped '/','\\\\','|','─' edge glyph (axis lines are real depth-tested geometry now, never a stamped box-drawing glyph)`, () => {
      const mark = buildMark(fixture);
      const result = renderGlyphChart3d(mark, { target: "web", charset: "braille", width: 96, height: 32 });
      expect(/[/\\|─]/.test(result.text)).toBe(false);
    });
  }

  it("P1-C: a negative-domain axis renders '-10', never '?10' (colorbar and tick labels alike)", () => {
    const mark = glyphChartSurface(
      { z: [[-20, -10, 0], [-10, 0, 10], [0, 10, 20]] },
      undefined,
      { axes: { x: { title: "x" }, y: { title: "y" }, z: { title: "z" } } },
    );
    const result = renderGlyphChart3d(mark, { target: "web", charset: "box", width: 96, height: 32 });
    expect(result.text.includes("?")).toBe(false);
    expect(/-\d/.test(result.text)).toBe(true);
  });

  for (const charset of ["box", "ascii"] as const) {
    it(`P2 (${charset}): the axis-lines mesh's own cells never paint the solid ramp's densest glyphs ('@'/'#'/'%') at the real default camera — a real render + winnerMesh scoped read, MUTATION: deleting the authored \`shadingNormal\` (object.ts's own \`AXIS_LINE_SHADING_NORMAL\`) reverts this to a real geometric Lambert response that DOES hit those glyphs on some rotations`, async () => {
      const mark = buildMark(FIXTURES[0]);
      const cols = 96, rows = 32;
      const result = renderGlyphChart3d(mark, { target: "web", charset, color: "none", width: cols, height: rows });
      const object = glyphChartObject(mark, { charset });
      const camera = createGlyphOrthographicCamera({
        rotX: result.resolved.camera.rotX, rotY: result.resolved.camera.rotY,
        zoom: result.resolved.camera.zoom, center: [...result.resolved.camera.center] as [number, number],
      });
      camera.target = [
        (object.bounds.min[0] + object.bounds.max[0]) / 2,
        (object.bounds.min[1] + object.bounds.max[1]) / 2,
        (object.bounds.min[2] + object.bounds.max[2]) / 2,
      ];
      const host = document.createElement("div");
      document.body.appendChild(host);
      const scene = createGlyphScene(host, { cols, rows, useColors: false, camera });
      const handle = scene.addObject(object);
      const axisLinesMeshId = handle.meshes.get("axis-lines")!.id;
      let winnerMesh: Int32Array | undefined, chars: string[] | undefined;
      scene.setOptions({ transformCells: (grid: any) => { winnerMesh = grid.winnerMesh; chars = grid.char; } });
      await Promise.resolve();
      await Promise.resolve();
      scene.destroy();
      let axisLineCells = 0, denseGlyphCells = 0;
      const DENSE = new Set(["@", "#", "%"]);
      if (winnerMesh && chars) {
        for (let i = 0; i < winnerMesh.length; i++) {
          if (winnerMesh[i] !== axisLinesMeshId) continue;
          axisLineCells++;
          if (DENSE.has(chars[i] ?? "")) denseGlyphCells++;
        }
      }
      expect(axisLineCells, "sanity: axis-lines mesh must win at least some cells").toBeGreaterThan(0);
      expect(denseGlyphCells).toBe(0);
    });
  }

  for (const fixture of FIXTURES) {
    it(`${fixture.name}: MUTATION — the fitted camera's own horizontal recentring (\`resolved.camera.center[0]\`) stays close to symmetric bbox-centering's own value (no artificial column shift, P1-B) even though the corner itself now reads well off-centre`, async () => {
      // Round 7's own post-fit shift is DELETED (P1-B) — `center[0]` is
      // now purely `0.5 - dCol/cols` (plain symmetric content-centering),
      // so it stays close to 0.5 REGARDLESS of which corner the triad
      // uses; what moved the corner visually off-centre this round is the
      // YAW's own `leftFraction` improvement, not a positional hack. This
      // mutation is the INVERSE of round 7's own: reintroducing an
      // asymmetric shift (e.g. round 7's `ORIGIN_COLUMN_TARGET_FRACTION`)
      // would push `center[0]` outside this band.
      const mark = buildMark(fixture);
      const result = renderGlyphChart3d(mark, { target: "web", charset: "braille", width: 96, height: 32 });
      expect(Math.abs(result.resolved.camera.center[0] - 0.5)).toBeLessThan(0.1);
    });
  }
});
