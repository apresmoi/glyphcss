/**
 * `Polygon.shadingNormal` — an authored shading normal replacing the one a
 * face's own vertices imply.
 *
 * It exists for a face whose PLANE is not the surface it stands for: a
 * near-collinear sliver produced by triangulating a curved region in a flat
 * parameter space has a circumcircle centre tens of degrees away, so its
 * geometric normal is up to 90 degrees off the real one and shading by it
 * lights a legitimate piece of surface as if lit from inside. Without this
 * the only alternative is to drop the face and leave a hole, which is what
 * `@glyphcss/maps` used to do and what drew cracks in the open sea
 * (`packages/maps/src/widget.fillCrack.test.ts`).
 *
 * It is LIGHTING only. Visibility stays the projected-winding back-face
 * verdict, so a face cannot be made visible or invisible by what it claims
 * its normal is.
 */
import { afterEach, describe, expect, it } from "vitest";
import type { Polygon, Vec3 } from "@glyphcss/core";
import { createGlyphOrthographicCamera } from "../api/createGlyphCamera";
import { buildRasterizeContext } from "../api/rasterizeContext";
import { createGlyphScene } from "../api/createGlyphScene";
import { rasterize, rasterizeToCells } from "./rasterize";

const LIGHT: Vec3 = [0, 0, 1];

function render(polygons: Polygon[]): string {
  return rasterize(buildRasterizeContext({
    camera: createGlyphOrthographicCamera({ rotX: 0, rotY: 0, zoom: 60 }),
    grid: { cols: 24, rows: 12, cellAspect: 2 },
    polygons,
    mode: "solid",
    useColors: false,
    directionalLight: { direction: LIGHT, intensity: 1 },
    ambientLight: { intensity: 0.4 },
  }));
}

/** A quad in the XY plane, so its own geometric normal is +Z — straight at the light. */
function quad(shadingNormal?: Vec3): Polygon[] {
  const p: Polygon = {
    vertices: [[-1, -1, 0], [1, -1, 0], [1, 1, 0], [-1, 1, 0]],
    color: "#ffffff",
  };
  if (shadingNormal) p.shadingNormal = shadingNormal;
  return [p];
}

const ink = (text: string): string => text.replace(/[\s\n]/g, "");

describe("Polygon.shadingNormal", () => {
  it("is byte-identical when absent", () => {
    // The whole no-op contract: nothing about the field's existence may move a
    // render that does not use it.
    expect(render(quad())).toBe(render(quad()));
    // ...and authoring the geometric normal itself changes nothing either.
    expect(render(quad([0, 0, 1]))).toBe(render(quad()));
  });

  it("shades by the authored normal, not the face's own plane", () => {
    // Face-on to the light the quad is at full Lambert; turned 90 degrees away
    // by its authored normal alone — the geometry does not move — it drops to
    // the ambient term, which is a real glyph rather than a blank, so the
    // comparison is about the GLYPH and not about coverage.
    const lit = render(quad([0, 0, 1]));
    const edgeOn = render(quad([0, 1, 0]));
    expect(ink(lit).length).toBeGreaterThan(0);
    expect(new Set(ink(lit))).toEqual(new Set(["@"]));
    // Same COVERAGE, different glyph: the face is still drawn, just darker.
    expect(ink(edgeOn).length).toBe(ink(lit).length);
    expect(ink(edgeOn)).not.toBe(ink(lit));
  });

  it("does not decide visibility — an inward authored normal is still drawn", () => {
    // A back-facing authored normal would blank the face if the rasterizer
    // culled on it; it must only darken it.
    const inward = render(quad([0, 0, -1]));
    expect(ink(inward).length).toBe(ink(render(quad())).length);
  });

  it("falls back to the geometric normal for a degenerate or non-finite value", () => {
    const base = render(quad());
    expect(render(quad([0, 0, 0]))).toBe(base);
    expect(render(quad([NaN, 0, 1]))).toBe(base);
  });
});

/**
 * A mesh TRANSFORM moves the surface, so it moves the surface's normal —
 * including an authored one. The field's own contract says it replaces "the
 * geometric one this polygon's own vertices imply", and the implied one
 * rotates with the mesh; leaving the authored one in the authoring frame
 * lights a rotated face as if it had never turned.
 *
 * Rendered rather than asserted on the vector, because lighting is the only
 * thing the field does: a quad in the XY plane under a light along +Y is at
 * ambient when its normal is +Z and fully lit when it is +Y, and the two
 * glyphs are far apart on the ramp.
 */
describe("Polygon.shadingNormal under a mesh transform", () => {
  afterEach(() => { document.body.innerHTML = ""; });

  /** One base-grid render of `polygons` placed with `transform`. */
  function scene(polygons: Polygon[], transform: { rotation?: Vec3; scale?: number | Vec3 } = {}): string {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const s = createGlyphScene(host, {
      cols: 24, rows: 12, mode: "solid", useColors: false,
      camera: createGlyphOrthographicCamera({ rotX: 0, rotY: 0, zoom: 60 }),
      // Along +Y, so a +Z normal is edge-on (ambient) and a +Y one is full.
      directionalLight: { direction: [0, 1, 0], intensity: 1 },
      ambientLight: { intensity: 0.4 },
    });
    s.add(polygons, transform);
    s.rerender();
    const out = s.output.textContent ?? "";
    s.destroy(); host.remove();
    return out;
  }

  it("rotates the authored normal with the mesh", () => {
    // +Y authored, then turned 90 degrees about Z: the normal must end up
    // along -X, i.e. edge-on to the light, exactly as if it had been authored
    // that way on an unrotated mesh.
    const turned = scene(quad([0, 1, 0]), { rotation: [0, 0, 90] });
    expect(turned).toBe(scene(quad([-1, 0, 0])));
    // The premise: the two ends of that comparison really are different
    // renders, so the equality above cannot pass by both being the same thing.
    expect(turned).not.toBe(scene(quad([0, 1, 0])));
    // ...and it agrees with what the mesh's own GEOMETRY says after the same
    // rotation, which is the definition the field's doc appeals to.
    const geometric = [{ vertices: quad()[0]!.vertices, color: "#ffffff" }] as Polygon[];
    expect(scene(quad([0, 0, 1]), { rotation: [0, 0, 90] })).toBe(scene(geometric, { rotation: [0, 0, 90] }));
  });

  it("is unmoved by a uniform scale, and inverse-transposed under a non-uniform one", () => {
    // A scale changes the mesh's COVERAGE too, so compare the GLYPHS the flat
    // quad is shaded with rather than the whole render (one quad, one Lambert
    // term — but the solid ramp dithers between two glyphs at intermediate
    // intensities, so it is a set, not a single character).
    const glyphOf = (out: string) => {
      const set = [...new Set(ink(out))].sort().join("");
      expect(set.length).toBeGreaterThan(0);
      return set;
    };
    // A uniform scale cannot turn a normal.
    expect(glyphOf(scene(quad([0, 1, 0]), { scale: 2 }))).toBe(glyphOf(scene(quad([0, 1, 0]))));
    // A non-uniform one turns it the INVERSE-TRANSPOSE way: flattening Y by 10
    // makes a normal authored shallow in the XY plane lean TOWARD Y — the
    // opposite of what transforming it like a point does. All three candidate
    // answers are pinned, so neither leaving the normal alone nor scaling it
    // like a point can pass: (1, 0.2, 0) under a 10x Y flatten becomes
    // (1, 2, 0) if inverse-transposed, stays (1, 0.2, 0) if ignored, and
    // becomes (1, 0.02, 0) if treated as a point.
    const squashed = glyphOf(scene(quad([1, 0.2, 0]), { scale: [1, 0.1, 1] }));
    expect(squashed).toBe(glyphOf(scene(quad([1, 2, 0]))));
    expect(squashed).not.toBe(glyphOf(scene(quad([1, 0.2, 0]))));
    expect(squashed).not.toBe(glyphOf(scene(quad([1, 0.02, 0]))));
  });

  it("leaves an untransformed mesh byte-identical", () => {
    expect(scene(quad([0, 1, 0]), {})).toBe(scene(quad([0, 1, 0])));
  });
});

/**
 * WHERE the authored normal reaches, pinned so the contract cannot drift
 * silently. It is the SHADING normal, so it is what the retained `normal`
 * buffer carries — the `normal` effect input and the control tensor's normal
 * channels read that buffer, and for the consumer this field exists for the
 * authored vector IS the surface's normal while the face's own plane is not.
 * `objectNormal` is the counter-case: it is built from the polygon's
 * pre-transform vertices by cross product and stays GEOMETRIC.
 */
describe("Polygon.shadingNormal in the retained buffers", () => {
  function cells(polygons: Polygon[]) {
    return rasterizeToCells(buildRasterizeContext({
      camera: createGlyphOrthographicCamera({ rotX: 0, rotY: 0, zoom: 60 }),
      grid: { cols: 24, rows: 12, cellAspect: 2 },
      polygons,
      mode: "solid",
      useColors: false,
      retainNormal: true,
      retainObjectNormal: true,
      directionalLight: { direction: LIGHT, intensity: 1 },
      ambientLight: { intensity: 0.4 },
    }));
  }

  /** The first covered cell's vector out of an interleaved xyz buffer. */
  function firstVector(grid: ReturnType<typeof cells>, buf: Float32Array): [number, number, number] {
    for (let i = 0; i < grid.cols * grid.rows; i++) {
      if (Number.isFinite(grid.depth[i]!)) return [buf[i * 3]!, buf[i * 3 + 1]!, buf[i * 3 + 2]!];
    }
    throw new Error("nothing covered");
  }

  it("CellGrid.normal carries the authored vector", () => {
    const authored = cells(quad([0, 1, 0]));
    expect(firstVector(authored, authored.normal!)).toEqual([0, 1, 0]);
    // The premise: without one, the same fixture reports its geometry (+Z).
    const geometric = cells(quad());
    expect(firstVector(geometric, geometric.normal!)).toEqual([0, 0, 1]);
  });

  it("CellGrid.objectNormal stays geometric", () => {
    const authored = cells(quad([0, 1, 0]));
    expect(firstVector(authored, authored.objectNormal!)).toEqual([0, 0, 1]);
  });
});
