import { describe, expect, it, vi } from "vitest";
import { createGlyphMap } from "./widget";
import { glyphMapEquirectangular, glyphMapGlobe } from "./projection";
import { glyphMapBreaks } from "./classify";
import type { GlyphMapGeoTile } from "./tile";
import type { GlyphMapProvider } from "./provider";

function makeTile(bounds: GlyphMapGeoTile["bounds"], cols: number, rows: number, elev = 100): GlyphMapGeoTile {
  const elevation = new Float32Array((cols + 1) * (rows + 1)).fill(elev);
  return { bounds, cols, rows, elevation, source: "synthetic", sampler: "nearest" };
}

function mountFlat(overrides: Partial<Parameters<typeof createGlyphMap>[1]> = {}) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const map = createGlyphMap(host, {
    view: { center: [0, 0], span: 40, cols: 40, rows: 20 },
    projection: glyphMapEquirectangular(),
    ...overrides,
  });
  return { host, map };
}

describe("createGlyphMap — view", () => {
  it("getView reflects the constructor view", () => {
    const { host, map } = mountFlat();
    const v = map.getView();
    expect(v.center).toEqual([0, 0]);
    expect(v.span).toBe(40);
    map.destroy();
    host.remove();
  });

  it("setView merges partial updates and emits 'move'/'zoom' correctly", () => {
    const { host, map } = mountFlat();
    const moveEvents: unknown[] = [];
    const zoomEvents: unknown[] = [];
    map.on("move", (e) => moveEvents.push(e));
    map.on("zoom", (e) => zoomEvents.push(e));

    map.setView({ center: [10, 5] });
    expect(moveEvents.length).toBe(1);
    expect(zoomEvents.length).toBe(0);
    expect(map.getView().center).toEqual([10, 5]);
    expect(map.getView().span).toBe(40); // untouched

    map.setView({ span: 20 });
    expect(zoomEvents.length).toBe(1);
    expect(map.getView().span).toBe(20);

    map.destroy();
    host.remove();
  });

  it("fitBounds sets a span covering the full requested box (padding for aspect, never cropping)", () => {
    const { host, map } = mountFlat();
    map.fitBounds({ west: -5, east: 5, south: -20, north: 20 });
    const v = map.getView();
    expect(v.center[0]).toBeCloseTo(0, 10);
    expect(v.center[1]).toBeCloseTo(0, 10);
    // width-derived span is 10; height-derived is 40 * (cols/rows) = 40*2 = 80.
    expect(v.span).toBeCloseTo(80, 10);
    map.destroy();
    host.remove();
  });

  it("resize() does not throw and keeps the view stable", () => {
    const { host, map } = mountFlat();
    const before = map.getView();
    expect(() => map.resize()).not.toThrow();
    expect(map.getView().center).toEqual(before.center);
    host.remove();
    map.destroy();
  });
});

describe("createGlyphMap — layers", () => {
  it("addLayer mounts a static raster tile and returns a usable id; removeLayer disposes it", () => {
    const { host, map } = mountFlat();
    const id = map.addLayer({ type: "raster", source: makeTile({ west: -20, east: 20, south: -20, north: 20 }, 2, 2) });
    expect(typeof id).toBe("string");
    expect(() => map.removeLayer(id)).not.toThrow();
    map.destroy();
    host.remove();
  });

  it("addLayer rejects a duplicate explicit id", () => {
    const { host, map } = mountFlat();
    map.addLayer({ type: "background", id: "bg", color: "#111" });
    expect(() => map.addLayer({ type: "background", id: "bg", color: "#222" })).toThrow(RangeError);
    map.destroy();
    host.remove();
  });

  it("background layer sets the scene output's CSS background color; the topmost background wins; removal falls back to the next", () => {
    const { host, map } = mountFlat();
    const first = map.addLayer({ type: "background", color: "rgb(1, 2, 3)" });
    expect(map.scene.output.style.backgroundColor).toBe("rgb(1, 2, 3)");
    const second = map.addLayer({ type: "background", color: "rgb(4, 5, 6)" });
    expect(map.scene.output.style.backgroundColor).toBe("rgb(4, 5, 6)");
    map.removeLayer(second);
    expect(map.scene.output.style.backgroundColor).toBe("rgb(1, 2, 3)");
    map.removeLayer(first);
    expect(map.scene.output.style.backgroundColor).toBe("");
    map.destroy();
    host.remove();
  });

  it("moveLayer rejects an unknown id, and a valid move does not throw", () => {
    const { host, map } = mountFlat();
    const a = map.addLayer({ type: "background", color: "#111" });
    const b = map.addLayer({ type: "background", color: "#222" });
    expect(() => map.moveLayer("nope")).toThrow(RangeError);
    expect(() => map.moveLayer(a, b)).not.toThrow();
    map.destroy();
    host.remove();
  });

  it("a raster layer with a classifier + colors colors its mesh by elevation band (no throw, colors resolve)", () => {
    const { host, map } = mountFlat({
      layers: [
        {
          type: "raster",
          source: makeTile({ west: -20, east: 20, south: -20, north: 20 }, 2, 2, 900),
          classifier: glyphMapBreaks([0, 500, 1000]),
          colors: ["#0000ff", "#00ff00", "#ffff00", "#ff0000"],
        },
      ],
    });
    // No throw during construction is the main assertion — full pixel
    // verification would need a real render pass, out of scope here.
    expect(map.scene.output).toBeTruthy();
    map.destroy();
    host.remove();
  });

  it("a provider-backed raster layer fetches only VISIBLE tiles and mounts them", async () => {
    const loaded: string[] = [];
    const provider: GlyphMapProvider = {
      id: "synthetic",
      zooms: [{ z: 0, cols: 4, rows: 1, tileLonSpan: 90, tileLatSpan: 180, tileCols: 2, tileRows: 2 }],
      bounds: (_z, x) => ({ west: -180 + x * 90, east: -180 + (x + 1) * 90, south: -90, north: 90 }),
      loadTile: async (z, x, y) => {
        loaded.push(`${z}/${x}_${y}`);
        return makeTile({ west: -180 + x * 90, east: -180 + (x + 1) * 90, south: -90, north: 90 }, 2, 2);
      },
    };
    // Centred on lon 0, a narrow span — only the tiles straddling lon 0
    // should be visible (tile x=1: [-90,0), x=2: [0,90)), not the
    // far-side tiles x=0/x=3.
    const { host, map } = mountFlat({
      view: { center: [0, 0], span: 20, cols: 40, rows: 20 },
      layers: [{ type: "raster", source: provider }],
    });
    await vi.waitFor(() => expect(loaded.length).toBeGreaterThan(0));
    expect(loaded).not.toContain("0/0_0");
    expect(loaded).not.toContain("0/3_0");
    map.destroy();
    host.remove();
  });

  it("stays rendered after fitBounds zooms into ONE tile's interior — found live on /maps (blank render, no error)", async () => {
    // A 2x2 z1-style pyramid (real quadrant tiles, matching the baked
    // ETOPO1 provider's own shape) — each tile spans 180x90 degrees, far
    // larger than the close-up region `fitBounds` below zooms into. None of
    // the destination tile's own 9 corner/edge/centre sample points has to
    // land on-screen for the tile to still cover the viewport (the viewport
    // is nested INSIDE one tile's interior, not straddling a tile edge) —
    // the bug this regresses is `isBoundsVisible` missing exactly that case,
    // which fell through to the "never blank the layer" failsafe (always
    // tile `0_0`, the WRONG tile here) and rendered nothing.
    const provider: GlyphMapProvider = {
      id: "quadrants",
      zooms: [{ z: 1, cols: 2, rows: 2, tileLonSpan: 180, tileLatSpan: 90, tileCols: 4, tileRows: 4 }],
      bounds: (_z, x, y) => {
        const lonMin = -180 + x * 180;
        const latMax = 90 - y * 90;
        return { west: lonMin, east: lonMin + 180, south: latMax - 90, north: latMax };
      },
      loadTile: async (z, x, y) => {
        const lonMin = -180 + x * 180;
        const latMax = 90 - y * 90;
        return makeTile({ west: lonMin, east: lonMin + 180, south: latMax - 90, north: latMax }, 4, 4);
      },
    };

    const host = document.createElement("div");
    // happy-dom's default `getBoundingClientRect()` is all zeros — a real
    // measured host size is load-bearing here (it's what makes
    // `computeZoomForSpan`'s cell-pixel metrics match a real browser's,
    // which is what actually triggers the bug: at a coarse fallback cell
    // size the projected sample points happen to land closer to center).
    Object.defineProperty(host, "getBoundingClientRect", {
      value: () => ({ width: 1056, height: 819, top: 0, left: 0, right: 1056, bottom: 819, x: 0, y: 0, toJSON() {} }),
    });
    document.body.appendChild(host);
    const map = createGlyphMap(host, {
      view: { center: [0, 20], span: 140, cols: 135, rows: 63 },
      projection: glyphMapGlobe({ exaggeration: 24 }),
      layers: [{ type: "raster", source: provider }],
    });

    function nonSpaceCount(): number {
      return [...(map.scene.output.textContent ?? "")].filter((c) => c !== " " && c !== "\n").length;
    }

    await vi.waitFor(() => expect(nonSpaceCount()).toBeGreaterThan(0));

    // Himalaya-ish box, entirely inside the east quadrant tile (x=1, y=0:
    // lon [0,180] x lat [0,90]) — well away from every corner/edge.
    map.fitBounds({ west: 78, east: 92, south: 25, north: 32 });

    // `setView`'s own synchronous `scene.rerender()` still shows the OLD
    // (pre-fitBounds) tile set for a moment — `vi.waitFor` on non-blank text
    // alone would pass vacuously against that stale frame. The tile SWAP
    // itself is on `scheduleTileUpdate`'s 180ms debounce, so wait past it
    // before asserting on the settled render.
    await new Promise((r) => setTimeout(r, 400));
    expect(nonSpaceCount()).toBeGreaterThan(0);

    map.destroy();
    host.remove();
  });
});

describe("createGlyphMap — markers and events", () => {
  it("addMarker positions a hotspot and remove() detaches it", () => {
    const { host, map } = mountFlat();
    const marker = map.addMarker({ at: [5, 5], label: "Test" });
    expect(marker.el.isConnected).toBe(true);
    expect(marker.el.textContent).toContain("Test");
    marker.remove();
    expect(marker.el.isConnected).toBe(false);
    map.destroy();
    host.remove();
  });

  it("on()/off() register and unregister handlers", () => {
    const { host, map } = mountFlat();
    const handler = vi.fn();
    map.on("move", handler);
    map.setView({ center: [1, 1] });
    expect(handler).toHaveBeenCalledTimes(1);
    map.off("move", handler);
    map.setView({ center: [2, 2] });
    expect(handler).toHaveBeenCalledTimes(1);
    map.destroy();
    host.remove();
  });

  it("fires 'load' once, after construction settles (async even with no layers)", async () => {
    const { host, map } = mountFlat();
    const handler = vi.fn();
    map.on("load", handler);
    await vi.waitFor(() => expect(handler).toHaveBeenCalledTimes(1));
    map.destroy();
    host.remove();
  });

  it("a listener that throws does not break subsequent listeners or the widget", () => {
    const { host, map } = mountFlat();
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const good = vi.fn();
    map.on("move", () => { throw new Error("boom"); });
    map.on("move", good);
    expect(() => map.setView({ center: [3, 3] })).not.toThrow();
    expect(good).toHaveBeenCalledTimes(1);
    spy.mockRestore();
    map.destroy();
    host.remove();
  });
});

describe("createGlyphMap — orbit vs sheet gesture (capability, not identity, branch)", () => {
  it("a globe view's centre follows an equivalent camera rotation (cameraForCenter/centerForCamera round-trip via setView)", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const map = createGlyphMap(host, {
      view: { center: [10, 10], span: 40, cols: 60, rows: 30 },
      projection: glyphMapGlobe({ radius: 1, exaggeration: 0 }),
    });
    map.setView({ center: [50, -20] });
    const v = map.getView();
    expect(v.center[0]).toBeCloseTo(50, 6);
    expect(v.center[1]).toBeCloseTo(-20, 6);
    map.destroy();
    host.remove();
  });
});

/**
 * Bug 3 (a live-page report, fixed alongside the chirality bugs above):
 * `applyDrag`'s orbit branch had `camera.rotY`/`camera.rotX` incrementing in
 * the WRONG direction relative to the pointer delta — verified via
 * `centerForCamera`, which measures `rotY +10 -> lon +10` and
 * `rotX +10 -> lat -10`, so a `+= dxPx`/`+= dyPx` orbit update moves the
 * centre AWAY from the cursor on both axes. The sheet (non-orbit) branch's
 * own math turned out to already be correct once bugs 1/2's projection sign
 * flip landed — `screenToWorldDelta`'s Jacobian is derived from the (now
 * chirality-correct) projection, so it inherited the fix rather than needing
 * one of its own; this test pins that empirically rather than assuming it,
 * per the task's "determine which empirically" instruction.
 *
 * Grab-and-drag semantics, matching every map library: the world follows
 * the cursor. Drag RIGHT (`dx > 0`) must DECREASE centre longitude (content
 * already under the cursor stays there, i.e. slides right — the pixels to
 * the LEFT of the old cursor position, which are WEST, scroll into view).
 * Drag DOWN (`dy > 0`) must INCREASE centre latitude (content scrolls down,
 * so the NORTHward pixels above the old cursor position scroll into view).
 */
describe("createGlyphMap — drag direction (grab-and-drag: the world follows the cursor)", () => {
  function fire(host: HTMLElement, type: string, x: number, y: number, pointerId = 1): void {
    host.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, pointerId, bubbles: true }));
  }

  it("orbit branch (globe): drag right decreases centre longitude, drag down increases centre latitude", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const map = createGlyphMap(host, {
      view: { center: [0, 0], span: 40, cols: 60, rows: 30 },
      projection: glyphMapGlobe({ radius: 1, exaggeration: 0 }),
    });

    fire(host, "pointerdown", 100, 100, 1);
    fire(host, "pointermove", 120, 100, 1); // drag right, dx = +20
    const afterRight = map.getView().center;
    fire(host, "pointerup", 120, 100, 1);
    expect(afterRight[0]).toBeLessThan(0);
    expect(afterRight[1]).toBeCloseTo(0, 6);

    fire(host, "pointerdown", 100, 100, 2);
    fire(host, "pointermove", 100, 120, 2); // drag down, dy = +20
    const afterDown = map.getView().center;
    fire(host, "pointerup", 100, 120, 2);
    expect(afterDown[1]).toBeGreaterThan(afterRight[1]);

    map.destroy();
    host.remove();
  });

  it("sheet branch (equirectangular): drag right decreases centre longitude, drag down increases centre latitude", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const map = createGlyphMap(host, {
      view: { center: [0, 0], span: 40, cols: 60, rows: 30 },
      projection: glyphMapEquirectangular(),
      tilt: 0,
    });

    fire(host, "pointerdown", 100, 100, 1);
    fire(host, "pointermove", 120, 100, 1); // drag right, dx = +20
    const afterRight = map.getView().center;
    fire(host, "pointerup", 120, 100, 1);
    expect(afterRight[0]).toBeLessThan(0);

    fire(host, "pointerdown", 100, 100, 2);
    fire(host, "pointermove", 100, 120, 2); // drag down, dy = +20
    const afterDown = map.getView().center;
    fire(host, "pointerup", 100, 120, 2);
    expect(afterDown[1]).toBeGreaterThan(afterRight[1]);

    map.destroy();
    host.remove();
  });
});
