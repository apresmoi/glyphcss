/**
 * The facade and per-feature colour, end to end through the real widget and the
 * real rasterizer — not the mesh builder in isolation, because the whole claim
 * is about what a STREET LOOKS LIKE and every link in that chain can silently
 * drop it: the layer option has to reach `glyphMapVectorMesh`, the generated
 * pixels have to reach the scene (they are never fetched — see
 * `glyphMapFacadeTexture`), and the rasterizer has to honour `repeat` rather
 * than clamp every wall onto one texel.
 *
 * The load-bearing assertion is on GLYPHS, not colours: glyphcss folds a texel's
 * luminance into the character, so a facade that only tinted cells would be a
 * failure — the window rhythm has to survive a monochrome render.
 *
 * happy-dom has no layout, hence `stubMonospaceMetrics`.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createGlyphMap, type GlyphMapFillExtrusionLayer } from "./widget";
import { glyphMapGlobe } from "./projection";
import { GLYPH_MAP_FACADE_TEXTURE } from "./facade";
import type { GlyphMapVectorFeature } from "./vector/types";

const COLS = 140;
const ROWS = 63;
const CELL_W = 8;
const CELL_H = 16;
const BASE_FONT_PX = 16;
/** Oblique enough that the walls, not the roofs, are most of the ink. */
const TILT = 62;
const CENTRE: readonly [number, number] = [8.54, 47.375];
const SPAN = 0.004;
/** A mid-rise block: 24 m is 7 floors of 3.2 m, so the facade has something to say. */
const BUILDING_M = 24;
const BUILDING_COLOR = "#94a3b8";

const EMPTY_RECT = { width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
const rect = (width: number, height: number): DOMRect =>
  ({ width, height, top: 0, left: 0, right: width, bottom: height, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
const stubbedHosts = new Set<HTMLElement>();

function stubMonospaceMetrics(host: HTMLElement): void {
  stubbedHosts.add(host);
  if (vi.isMockFunction(Element.prototype.getBoundingClientRect)) return;
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const el = this as HTMLElement;
    if (stubbedHosts.has(el)) return rect(COLS * CELL_W, ROWS * CELL_H);
    if (el.tagName !== "PRE" || !/visibility:\s*hidden/.test(el.style.cssText)) return EMPTY_RECT;
    const fontPx = parseFloat(/font-size:\s*([\d.]+)px/.exec(el.style.cssText)?.[1] ?? String(BASE_FONT_PX));
    const k = fontPx / BASE_FONT_PX;
    const lines = (el.textContent ?? "").split("\n").length || 1;
    return rect(CELL_W * k, CELL_H * k * lines);
  });
}

const mounted: { destroy(): void }[] = [];
const hostsToRemove: HTMLElement[] = [];
afterEach(() => {
  for (const m of mounted.splice(0)) m.destroy();
  for (const h of hostsToRemove.splice(0)) h.remove();
  vi.restoreAllMocks();
  stubbedHosts.clear();
  document.body.innerHTML = "";
});

/** A row of adjacent blocks along a street, each ~36 m x 22 m. */
function blocks(): GlyphMapVectorFeature[] {
  const out: GlyphMapVectorFeature[] = [];
  const w = 0.00048, h = 0.0003;
  for (let i = -3; i <= 3; i++) {
    for (const side of [-1, 1]) {
      const lon = CENTRE[0] + i * (w + 0.00006);
      const lat = CENTRE[1] + side * 0.0005;
      const ring: [number, number][] = [
        [lon, lat], [lon + w, lat], [lon + w, lat + h], [lon, lat + h], [lon, lat],
      ];
      out.push({
        id: `b${i}_${side}`,
        geometryType: "polygon",
        properties: { height: BUILDING_M },
        rings: [ring],
        polygons: [[ring]],
      });
    }
  }
  return out;
}

const FEATURES = blocks();

function mount(extra: Partial<GlyphMapFillExtrusionLayer>) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  hostsToRemove.push(host);
  stubMonospaceMetrics(host);
  const map = createGlyphMap(host, {
    view: { center: [CENTRE[0], CENTRE[1]], span: SPAN, cols: COLS, rows: ROWS },
    projection: glyphMapGlobe({ exaggeration: 1 }),
    tilt: TILT,
  });
  mounted.push(map);
  map.addLayer({
    type: "fill-extrusion",
    id: "buildings",
    color: BUILDING_COLOR,
    source: { features: FEATURES },
    heightProperty: "height",
    ...extra,
  } as GlyphMapFillExtrusionLayer);
  return { host, map };
}

function text(host: HTMLElement): string {
  return Array.from(host.querySelectorAll("pre")).map((pre) => pre.textContent ?? "").join("\n");
}

/** Distinct non-blank characters in the frame. */
function glyphSet(host: HTMLElement): Set<string> {
  return new Set([...text(host)].filter((c) => c !== " " && c !== "\n"));
}

function meanRun(host: HTMLElement): number {
  let runs = 0, total = 0;
  for (const row of text(host).split("\n")) {
    let i = 0;
    while (i < row.length) {
      const c = row[i]!;
      let j = i;
      while (j < row.length && row[j] === c) j++;
      if (c !== " ") { runs++; total += j - i; }
      i = j;
    }
  }
  return runs ? total / runs : 0;
}

function colorSet(host: HTMLElement): Set<string> {
  const html = Array.from(host.querySelectorAll("pre")).map((pre) => pre.innerHTML).join("");
  return new Set([...html.matchAll(/color:\s*(#[0-9a-fA-F]{3,6})/g)].map((m) => m[1]!.toLowerCase()));
}

describe("fill-extrusion facade", () => {
  it("puts more distinct GLYPHS on the same walls", () => {
    const flat = mount({});
    const textured = mount({ facade: true });
    // Same geometry, same camera, same colour, same render mode. The only
    // difference is that a wall quad now carries `uvs` + a tiling texture, and
    // the texel's luminance is folded into the character — so this is a
    // statement about legibility in a monochrome render, not about tinting.
    expect(glyphSet(textured.host).size).toBeGreaterThan(glyphSet(flat.host).size);
  });

  it("changes the frame at all — the texture really reaches the rasterizer", () => {
    // The failure this guards is silent in every intermediate layer: the mesh
    // carries UVs, the scene renders, and nothing samples because the pixels
    // never arrived.
    expect(text(mount({ facade: true }).host)).not.toBe(text(mount({}).host));
  });

  it("replaces the ramp's per-cell dither with real STRUCTURE", () => {
    // The honest legibility claim, and the one the FPV render study warned is
    // easy to fake: a flat wall is one Lambert value, which the solid ramp
    // dithers into `=+=+=+=+=` — maximum transition density, zero information.
    // A facade turns that into RUNS (a pier, a window, a pier), so mean run
    // length is the metric that separates structure from noise. Measured here:
    // 1.83 flat, 2.99 with the facade.
    const flat = meanRun(mount({}).host);
    expect(meanRun(mount({ facade: true }).host)).toBeGreaterThan(flat * 1.3);
  });

  it("forwards the bay/floor rhythm rather than always using the default", () => {
    // That `repeat` itself is honoured is proved directly against the
    // rasterizer (glyphcss's `textureWrap.test.ts`); what has to be true HERE is
    // that a layer's own rhythm reaches the wall UVs. A 1,000 km bay collapses
    // the wall to a single stretched tile, so it cannot render identically.
    const stretched = mount({ facade: { texture: GLYPH_MAP_FACADE_TEXTURE, bayMetres: 1e6, floorMetres: 1e6 } });
    expect(text(stretched.host)).not.toBe(text(mount({ facade: true }).host));
  });

  it("omitting `facade` is byte-identical", () => {
    expect(text(mount({}).host)).toBe(text(mount({ facade: false }).host));
  });

  it("a caller can point the layer at its own texture key", () => {
    // An unregistered key has no pixels, so it renders flat — proving the key is
    // forwarded rather than ignored in favour of the built-in one.
    expect(text(mount({ facade: { texture: "nobody:registered-this" } }).host))
      .toBe(text(mount({}).host));
  });
});

describe("fill-extrusion colorVariation", () => {
  it("separates adjacent buildings into distinct colours", () => {
    const flat = mount({});
    const varied = mount({ colorVariation: 1 });
    expect(colorSet(flat.host).size).toBeGreaterThan(0);
    expect(colorSet(varied.host).size).toBeGreaterThan(colorSet(flat.host).size);
  });

  it("is deterministic — the same map mounted twice paints the same colours", () => {
    expect([...colorSet(mount({ colorVariation: 1 }).host)].sort())
      .toEqual([...colorSet(mount({ colorVariation: 1 }).host)].sort());
  });

  it("omitting it is byte-identical", () => {
    expect(text(mount({}).host)).toBe(text(mount({ colorVariation: 0 }).host));
  });
});
