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
import { describe, expect, it } from "vitest";
import type { Polygon, Vec3 } from "@glyphcss/core";
import { createGlyphOrthographicCamera } from "../api/createGlyphCamera";
import { buildRasterizeContext } from "../api/rasterizeContext";
import { rasterize } from "./rasterize";

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
