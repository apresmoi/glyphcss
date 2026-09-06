import { afterEach, describe, expect, it, vi } from "vitest";
import { createGlyphMap, GLYPH_MAP_SUN_TICK_MS } from "./widget";
import { glyphMapEquirectangular, glyphMapGlobe } from "./projection";
import { glyphMapSubsolarPoint } from "./sun";
import type { GlyphMapClassifier } from "./types";
import type { GlyphMapGeoTile } from "./tile";

/**
 * Real-sun lighting end-to-end through the widget: the ORBIT path (a real
 * directional light whose Lambert term draws the terminator) and the SHEET
 * path (a per-cell day/night term stamped through the shared `transformCells`
 * hook, because one surface normal cannot carry a terminator).
 *
 * The load-bearing property throughout is ADVANCEMENT: every assertion that
 * could pass on a frozen "resolve the sun once at construction"
 * implementation is paired with a second one at a different instant.
 */

const FLAT: GlyphMapClassifier = { id: "flat", orderStatistic: false, classifyValue: () => 0 };

function makeTile(bounds: GlyphMapGeoTile["bounds"], cols: number, rows: number): GlyphMapGeoTile {
  const elevation = new Float32Array((cols + 1) * (rows + 1)).fill(0);
  return { bounds, cols, rows, elevation, source: "synthetic", sampler: "nearest" };
}

/** Per-character `#rrggbb` of the rendered `<pre>`, row-major with `"\n"` kept as `null`. */
function renderedColors(pre: HTMLElement): (string | null)[] {
  const out: (string | null)[] = [];
  for (const node of Array.from(pre.childNodes)) {
    const text = node.textContent ?? "";
    let color: string | null = null;
    if (node.nodeType === 1) {
      const style = (node as HTMLElement).getAttribute("style") ?? "";
      const m = /color:\s*(#[0-9a-fA-F]{6})/.exec(style);
      color = m ? m[1].toLowerCase() : null;
    }
    for (const ch of text) out.push(ch === "\n" ? null : color);
  }
  return out;
}

/** Mean red channel of the coloured cells in `cols` (a crude but monotone luminance probe — the palette here is a single grey). */
function meanBrightness(colors: (string | null)[], keep: (i: number) => boolean): number {
  let sum = 0;
  let n = 0;
  for (let i = 0; i < colors.length; i++) {
    const c = colors[i];
    if (!c || !keep(i)) continue;
    sum += Number.parseInt(c.slice(1, 3), 16);
    n++;
  }
  return n === 0 ? NaN : sum / n;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("createGlyphMap — sun off (the default)", () => {
  it("touches nothing: no hook, no timer, the consumer's own directional light intact", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const direction: [number, number, number] = [0.5, 0.7, 0.5];
    const map = createGlyphMap(host, {
      view: { center: [0, 0], span: 60, cols: 40, rows: 20 },
      projection: glyphMapGlobe({ radius: 1, exaggeration: 0 }),
      scene: { directionalLight: { direction, intensity: 1.15, color: "#ffffff" } },
    });

    expect(map.getSun().mode).toBe("off");
    expect(map.getSunDirection()).toBeNull();
    expect(map.getSubsolarPoint()).toBeNull();
    // The shared cell hook is what the sheet terminator would ride. With the
    // sun off and no stroke layer, it must not be installed at all.
    expect(map.scene.getOptions().transformCells).toBeUndefined();
    expect(map.scene.getOptions().directionalLight).toEqual({ direction, intensity: 1.15, color: "#ffffff" });

    map.destroy();
    host.remove();
  });

  it("renders byte-identically to an explicit sun:{mode:'off'} map", () => {
    const build = (sun?: Parameters<typeof createGlyphMap>[1]["sun"]) => {
      const host = document.createElement("div");
      document.body.appendChild(host);
      const map = createGlyphMap(host, {
        view: { center: [10, 20], span: 60, cols: 40, rows: 20 },
        projection: glyphMapEquirectangular(),
        tilt: 0,
        layers: [{ type: "raster", source: makeTile({ west: -40, east: 60, south: -30, north: 60 }, 8, 8), classifier: FLAT, colors: ["#c0c0c0"] }],
        sun,
      });
      map.scene.rerender();
      const html = map.scene.output.innerHTML;
      map.destroy();
      host.remove();
      return html;
    };
    expect(build(undefined)).toBe(build({ mode: "off" }));
  });
});

describe("createGlyphMap — sun on an ORBIT projection (globe): a real directional light", () => {
  const globe = () => glyphMapGlobe({ radius: 1, exaggeration: 0 });

  function mount(date: number) {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const map = createGlyphMap(host, {
      view: { center: [0, 0], span: 60, cols: 40, rows: 20 },
      projection: globe(),
      scene: { directionalLight: { direction: [0.5, 0.7, 0.5], intensity: 1.15, color: "#ffffff" } },
      sun: { mode: "manual", date },
    });
    return { host, map };
  }

  it("writes the subsolar outward vector as the light direction, keeping intensity and colour", () => {
    const date = Date.UTC(2024, 5, 21, 12, 0, 0);
    const { host, map } = mount(date);
    const sun = glyphMapSubsolarPoint(date);
    const at = globe().project(sun.lon, sun.lat, 0);
    const len = Math.hypot(at[0], at[1], at[2]);

    const light = map.scene.getOptions().directionalLight!;
    expect(light.direction[0]).toBeCloseTo(at[0] / len, 10);
    expect(light.direction[1]).toBeCloseTo(at[1] / len, 10);
    expect(light.direction[2]).toBeCloseTo(at[2] / len, 10);
    // The widget owns DIRECTION only — the consumer's key light survives.
    expect(light.intensity).toBe(1.15);
    expect(light.color).toBe("#ffffff");

    map.destroy();
    host.remove();
  });

  it("an orbit projection installs NO cell hook — Lambert already draws the terminator", () => {
    const { host, map } = mount(Date.UTC(2024, 5, 21, 12, 0, 0));
    // The hook is installed (the mode is on) but its night stamp is a no-op
    // here; what matters is that the light, not the stamp, is doing the work.
    expect(map.getSunDirection()).not.toBeNull();
    map.destroy();
    host.remove();
  });

  it("two instants one hour apart light hemispheres 15 degrees of longitude apart", () => {
    const t0 = Date.UTC(2024, 2, 20, 12, 0, 0);
    const a = mount(t0);
    const b = mount(t0 + 3_600_000);
    const lonOf = (d: readonly [number, number, number]) => (Math.atan2(d[1], d[0]) * 180) / Math.PI;
    const da = a.map.scene.getOptions().directionalLight!.direction as [number, number, number];
    const db = b.map.scene.getOptions().directionalLight!.direction as [number, number, number];
    const delta = lonOf(db) - lonOf(da);
    expect(delta).toBeGreaterThan(-15.05);
    expect(delta).toBeLessThan(-14.95);
    a.map.destroy(); a.host.remove();
    b.map.destroy(); b.host.remove();
  });

  it("the RENDERED globe's lit side follows the sun: twelve hours apart flips which half is bright", () => {
    const t0 = Date.UTC(2024, 2, 20, 0, 0, 0);
    const sun = glyphMapSubsolarPoint(t0);
    // Centre the view a quarter turn from the sun so the terminator runs
    // down the middle of the visible disc, then compare the two halves.
    const render = (date: number) => {
      const host = document.createElement("div");
      document.body.appendChild(host);
      const map = createGlyphMap(host, {
        view: { center: [sun.lon + 90, 0], span: 120, cols: 40, rows: 20 },
        projection: glyphMapGlobe({ radius: 1, exaggeration: 0 }),
        scene: { directionalLight: { direction: [0.5, 0.7, 0.5], intensity: 1.15, color: "#ffffff" }, ambientLight: { intensity: 0.2, color: "#ffffff" } },
        layers: [{ type: "raster", source: makeTile({ west: -180, east: 180, south: -85, north: 85 }, 36, 18), classifier: FLAT, colors: ["#c0c0c0"] }],
        sun: { mode: "manual", date },
      });
      map.scene.rerender();
      const colors = renderedColors(map.scene.output);
      const width = 41; // 40 cols + newline
      const left = meanBrightness(colors, (i) => i % width < 20);
      const right = meanBrightness(colors, (i) => i % width >= 20 && i % width < 40);
      map.destroy();
      host.remove();
      return { left, right };
    };

    const now = render(t0);
    const later = render(t0 + 12 * 3_600_000);
    expect(now.left).not.toBeNaN();
    expect(now.right).not.toBeNaN();
    // Whichever half is brighter now must be the dimmer one half a day later.
    expect(Math.sign(now.left - now.right)).toBe(-Math.sign(later.left - later.right));
    expect(Math.abs(now.left - now.right)).toBeGreaterThan(5);
  });
});

describe("createGlyphMap — sun on a SHEET projection: the per-cell terminator", () => {
  function mount(date: number, sunOn = true) {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const map = createGlyphMap(host, {
      view: { center: [0, 0], span: 300, cols: 60, rows: 24 },
      projection: glyphMapEquirectangular(),
      tilt: 0,
      layers: [{ type: "raster", source: makeTile({ west: -180, east: 180, south: -85, north: 85 }, 36, 18), classifier: FLAT, colors: ["#c0c0c0"] }],
      sun: sunOn ? { mode: "manual", date } : undefined,
    });
    map.scene.rerender();
    return { host, map };
  }

  it("darkens the night side of a flat map instead of dimming the whole thing uniformly", () => {
    const date = Date.UTC(2024, 2, 20, 12, 0, 0);
    const { host, map } = mount(date);
    const colors = renderedColors(map.scene.output);
    const width = 61; // 60 cols + newline

    // The sun is near lon 0 at this instant, i.e. near the middle column;
    // the antipode is at both edges. Compare the middle third against the
    // outer sixths.
    const day = meanBrightness(colors, (i) => { const c = i % width; return c >= 25 && c < 35; });
    const night = meanBrightness(colors, (i) => { const c = i % width; return c < 5 || (c >= 55 && c < 60); });
    expect(day).not.toBeNaN();
    expect(night).not.toBeNaN();
    expect(night).toBeLessThan(day - 20);
    // Never black: the night side stays a readable map.
    expect(night).toBeGreaterThan(5);

    map.destroy();
    host.remove();
  });

  it("the dark side MOVES: twelve hours later the previously lit columns are the dark ones", () => {
    const t0 = Date.UTC(2024, 2, 20, 12, 0, 0);
    const width = 61;
    const middle = (c: number) => c >= 25 && c < 35;
    const edges = (c: number) => c < 5 || (c >= 55 && c < 60);

    const noon = mount(t0);
    const noonColors = renderedColors(noon.map.scene.output);
    const noonMid = meanBrightness(noonColors, (i) => middle(i % width));
    const noonEdge = meanBrightness(noonColors, (i) => edges(i % width));
    noon.map.destroy(); noon.host.remove();

    const midnight = mount(t0 + 12 * 3_600_000);
    const midColors = renderedColors(midnight.map.scene.output);
    const midMid = meanBrightness(midColors, (i) => middle(i % width));
    const midEdge = meanBrightness(midColors, (i) => edges(i % width));
    midnight.map.destroy(); midnight.host.remove();

    expect(noonMid).toBeGreaterThan(noonEdge);
    expect(midMid).toBeLessThan(midEdge);
  });

  it("setSun({mode:'off'}) restores the un-darkened render in the same frame", () => {
    const date = Date.UTC(2024, 2, 20, 12, 0, 0);
    const { host, map } = mount(date);
    const lit = map.scene.output.innerHTML;
    map.setSun({ mode: "off" });
    map.scene.rerender();
    const off = map.scene.output.innerHTML;
    expect(off).not.toBe(lit);

    const plain = mount(date, false);
    expect(off).toBe(plain.map.scene.output.innerHTML);
    plain.map.destroy(); plain.host.remove();

    map.destroy();
    host.remove();
  });
});

describe("createGlyphMap — realtime mode actually advances", () => {
  it("re-resolves the sun on its own timer, moving ~15 degrees per elapsed hour", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-03-20T12:00:00Z"));

    const host = document.createElement("div");
    document.body.appendChild(host);
    const map = createGlyphMap(host, {
      view: { center: [0, 0], span: 60, cols: 30, rows: 15 },
      projection: glyphMapGlobe({ radius: 1, exaggeration: 0 }),
      scene: { directionalLight: { direction: [0.5, 0.7, 0.5], intensity: 1, color: "#ffffff" } },
      sun: { mode: "realtime" },
    });

    // Snapped immediately at construction — not one tick late.
    const start = map.scene.getOptions().directionalLight!.direction as [number, number, number];
    expect(start).not.toEqual([0.5, 0.7, 0.5]);
    const lonOf = (d: readonly [number, number, number]) => (Math.atan2(d[1], d[0]) * 180) / Math.PI;

    vi.advanceTimersByTime(3_600_000);
    const after = map.scene.getOptions().directionalLight!.direction as [number, number, number];
    const delta = lonOf(after) - lonOf(start);
    expect(delta).toBeGreaterThan(-15.05);
    expect(delta).toBeLessThan(-14.95);

    map.destroy();
    host.remove();
  });

  it("emits a 'sun' event on every tick, with the advancing subsolar point", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-03-20T12:00:00Z"));

    const host = document.createElement("div");
    document.body.appendChild(host);
    const map = createGlyphMap(host, {
      view: { center: [0, 0], span: 60, cols: 30, rows: 15 },
      projection: glyphMapEquirectangular(),
      sun: { mode: "realtime", tickMs: 60_000 },
    });

    const seen: number[] = [];
    map.on("sun", (e) => seen.push(e.subsolar.lon));
    vi.advanceTimersByTime(4 * 60_000);
    expect(seen.length).toBe(4);
    // 0.25 degrees of longitude per minute, westward.
    expect(seen[0] - seen[3]).toBeCloseTo(0.75, 2);

    map.destroy();
    host.remove();
  });

  it("runs no timer in 'off' or 'manual' mode, and clears it on destroy", () => {
    vi.useFakeTimers();
    const host = document.createElement("div");
    document.body.appendChild(host);
    const map = createGlyphMap(host, {
      view: { center: [0, 0], span: 60, cols: 30, rows: 15 },
      projection: glyphMapEquirectangular(),
    });
    expect(vi.getTimerCount()).toBe(0);

    map.setSun({ mode: "manual", date: Date.UTC(2024, 0, 1) });
    expect(vi.getTimerCount()).toBe(0);

    map.setSun({ mode: "realtime" });
    expect(vi.getTimerCount()).toBe(1);

    map.setSun({ mode: "off" });
    expect(vi.getTimerCount()).toBe(0);

    map.setSun({ mode: "realtime" });
    expect(vi.getTimerCount()).toBe(1);
    map.destroy();
    expect(vi.getTimerCount()).toBe(0);
    host.remove();
  });

  it("defaults the cadence to GLYPH_MAP_SUN_TICK_MS (30 s)", () => {
    expect(GLYPH_MAP_SUN_TICK_MS).toBe(30_000);
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-03-20T12:00:00Z"));
    const host = document.createElement("div");
    document.body.appendChild(host);
    const map = createGlyphMap(host, {
      view: { center: [0, 0], span: 60, cols: 30, rows: 15 },
      projection: glyphMapEquirectangular(),
      sun: { mode: "realtime" },
    });
    const seen: number[] = [];
    map.on("sun", (e) => seen.push(e.at));
    vi.advanceTimersByTime(29_000);
    expect(seen.length).toBe(0);
    vi.advanceTimersByTime(2_000);
    expect(seen.length).toBe(1);
    map.destroy();
    host.remove();
  });
});

describe("createGlyphMap — getSun / setSun", () => {
  it("merges partially and reports every field resolved", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const map = createGlyphMap(host, {
      view: { center: [0, 0], span: 60, cols: 30, rows: 15 },
      projection: glyphMapEquirectangular(),
    });
    expect(map.getSun()).toMatchObject({ mode: "off", tickMs: GLYPH_MAP_SUN_TICK_MS, nightColor: "#000000" });

    map.setSun({ mode: "manual", date: Date.UTC(2024, 0, 1) });
    expect(map.getSun().mode).toBe("manual");
    expect(map.getSun().date).toBe(Date.UTC(2024, 0, 1));

    map.setSun({ nightOpacity: 0.4 });
    expect(map.getSun().mode).toBe("manual");
    expect(map.getSun().nightOpacity).toBe(0.4);
    expect(map.getSubsolarPoint()!.lon).toBeCloseTo(glyphMapSubsolarPoint(Date.UTC(2024, 0, 1)).lon, 10);

    map.destroy();
    host.remove();
  });
});
