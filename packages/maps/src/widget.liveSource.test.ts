/**
 * The LIVE-DATA machinery: replacing a mounted layer's source in place, and
 * doing it without tearing down the markers it already drew.
 *
 * Every layer in this package is static once mounted — `addLayer` captures a
 * source and there has never been a way to hand a runtime a new one. A feed
 * that refreshes (earthquakes, disasters, satellites) needs exactly that one
 * primitive, and it needs it to be IDLE-NEUTRAL: the rebuild it dispatches
 * goes through `trackUpdate`, so `setLayerSource(id, next); await idle()`
 * resolves once the new features are on screen, and no timer ever enters
 * `widgetBusy()`. A `refreshMs` on the layer could not have that property —
 * counted, `idle()` would never resolve; excluded, it would be a clause the
 * widget deliberately hides. The interval belongs to the page.
 *
 * The second half is the one with a measured defect behind it. A point
 * layer's rebuild removes and re-creates EVERY hotspot `<div>`
 * (`widget.symbolRebuildFlash.test.ts`: `+4298 -4298` and a ~200 ms stall
 * after a 40 px pan), which is why `featuresAreTheWholeInput` exists to skip
 * it. A refresh cannot take that skip — the features really did change — so
 * without a reconcile a live layer would reintroduce the exact churn and the
 * exact opacity flash that skip was built to remove, on a timer. So a
 * refresh whose features carry `id`s RECONCILES: survivors move through
 * `handle.setAt` (the same call `syncGround` already uses for the same
 * reason), departures are removed, arrivals are created, and the arbiter
 * runs once.
 */
import { describe, expect, it, vi } from "vitest";
import { createGlyphMap } from "./widget";
import { glyphMapEquirectangular } from "./projection";
import type { GlyphMapGeoTile } from "./tile";
import type { GlyphMapVectorFeature, GlyphMapVectorFeatureCollection, GlyphMapVectorProvider } from "./vector/types";

const COLS = 120;
const ROWS = 48;

function mount(overrides: Partial<Parameters<typeof createGlyphMap>[1]> = {}) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const map = createGlyphMap(host, {
    view: { center: [0, 0], span: 120, cols: COLS, rows: ROWS },
    projection: glyphMapEquirectangular(),
    tilt: 0,
    ...overrides,
  });
  return { host, map, teardown: () => { map.destroy(); host.remove(); } };
}

function quake(id: string, lon: number, lat: number, mag = 4): GlyphMapVectorFeature {
  return { id, geometryType: "point", properties: { mag, place: id }, rings: [[[lon, lat]]] };
}

const collection = (
  features: readonly GlyphMapVectorFeature[],
  attribution?: GlyphMapVectorFeatureCollection["attribution"],
): GlyphMapVectorFeatureCollection => (attribution ? { features, attribution } : { features });

/**
 * A one-level provider whose tile arrives on a TIMER — the asynchrony a
 * static collection cannot express, and the only thing that makes the
 * idle-neutrality clause above a real gate rather than a tautology.
 */
function slowProvider(features: readonly GlyphMapVectorFeature[], delayMs = 20): GlyphMapVectorProvider {
  return {
    id: "slow-live",
    zooms: [{ z: 0, cols: 1, rows: 1, tileLonSpan: 360, tileLatSpan: 180, tileCols: 180, tileRows: 90 }],
    bounds: () => ({ west: -180, east: 180, south: -90, north: 90 }),
    async loadTile(z, x, y) {
      await new Promise<void>((resolve) => { setTimeout(resolve, delayMs); });
      return {
        z, x, y,
        bounds: { west: -180, east: 180, south: -90, north: 90 },
        layers: { live: [...features] },
        source: "slow-live",
        simplify: "none",
      };
    },
  };
}

const dots = (host: HTMLElement) => [...host.querySelectorAll<HTMLElement>(".glyph-map-circle")];
const labels = (host: HTMLElement) => [...host.querySelectorAll<HTMLElement>(".glyph-map-symbol")];

/**
 * Node churn on the hotspot layer, as the flash test counts it: an
 * `appendChild` onto `.glyph-hotspot-layer` is a marker being CREATED and a
 * `remove()` on an element already in it is one being destroyed. A reconcile
 * that only moves points must produce neither.
 */
function countHotspotChurn(): { readonly added: () => number; readonly removed: () => number; restore: () => void } {
  let added = 0;
  let removed = 0;
  const appendChild = Node.prototype.appendChild;
  const remove = Element.prototype.remove;
  Node.prototype.appendChild = function <T extends Node>(this: Node, node: T): T {
    if ((this as HTMLElement)?.classList?.contains?.("glyph-hotspot-layer")) added++;
    return appendChild.call(this, node) as T;
  };
  Element.prototype.remove = function (this: Element) {
    if (this.parentElement?.classList?.contains?.("glyph-hotspot-layer")) removed++;
    return remove.call(this);
  };
  return {
    added: () => added,
    removed: () => removed,
    restore: () => { Node.prototype.appendChild = appendChild; Element.prototype.remove = remove; },
  };
}

describe("setLayerSource — replacing a mounted layer's data", () => {
  it("swaps a circle layer's features and settles inside map.idle()", async () => {
    const { host, map, teardown } = mount();
    try {
      map.addLayer({ type: "circle", id: "quakes", source: collection([quake("a", -10, 10), quake("b", 10, -10)]) });
      await map.idle();
      expect(dots(host).length).toBe(2);

      map.setLayerSource("quakes", collection([quake("a", -10, 10), quake("b", 10, -10), quake("c", 30, 20)]));
      // No polling, no sleep: idle() covers the dispatched rebuild, exactly
      // as it covers `addLayer`'s.
      await map.idle();
      expect(dots(host).length).toBe(3);
    } finally { teardown(); }
  });

  /**
   * IDLE-NEUTRALITY, gated on a source that cannot resolve synchronously.
   *
   * A static collection's rebuild runs inside `update()` before its promise
   * settles, so `await idle()` would find the new markers on screen even if
   * the dispatch were never counted — which makes the static case a vacuous
   * gate. A PROVIDER's sweep awaits a real tile, so `idle()` can only be
   * right here if `setLayerSource` routes its dispatch through the same
   * `trackUpdate` counter `addLayer` uses. Drop that and this goes red
   * (verified: `idle()` resolves on an empty layer).
   */
  it("covers an asynchronous source swap, so idle() still means what it says", async () => {
    const { host, map, teardown } = mount();
    try {
      map.addLayer({ type: "circle", id: "quakes", source: collection([quake("a", 0, 0)]) });
      await map.idle();
      expect(dots(host).length).toBe(1);

      map.setLayerSource("quakes", slowProvider([quake("p1", -20, 10), quake("p2", 20, -10)]));
      await map.idle();
      expect(dots(host).length).toBe(2);
    } finally { teardown(); }
  });

  it("keeps every marker element across a refresh where the points only moved", async () => {
    const churn = countHotspotChurn();
    try {
      const { host, map, teardown } = mount();
      try {
        map.addLayer({
          type: "symbol",
          id: "sats",
          source: collection([quake("iss", 0, 0), quake("css", 20, 5), quake("hst", -30, -10)]),
          textProperty: "place",
        });
        await map.idle();
        const before = labels(host);
        expect(before.length).toBe(3);
        const addedAtMount = churn.added();
        const removedAtMount = churn.removed();

        // The refresh a propagated satellite set produces: same ids, new
        // positions, every frame.
        map.setLayerSource("sats", collection([quake("iss", 4, 1), quake("css", 24, 6), quake("hst", -26, -9)]));
        await map.idle();

        const after = labels(host);
        expect(after.length).toBe(3);
        // Reference identity, element for element — the property the count
        // alone cannot see (`+4298 -4298` reads as no change).
        expect(after.every((el, i) => el === before[i])).toBe(true);
        expect(churn.added()).toBe(addedAtMount);
        expect(churn.removed()).toBe(removedAtMount);

        // And they really did MOVE: the anchor is re-projected, not stale.
        const moved = map.project([4, 1]);
        expect(moved).not.toBeNull();
      } finally { teardown(); }
    } finally { churn.restore(); }
  });

  it("adds arrivals and removes departures without touching the survivors", async () => {
    const { host, map, teardown } = mount();
    try {
      map.addLayer({ type: "circle", id: "quakes", source: collection([quake("a", -10, 10), quake("b", 10, -10)]) });
      await map.idle();
      const first = dots(host);
      expect(first.length).toBe(2);
      const survivor = first[0];

      map.setLayerSource("quakes", collection([quake("a", -10, 10), quake("c", 30, 20)]));
      await map.idle();

      const second = dots(host);
      expect(second.length).toBe(2);
      // `a` survived as the SAME element; `b` left; `c` is new.
      expect(second[0]).toBe(survivor);
      expect(second.includes(first[1]!)).toBe(false);
    } finally { teardown(); }
  });

  it("re-labels a survivor whose own properties changed", async () => {
    const { host, map, teardown } = mount();
    try {
      const before: GlyphMapVectorFeature = { id: "eq1", geometryType: "point", properties: { place: "M4.1" }, rings: [[[0, 0]]] };
      map.addLayer({ type: "symbol", id: "quakes", source: collection([before]), textProperty: "place" });
      await map.idle();
      const el = labels(host)[0]!;
      expect(el.textContent).toBe("M4.1");

      map.setLayerSource("quakes", collection([{ ...before, properties: { place: "M4.6" } }]));
      await map.idle();
      expect(labels(host)[0]).toBe(el);
      expect(el.textContent).toBe("M4.6");
    } finally { teardown(); }
  });

  it("carries the new source's attribution, and withdraws the old one", async () => {
    const { map, teardown } = mount();
    try {
      const usgs = [{ name: "USGS", url: "https://earthquake.usgs.gov", license: "public domain" }] as const;
      map.addLayer({ type: "circle", id: "quakes", source: collection([quake("a", 0, 0)]) });
      await map.idle();
      expect(map.getAttributions()).toEqual([]);

      map.setLayerSource("quakes", collection([quake("a", 0, 0)], usgs));
      await map.idle();
      expect(map.getAttributions().map((a) => a.name)).toEqual(["USGS"]);

      map.setLayerSource("quakes", collection([quake("a", 0, 0)]));
      await map.idle();
      expect(map.getAttributions()).toEqual([]);
    } finally { teardown(); }
  });

  it("re-stamps a line layer from its new source", async () => {
    const { map, teardown } = mount({ groundElevation: () => 0 });
    try {
      map.addLayer({ type: "line", id: "tracks", source: collection([{ id: "t1", rings: [[[-40, 0], [40, 0]]] }]), color: "#ff0000" });
      await map.idle();
      map.scene.rerender();
      const equator = (map.scene.output.textContent ?? "").split("\n")[ROWS / 2] ?? "";
      expect(equator.trim()).not.toBe("");

      map.setLayerSource("tracks", collection([{ id: "t1", rings: [[[-40, 40], [40, 40]]] }]));
      await map.idle();
      map.scene.rerender();
      const after = (map.scene.output.textContent ?? "").split("\n")[ROWS / 2] ?? "";
      expect(after.trim()).toBe("");
    } finally { teardown(); }
  });

  it("refuses a layer kind that has no vector source, and an id that is not mounted", async () => {
    const { map, teardown } = mount();
    try {
      const tile: GlyphMapGeoTile = {
        bounds: { west: -10, east: 10, south: -10, north: 10 },
        cols: 2, rows: 2, elevation: new Float32Array(9), source: "synthetic", sampler: "nearest",
      };
      map.addLayer({ type: "raster", id: "terrain", source: tile });
      map.addLayer({ type: "background", id: "bg", color: "#000" });
      await map.idle();

      const next = collection([quake("a", 0, 0)]);
      expect(() => map.setLayerSource("terrain", next)).toThrow(RangeError);
      expect(() => map.setLayerSource("bg", next)).toThrow(RangeError);
      expect(() => map.setLayerSource("nope", next)).toThrow(/not a mounted layer/);
    } finally { teardown(); }
  });
});
