/** Real ETOPO1/Natural Earth provider data for the reported zero-tilt view.
 * The eastern half includes distinct African borders/coasts compressed at
 * the limb; screen adjacency there must not manufacture staircase rungs.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, it, vi } from "vitest";
import { createGlyphMap } from "./widget";
import { glyphMapGlobe } from "./projection";
import { glyphMapDecodeGeoTileInt16 } from "./tile";
import { glyphMapDecodeVectorTile } from "./vector/tile";
import type { GlyphMapProviderZoomLevel } from "./provider";
import * as strokes from "./stroke";

it.each([true, false])(
  "north Brazil: preserves surface verdicts and never borrows a parallel path's staircase (terrain=%s)",
  async (terrainOn) => {
    const root = path.resolve(__dirname, "../fixtures/north-brazil");
    const coarse = path.resolve(__dirname, "../fixtures/border-lod");
    const manifest = JSON.parse(readFileSync(path.join(root, "manifest.json"), "utf8"));
    const zooms = manifest.zooms as GlyphMapProviderZoomLevel[];
    const bounds = (z: number, x: number, y: number) => {
      const l = zooms[z]!;
      const west = -180 + x * l.tileLonSpan,
        north = 90 - y * l.tileLatSpan;
      return { west, east: west + l.tileLonSpan, north, south: north - l.tileLatSpan };
    };
    const loaded = new Set<string>();
    const terrain = {
      id: "terrain",
      zooms,
      bounds,
      async loadTile(z: number, x: number, y: number) {
        loaded.add(`t${z}/${x}_${y}`);
        const file = z < 2 ? path.join(coarse, `terrain/${z}/${x}_${y}.bin`) : path.join(root, `terrain/${x}_${y}.bin`);
        return glyphMapDecodeGeoTileInt16(readFileSync(file), {
          bounds: bounds(z, x, y),
          cols: 180,
          rows: 90,
          source: "etopo1",
          sampler: "nearest",
        });
      },
    };
    const borders = {
      id: "borders",
      zooms: [zooms[2]!],
      bounds,
      async loadTile(z: number, x: number, y: number) {
        loaded.add(`b${z}/${x}_${y}`);
        return glyphMapDecodeVectorTile(JSON.parse(readFileSync(path.join(root, `borders/${x}_${y}.json`), "utf8")));
      },
    };
    const host = document.createElement("div");
    document.body.append(host);
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
      const e = this as HTMLElement,
        k = (parseFloat(e.style.fontSize) || 16) / 16;
      const probe = e.tagName === "PRE" && e.style.visibility === "hidden";
      const width = e === host ? 1668 : probe ? 12 * k : 0;
      const height = e === host ? 1078 : probe ? 14 * k * (e.textContent ?? "").split("\n").length : 0;
      return { width, height, top: 0, left: 0, right: width, bottom: height, x: 0, y: 0, toJSON: () => ({}) };
    });
    // p3x6-wiwaoy6-h6z89s37j5t10E1O338c, decoded once. Snap stays off
    // to reproduce the original sampling phase while diagnosing the borders.
    const map = createGlyphMap(host, {
      view: { center: [-54.629376, -28.879065], span: 131.6964956743487, cols: 139, rows: 77 },
      projection: glyphMapGlobe({ exaggeration: 24 }),
      tilt: 0,
      layers: terrainOn ? [{ type: "raster", id: "terrain", source: terrain }] : [],
    });
    try {
      await map.idle();
      let graph: strokes.GlyphMapBoxStrokeGraph | undefined, frameGraph: unknown;
      let surface: Float64Array;
      let chars: string[] = [];
      const expected = new Set<number>();
      const stamp = strokes.stampGlyphMapPolyline,
        finish = strokes.finishGlyphMapBoxStrokeGraph;
      vi.spyOn(strokes, "stampGlyphMapPolyline").mockImplementation((g, points, opts) => {
        if (frameGraph !== opts?.boxGraph) {
          frameGraph = opts?.boxGraph;
          surface = g.depth.slice();
          expected.clear();
        }
        // Each arc independently tests the original terrain. This oracle
        // cannot inherit a previous border's non-integer depth sample.
        const clone = { ...g, char: [...g.char], color: [...g.color], depth: surface.slice() };
        stamp(clone, points, {
          ...opts,
          boxGraph: strokes.createGlyphMapBoxStrokeGraph(),
          onInk: (i) => expected.add(i),
        });
        stamp(g, points, opts);
      });
      let acceptedBeforeCorners = new Set<number>();
      vi.spyOn(strokes, "finishGlyphMapBoxStrokeGraph").mockImplementation((g, gr) => {
        acceptedBeforeCorners = new Set(gr.samples.keys());
        finish(g, gr);
        graph = gr;
        chars = [...g.char];
      });
      map.addLayer({
        type: "line",
        source: borders,
        sharedArcs: true,
        simplify: "vw",
        experimentalGlyphStrategy: "box",
        color: "#e8c988",
      });
      await map.idle();
      expect(loaded.has("b2/1_1")).toBe(true);
      expect(loaded.has("b2/2_2")).toBe(true);
      if (terrainOn) expect(loaded.has("t2/1_1")).toBe(true);
      expect(expected.size).toBeGreaterThan(800);
      expect(acceptedBeforeCorners).toEqual(expected);
      expect(graph!.paths.length).toBeGreaterThan(100);
      // Venezuela's formerly missing cells are surface strokes, not relief
      // hidden by a foreground mountain. Both survive the real terrain.
      expect(chars[4 * 139 + 61]).toBe("─");
      expect(chars[5 * 139 + 62]).toBe("└");
      // A shared-arc path over a genuinely separate line in the right half
      // used its occupied cell as a corner, turning this elbow into a cross.
      expect(chars[3 * 139 + 114]).toBe("└");
      map.setSnapPan(true);
      await map.idle();
      const picture = map.scene.output.textContent;
      expect(picture).toMatch(/[─│┌┐└┘]/);
      const held = map.getView().center;
      map.setView({ center: [held[0] + 1e-5, held[1] + 1e-5] });
      await map.idle();
      expect(map.getView().center).toEqual([held[0] + 1e-5, held[1] + 1e-5]);
      expect(map.scene.output.textContent).toBe(picture);
    } finally {
      map.destroy();
      host.remove();
      vi.restoreAllMocks();
    }
  },
);
