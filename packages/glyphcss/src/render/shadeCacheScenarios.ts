/**
 * Shade-cache scenarios whose full rendered HTML (colour included) is pinned
 * against goldens captured from the pre-dense-storage rasterizer. The scenarios
 * only touch the cache through `api`, so one body runs against both shapes.
 */
import { createHash } from "node:crypto";
import type { Polygon } from "@glyphcss/core";
import { createGlyphOrthographicCamera } from "../api/createGlyphCamera";
import { buildRasterizeContext } from "../api/rasterizeContext";
import { rasterize } from "./rasterize";

export interface ScenarioCache { journal?: number[] }
export interface ScenarioApi<C extends ScenarioCache> {
  /** An empty cache with room for `triangles` slots, journaling. */
  make(triangles: number): C;
  /** Undo one journaled slot. */
  undo(cache: C, t: number): void;
}

const COLORS = ["#cc3322", "#22aa44", "#3355dd", "#ddcc22", "#aa22aa"];

function quads(cols: number, rows: number): Polygon[] {
  const out: Polygon[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = (c - cols / 2) * 0.25;
      const y = (r - rows / 2) * 0.25;
      out.push({
        vertices: [[x, y, 0], [x, y + 0.25, 0], [x + 0.25, y + 0.25, 0], [x + 0.25, y, 0]],
        color: COLORS[(c + r * 3) % COLORS.length]!,
        shadingNormal: [Math.sin(c * 0.7) * 0.5, Math.cos(r * 0.9) * 0.5, 1],
      });
    }
  }
  return out;
}

type Light = { direction: [number, number, number]; intensity: number };

function render(
  polygons: Polygon[], cache: unknown, o: { zoom?: number; light?: Light; ambient?: number; rot?: [number, number] } = {},
): string {
  const ctx = buildRasterizeContext({
    camera: createGlyphOrthographicCamera({ rotX: o.rot?.[0] ?? 40, rotY: o.rot?.[1] ?? 20, zoom: o.zoom ?? 70 }),
    grid: { cols: 48, rows: 26, cellAspect: 2 },
    polygons,
    mode: "solid",
    useColors: true,
    doubleSided: true,
    directionalLight: o.light ?? { direction: [0.3, 0.4, 0.86], intensity: 0.8 },
    ambientLight: { intensity: o.ambient ?? 0.3 },
  });
  (ctx as { shadeCache?: unknown }).shadeCache = cache;
  return rasterize(ctx);
}

const hash = (s: string) => createHash("sha256").update(s).digest("hex");
const tri = (x: number, normal: [number, number, number], hidden = false): Polygon => ({
  vertices: [[x, -0.8, 0], [x + 0.8, -0.8, 0], [x, 0.8, 0]],
  color: "#aaaaaa",
  shadingNormal: normal,
  ...(hidden ? { hidden: true } : {}),
});

export function runScenarios<C extends ScenarioCache>(api: ScenarioApi<C>): Record<string, string> {
  const out: Record<string, string> = {};
  const polys = quads(36, 18);
  const total = polys.reduce((n, p) => n + p.vertices.length - 2, 0);

  out.none = hash(render(polys, null));
  const warmCache = api.make(total);
  out.cold = hash(render(polys, warmCache));
  out.warm = hash(render(polys, warmCache));
  out.warmZoomed = hash(render(polys, warmCache, { zoom: 95 }));
  out.noneZoomed = hash(render(polys, null, { zoom: 95 }));

  // Partially warm: only the leading polygons were ever shaded.
  const partial = api.make(total);
  render(polys.slice(0, 200), partial);
  out.partialWarm = hash(render(polys, partial));
  out.partialWarmAgain = hash(render(polys, partial, { rot: [55, 33] }));

  // A stored NaN intensity is a populated entry, not an empty one.
  const nanLight: Light = { direction: [0, 0, 1], intensity: Infinity };
  const nanA = tri(-0.9, [1, 0, 0]);
  const nanB = tri(0.1, [0, 0, 1]);
  const nanPolys = (hiddenB: boolean) => [nanA, { ...nanB, ...(hiddenB ? { hidden: true } : {}) }];
  const nanCache = api.make(2);
  out.nanFrame1 = hash(render(nanPolys(true), nanCache, { light: nanLight, ambient: 1 }));
  out.nanFrame2 = hash(render(nanPolys(false), nanCache, { light: nanLight, ambient: 1 }));

  // NaN entry survives a rolled-back later pass.
  const rb = api.make(2);
  render(nanPolys(true), rb, { light: nanLight, ambient: 1 });
  rb.journal!.length = 0;
  render(nanPolys(false), rb, { light: nanLight, ambient: 1 });
  for (let i = rb.journal!.length - 1; i >= 0; i--) api.undo(rb, rb.journal![i]!);
  rb.journal!.length = 0;
  out.nanAfterRollback = hash(render(nanPolys(false), rb, { light: nanLight, ambient: 1 }));

  // Two same-colour triangles whose intensities share one 8-bit bucket but
  // differ unquantized: which one arrives first decides the bucket's colour.
  const lamb = (l: number): [number, number, number] => [l, 0, Math.sqrt(1 - l * l)];
  const bucketLight: Light = { direction: [1, 0, 0], intensity: 1 };
  const white = (p: Polygon): Polygon => ({ ...p, color: "#ffffff" });
  const lo = white(tri(-0.9, lamb(0.4080)));
  const hi = white(tri(0.1, lamb(0.4117)));
  const opts = { light: bucketLight, ambient: 0.1 };
  out.bucketLoFirst = hash(render([lo, hi], null, opts));
  out.bucketHiFirst = hash(render([hi, lo], null, opts));
  const arrival = api.make(2);
  render([{ ...lo, hidden: true }, hi], arrival, opts);
  out.bucketHiWarmThenLo = hash(render([lo, hi], arrival, opts));
  return out;
}
