/**
 * An OSM row's colour OVERRIDE has to reach the RENDER, not just the built
 * layer object.
 *
 * `openmaptiles.test.ts`'s override clause asserts `built[1].color`, and that
 * property was right the whole time — three rows (`omt-landcover`,
 * `omt-landuse`, `omt-water`) also carry a stock CLASS PALETTE
 * (`colorProperty: "class"` plus `colors`), and the widget's fill runtime
 * prefers `layer.colors[feature.class]` over `layer.color` for exactly the
 * features that palette recognises. So asking for `#123456` water and getting
 * a lake painted `#2c5c8f` was invisible to a property assertion by
 * construction: the override was present, correct and unread.
 *
 * The fix is in the BUILDER, not the widget: `layer.colors` is the row's stock
 * classification, and a caller who names one colour for the row has replaced
 * the classification, not asked to have it applied on top. The widget's
 * preference order is right for a row that kept its palette, and every layer
 * built without a `colors` override is byte-identical.
 *
 * The assertion is on rendered `<pre>` cells rather than on the layer, because
 * that is the thing the property assertion could not see. Only the fallback
 * (an UNRECOGNISED class) ever rendered the override before, so this test
 * paints a `lake` — a class the palette holds.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createGlyphMap } from "../widget";
import { glyphMapGlobe } from "../projection";
import { GLYPH_MAP_OPENMAPTILES_WATER_COLORS, glyphMapOpenMapTilesLayers } from "./openmaptiles";
import type { GlyphMapVectorFeature } from "./types";

const COLS = 80, ROWS = 40, CELL_W = 8, CELL_H = 16, BASE_FONT_PX = 16;
const AT: readonly [number, number] = [8.5, 47.4];
const OVERRIDE = "#123456";

const rect = (w: number, h: number) =>
  ({ width: w, height: h, top: 0, left: 0, right: w, bottom: h, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
const EMPTY_RECT = rect(0, 0);
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

afterEach(() => {
  vi.restoreAllMocks();
  stubbedHosts.clear();
  document.body.innerHTML = "";
});

/** A lake — `class: "lake"` is a key the row's stock water palette holds. */
const lake: GlyphMapVectorFeature = {
  id: "lake",
  geometryType: "polygon",
  rings: [[
    [AT[0] - 0.2, AT[1] - 0.2],
    [AT[0] + 0.2, AT[1] - 0.2],
    [AT[0] + 0.2, AT[1] + 0.2],
    [AT[0] - 0.2, AT[1] + 0.2],
    [AT[0] - 0.2, AT[1] - 0.2],
  ]],
  properties: { class: "lake" },
};

/** Every distinct `#rrggbb` the rendered `<pre>` paints. */
function renderedColors(pre: HTMLElement): Set<string> {
  const out = new Set<string>();
  for (const node of Array.from(pre.childNodes)) {
    if (node.nodeType !== 1) continue;
    const m = /color:\s*(#[0-9a-fA-F]{6})/.exec((node as HTMLElement).getAttribute("style") ?? "");
    if (m && (node.textContent ?? "").trim() !== "") out.add(m[1].toLowerCase());
  }
  return out;
}

function render(colors?: Record<string, string>): Set<string> {
  const host = document.createElement("div");
  document.body.appendChild(host);
  stubMonospaceMetrics(host);
  const built = glyphMapOpenMapTilesLayers({ features: [lake] }, {
    include: ["omt-water"],
    ...(colors ? { colors } : {}),
  });
  const map = createGlyphMap(host, {
    projection: glyphMapGlobe(),
    view: { center: [AT[0], AT[1]] as [number, number], span: 1.2, cols: COLS, rows: ROWS },
    layers: [...built] as Parameters<typeof createGlyphMap>[1]["layers"],
  });
  map.scene.rerender();
  const out = renderedColors(map.scene.output);
  map.destroy();
  host.remove();
  return out;
}

describe("glyphMapOpenMapTilesLayers — a colour override reaches the rendered cells", () => {
  it("paints a recognised class in the override, not in the row's stock palette", () => {
    const stock = render();
    // Premise: with no override the lake really is painted from the class
    // palette, so the clause below cannot pass on a lake that never drew.
    expect(stock.has(GLYPH_MAP_OPENMAPTILES_WATER_COLORS.lake!.toLowerCase())).toBe(true);

    const overridden = render({ "omt-water": OVERRIDE });
    expect(overridden.has(OVERRIDE)).toBe(true);
    expect(overridden.has(GLYPH_MAP_OPENMAPTILES_WATER_COLORS.lake!.toLowerCase())).toBe(false);
  });

  it("leaves the stock palette in place for every row nobody overrode", () => {
    // Byte-identical: an override on ONE row must not strip another's
    // classification, and a builder with no `colors` at all is unchanged.
    const built = glyphMapOpenMapTilesLayers({ features: [lake] }, {
      include: ["omt-water", "omt-landuse"],
      colors: { "omt-water": OVERRIDE },
    });
    const water = built[0] as { colors?: Record<string, string>; colorProperty?: string; color?: string };
    const landuse = built[1] as { colors?: Record<string, string>; colorProperty?: string };
    expect(water.color).toBe(OVERRIDE);
    expect(water.colors).toBeUndefined();
    expect(water.colorProperty).toBeUndefined();
    expect(landuse.colors).toBeDefined();
    expect(landuse.colorProperty).toBe("class");
  });
});
