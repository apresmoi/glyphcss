// @vitest-environment happy-dom
/**
 * `/maps`'s `model` layer geometry, asserted on what it PAINTS through the
 * real `createGlyphMap` + glyphcss renderer at a known place and a known
 * view — not on the vertex list.
 *
 * The assertion that matters is winding. glyphcss backface-culls on the sign
 * of a face's projected area, so a wrongly-wound pin is silently, completely
 * invisible — and the two shipped projections have OPPOSITE handedness for
 * "east then north" (see `mapPin.ts`'s doc). A test that only checked the
 * flat sheet would therefore pass on a hardcoded winding that renders
 * nothing on the globe, which is exactly the failure the probe exists to
 * prevent, so both are exercised here.
 *
 * happy-dom has no layout, so every position assertion goes through
 * `map.project`, which reads the same camera the renderer does.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createGlyphMap, glyphMapEquirectangular, glyphMapGlobe, type GlyphMapProjection } from "@glyphcss/maps";
import { buildGlyphMapModelPolygons, MAP_MODEL_SHAPES, MAP_MODEL_SHAPE_DEFAULT } from "./mapPin";

const COLS = 120;
const ROWS = 48;

/** Zermatt / the Matterhorn — inside the curated Switzerland bundle the repo already bakes. */
const ZERMATT: readonly [number, number] = [7.7491, 45.9766];

afterEach(() => {
  document.body.innerHTML = "";
});

function mount(projection: GlyphMapProjection, center: readonly [number, number], span: number, polygons: ReturnType<typeof buildGlyphMapModelPolygons>) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const map = createGlyphMap(host, {
    view: { center, span, cols: COLS, rows: ROWS },
    projection,
    // `tilt: 0` on BOTH is load-bearing, not cosmetic. Seen from an OBLIQUE
    // angle a reversed-winding pyramid still paints — the two faces on the
    // far side become the front-facing ones and project into roughly the
    // same screen area, so an oblique camera cannot tell the two windings
    // apart. Head-on (looking straight down the pin's own up axis) all four
    // faces flip together, so a wrong winding paints exactly nothing.
    tilt: 0,
    layers: [{ type: "model", id: "model", polygons }],
  });
  // `model` mounts its mesh and lets glyphcss coalesce the render; force it
  // so the assertions read a committed grid rather than an empty one.
  map.scene.rerender();
  return { host, map, teardown: () => { map.destroy(); host.remove(); } };
}

function inkIn(text: string, col: number, row: number, radius: number): number {
  const lines = text.split("\n");
  let n = 0;
  for (let r = Math.max(0, Math.round(row) - radius); r <= Math.min(ROWS - 1, Math.round(row) + radius); r++) {
    for (let c = Math.max(0, Math.round(col) - radius); c <= Math.min(COLS - 1, Math.round(col) + radius); c++) {
      if ((lines[r]?.[c] ?? " ") !== " ") n++;
    }
  }
  return n;
}

/**
 * Signed volume of a closed triangle-fanned polygon soup (divergence
 * theorem). Positive when every face is wound counter-clockwise as seen from
 * OUTSIDE; the sign flips under any mirroring or winding reversal.
 */
function signedVolume(faces: readonly { vertices: readonly (readonly number[])[] }[]): number {
  let v = 0;
  for (const face of faces) {
    const p = face.vertices;
    for (let i = 1; i + 1 < p.length; i++) {
      const [a, b, c] = [p[0], p[i], p[i + 1]];
      v += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
    }
  }
  return v;
}

describe("buildGlyphMapModelPolygons", () => {
  it("grounds the shape on the datum and lifts its top through the projection's own elevation axis", () => {
    const projection = glyphMapEquirectangular({ exaggeration: 30 });
    const faces = buildGlyphMapModelPolygons(projection, ZERMATT[0], ZERMATT[1], { heightM: 200_000, halfWidthDeg: 0.4, color: "#38bdf8" });
    // The default shape comes from `resolveGeometry("pyramid")` — 4 sides
    // plus a base cap — rather than a hand-built solid this file owns a
    // second copy of.
    expect(faces).toHaveLength(5);
    const apex = projection.project(ZERMATT[0], ZERMATT[1], 200_000);
    const ground = projection.project(ZERMATT[0], ZERMATT[1], 0);
    expect(apex[2]).toBeGreaterThan(ground[2]);

    // Grounding, stated exactly: the LOWEST vertex sits on the datum and the
    // HIGHEST at `heightM`, whatever the primitive's own local origin was.
    const depths = faces.flatMap((f) => f.vertices.map((v) => v[2]));
    const lo = Math.min(...depths);
    const hi = Math.max(...depths);
    expect(lo).toBeCloseTo(ground[2], 9);
    expect(hi).toBeCloseTo(apex[2], 9);
    // The apex stands over the anchor itself, not offset into the footprint.
    for (const v of faces.flatMap((f) => f.vertices).filter((v) => v[2] === hi)) {
      expect(v[0]).toBeCloseTo(apex[0], 9);
      expect(v[1]).toBeCloseTo(apex[1], 9);
    }
  });

  it("offers a short shape list, every entry of which builds a real grounded solid", () => {
    const projection = glyphMapEquirectangular({ exaggeration: 30 });
    const ground = projection.project(ZERMATT[0], ZERMATT[1], 0);
    const apex = projection.project(ZERMATT[0], ZERMATT[1], 200_000);
    expect(MAP_MODEL_SHAPES).toContain(MAP_MODEL_SHAPE_DEFAULT);
    for (const shape of MAP_MODEL_SHAPES) {
      const faces = buildGlyphMapModelPolygons(projection, ZERMATT[0], ZERMATT[1], { shape, heightM: 200_000, halfWidthDeg: 0.4, color: "#38bdf8" });
      expect(faces.length, shape).toBeGreaterThan(0);
      const depths = faces.flatMap((f) => f.vertices.map((v) => v[2]));
      expect(Math.min(...depths), shape).toBeCloseTo(ground[2], 9);
      expect(Math.max(...depths), shape).toBeCloseTo(apex[2], 9);
    }
  });

  /**
   * Winding, absolutely — the assertion an ink test CANNOT make.
   *
   * `resolveGeometry`'s solids are CLOSED (the pyramid comes with its base
   * cap, unlike the hand-built four-face pin this replaced). Reversing a
   * closed convex solid's winding does not blank it: the far faces simply
   * become the front-facing ones and paint into the same silhouette, so the
   * inked-cell count is bit-identical either way (measured: 73 cells for the
   * pyramid, 153 for the cube, both windings). What actually changes is
   * which SURFACE the viewer sees — the near one or, wrongly, the inside of
   * the far one.
   *
   * The signed volume through the divergence theorem states that exactly,
   * and in one number: positive means every face is wound CCW as seen from
   * OUTSIDE in the map's world frame, which is what glyphcss's `area2 <= 0`
   * front-facing rule needs. The sign is anchored, not guessed — the
   * previously shipped hand-built pin's own face order (verified by the
   * head-on ink tests below, which DID discriminate because that solid was
   * open) maps to a cyclic rotation of the same triangles this pipeline now
   * emits, and closing it gives a positive volume.
   *
   * This is what makes the probe testable at all: a mirrored projection
   * flips the sign, and so does getting the local `z -> SOUTH` axis mapping
   * backwards.
   */
  it("winds every shape CCW-outward in map world space, under every projection handedness", () => {
    const flat = glyphMapEquirectangular({ exaggeration: 30 });
    const globe = glyphMapGlobe({ radius: 1, exaggeration: 30 });
    const mirrored: GlyphMapProjection = {
      ...flat,
      id: "mirrored-equirectangular",
      project(lon, lat, elev) {
        const p = flat.project(lon, lat, elev);
        return [p[0], -p[1], p[2]];
      },
      unproject(p) {
        return flat.unproject([p[0], -p[1], p[2]]);
      },
    };
    for (const [name, projection] of [["flat", flat], ["globe", globe], ["mirrored", mirrored]] as const) {
      for (const shape of MAP_MODEL_SHAPES) {
        const faces = buildGlyphMapModelPolygons(projection, ZERMATT[0], ZERMATT[1], { shape, heightM: 200_000, halfWidthDeg: 0.4, color: "#38bdf8" });
        expect(signedVolume(faces), `${name}/${shape}`).toBeGreaterThan(0);
      }
    }
  });

  /**
   * Winding, for every offered shape rather than only the default: the
   * registry's solids each have their own vertex order, and this file maps
   * their local axes onto (east, south, up) — a mapping that reverses the
   * handedness if it gets the sign wrong, which paints nothing at all.
   */
  it("paints ink for EVERY offered shape on a flat sheet", () => {
    const projection = glyphMapEquirectangular({ exaggeration: 30 });
    for (const shape of MAP_MODEL_SHAPES) {
      const faces = buildGlyphMapModelPolygons(projection, ZERMATT[0], ZERMATT[1], { shape, heightM: 200_000, halfWidthDeg: 0.4, color: "#38bdf8" });
      const { map, teardown } = mount(projection, ZERMATT, 6, faces);
      try {
        const at = map.project(ZERMATT);
        expect(inkIn(map.scene.output.textContent ?? "", at.col, at.row, 3), shape).toBeGreaterThan(0);
      } finally { teardown(); }
    }
  });

  it("paints ink at the anchored place on a FLAT sheet, and nowhere else", async () => {
    const projection = glyphMapEquirectangular({ exaggeration: 30 });
    const faces = buildGlyphMapModelPolygons(projection, ZERMATT[0], ZERMATT[1], { heightM: 200_000, halfWidthDeg: 0.4, color: "#38bdf8" });
    const { map, teardown } = mount(projection, ZERMATT, 6, faces);
    try {
      const at = map.project(ZERMATT);
      const away = map.project([ZERMATT[0], ZERMATT[1] - 2]);
      expect(Math.round(at.row)).not.toBe(Math.round(away.row));
      expect(inkIn(map.scene.output.textContent ?? "", at.col, at.row, 3)).toBeGreaterThan(0);
      expect(inkIn(map.scene.output.textContent ?? "", away.col, away.row, 1)).toBe(0);
    } finally { teardown(); }
  });

  /**
   * The handedness gate. `glyphMapGlobe`'s frame is the mirror of the flat
   * sheet's for `east x north`, so the base ring built for one is
   * back-facing on the other — a hardcoded winding renders exactly zero ink
   * here while still passing the flat test above.
   */
  it("paints ink at the anchored place on the GLOBE too — the winding is probed, not assumed", () => {
    const projection = glyphMapGlobe({ radius: 1, exaggeration: 30 });
    const faces = buildGlyphMapModelPolygons(projection, ZERMATT[0], ZERMATT[1], { heightM: 400_000, halfWidthDeg: 1.5, color: "#38bdf8" });
    const { map, teardown } = mount(projection, ZERMATT, 40, faces);
    try {
      const at = map.project(ZERMATT);
      expect(at.visible).toBe(true);
      expect(inkIn(map.scene.output.textContent ?? "", at.col, at.row, 4)).toBeGreaterThan(0);
    } finally { teardown(); }
  });

  /**
   * The probe's own gate. All three SHIPPED projections put `east x north`
   * along their own up, so none of them exercises the reversal — but
   * `glyphMapFromD3Raw` accepts an arbitrary raw projection and a mirrored
   * one flips that sign. Mirroring the east/west axis of a real projection
   * is the smallest faithful stand-in, and it renders nothing at all if the
   * winding is assumed rather than probed.
   */
  it("follows a MIRRORED projection's own handedness — the case no shipped projection exercises", () => {
    const base = glyphMapEquirectangular({ exaggeration: 30 });
    const mirrored: GlyphMapProjection = {
      ...base,
      id: "mirrored-equirectangular",
      project(lon, lat, elev) {
        const p = base.project(lon, lat, elev);
        return [p[0], -p[1], p[2]];
      },
      unproject(p) {
        return base.unproject([p[0], -p[1], p[2]]);
      },
    };
    const faces = buildGlyphMapModelPolygons(mirrored, ZERMATT[0], ZERMATT[1], { heightM: 200_000, halfWidthDeg: 0.4, color: "#38bdf8" });
    const { map, teardown } = mount(mirrored, ZERMATT, 6, faces);
    try {
      const at = map.project(ZERMATT);
      expect(inkIn(map.scene.output.textContent ?? "", at.col, at.row, 3)).toBeGreaterThan(0);
    } finally { teardown(); }
  });

  it("is culled, not clamped, where the projection has no valid answer", () => {
    // Orthographic's far hemisphere: `project` returns NaN there.
    const projection = glyphMapGlobe({ radius: 1 });
    const near = buildGlyphMapModelPolygons(projection, 0, 0, { heightM: 100_000, halfWidthDeg: 1 });
    expect(near).toHaveLength(5);
    const broken: GlyphMapProjection = { ...projection, project: () => [NaN, NaN, NaN] };
    expect(buildGlyphMapModelPolygons(broken, 0, 0, { heightM: 100_000, halfWidthDeg: 1 })).toHaveLength(0);
  });
});
