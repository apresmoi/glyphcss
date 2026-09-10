/**
 * Street-level WALK mode.
 *
 * Five properties, each of which has a way of going silently wrong:
 *
 *  1. **Entering puts a PERSPECTIVE camera at eye height.** Silent failure:
 *     the camera swaps but the pose does not, so the reader gets a
 *     perspective picture of the map from orbit. Pinned by geometry, not by
 *     reading options back — the eye is where `eyeDepth` says the eye is,
 *     and the ground CONVERGES (equal steps of distance take smaller and
 *     smaller steps of row), which an orthographic camera cannot do at any
 *     tilt or span.
 *  2. **A forward keypress moves the walker along its HEADING.** Silent
 *     failures: a key handler that never runs (nothing moves), an axis that
 *     ignores `bearing` (always walks north), or a planar step (drifts with
 *     latitude). Pinned against the heading actually set.
 *  3. **The walker's height TRACKS THE TERRAIN.** Silent failure: the eye is
 *     planted at the datum, so a walker on a 500 m plateau is 500 m
 *     underground. Pinned by projecting the eye back through the real
 *     projection and comparing against the mounted tile's own elevation.
 *  4. **Leaving restores the prior view EXACTLY.** Silent failure: the exit
 *     recomputes a pose that is "the same modulo float noise", which shows
 *     up as a one-cell jump. Pinned on the rendered BYTES.
 *  4b. **A walk over bare TERRAIN works, and climbs.** Walk mode is a
 *     CAMERA mode, not a layer feature: every terrain clause below mounts a
 *     `raster` layer and nothing else. Silent failure: gating anything on
 *     what kind of data is mounted, which would make walking a ridge
 *     impossible for no geometric reason.
 *  5. **The tile footprint is BOUNDED.** Silent failure: the sweep falls
 *     back to a view-span box or to unprojected screen samples and asks for
 *     hundreds of tiles at z14. Pinned by counting real `loadTile` calls
 *     while walking.
 *
 * Plus the off-by-default clause: a map that never walks is byte-identical.
 *
 * Fixture traps (shared with `widget.tiltPivot.test.ts`): happy-dom has no
 * layout, so `getBoundingClientRect` is stubbed to give the widget real cell
 * metrics; and assertions count EXACT cells/rows rather than total ink.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createGlyphMap } from "./widget";
import {
  GLYPH_MAP_WALK_EYE_HEIGHT_M,
  GLYPH_MAP_WALK_FAR_M,
  GLYPH_MAP_WALK_HORIZON_TILT_DEG,
  GLYPH_MAP_WALK_MAX_PITCH_DEG,
} from "./walk";
import { GLYPH_MAP_EARTH_RADIUS_M, glyphMapEquirectangular, glyphMapGlobe } from "./projection";
import type { GlyphMapGeoTile } from "./tile";
import type { GlyphMapProvider } from "./provider";
import type { GlyphMapClassifier } from "./types";

const COLS = 140, ROWS = 63, CELL_W = 8, CELL_H = 16, BASE_FONT_PX = 16;
const ZURICH: readonly [number, number] = [8.5445, 47.37418];

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

function mount(opts: Parameters<typeof createGlyphMap>[1]) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  stubMonospaceMetrics(host);
  const map = createGlyphMap(host, opts);
  return { map, host, done: () => { map.destroy(); host.remove(); } };
}

const baseOpts = () => ({
  projection: glyphMapGlobe(),
  view: { center: ZURICH as [number, number], span: 0.01, cols: COLS, rows: ROWS },
});

function key(host: HTMLElement, type: "keydown" | "keyup", k: string): void {
  const doc = host.ownerDocument!;
  doc.dispatchEvent(new KeyboardEvent(type, { key: k, bubbles: true, cancelable: true }));
}

/**
 * Run one motion frame with a known `dt`. `motionStep` derives `dt` from the
 * rAF timestamp, so driving the real callback with two stamps `ms` apart is
 * what makes a distance assertion exact rather than "some positive amount".
 */
async function motionFrames(ms: number, count = 1): Promise<void> {
  for (let i = 0; i < count; i++) {
    await new Promise<void>((resolve) => { requestAnimationFrame(() => resolve()); });
  }
  void ms;
}

/**
 * A provider whose elevation is a constant, so "did the walker stand on it"
 * is one comparison.
 *
 * `deepZ` is what makes the tile-budget test probe the regime the feature
 * actually runs in. At a SHALLOW deepest level (say 1.4 deg / 156 km tiles)
 * the sweep's own padded candidate window already reaches a thousand
 * kilometres, where the Earth's curvature has dropped the ground 95 km below
 * the walker and the camera rejects the tile off-grid without any help — so
 * a shallow fixture cannot tell the local-horizon test apart from no test at
 * all. At OpenFreeMap's own z14 (0.022 deg / 2.4 km tiles) the same window
 * reaches 17 km, where the drop is 23 m and the tile projects 0.08 deg below
 * the horizon line, i.e. comfortably ON GRID. That is where the footprint is
 * the only thing bounding the sweep.
 */
function flatProvider(elevationM: number, calls?: { z: number; x: number; y: number }[], deepZ = 8): GlyphMapProvider {
  const N = 4;
  const deepCols = 2 ** deepZ * 2;
  const zooms = [
    { z: 0, cols: 1, rows: 1, tileCols: N, tileRows: N, tileLonSpan: 360, tileLatSpan: 180 },
    { z: deepZ, cols: deepCols, rows: deepCols / 2, tileCols: N, tileRows: N, tileLonSpan: 360 / deepCols, tileLatSpan: 360 / deepCols },
  ];
  return {
    id: "walk-test-provider",
    zooms,
    bounds(z, x, y) {
      const lvl = zooms.find((l) => l.z === z)!;
      const west = -180 + x * lvl.tileLonSpan;
      const north = 90 - y * lvl.tileLatSpan;
      return { west, east: west + lvl.tileLonSpan, south: north - lvl.tileLatSpan, north };
    },
    async loadTile(z, x, y): Promise<GlyphMapGeoTile> {
      calls?.push({ z, x, y });
      const b = this.bounds(z, x, y);
      return {
        cols: N, rows: N, bounds: b, source: "walk-test", sampler: "nearest",
        elevation: new Float32Array((N + 1) * (N + 1)).fill(elevationM),
      };
    },
  };
}

/**
 * A RAMP provider: elevation rises linearly with latitude, so walking north
 * is walking uphill. This is the "walk through the mountain" case, and it is
 * a raster layer and nothing else — walk mode is a CAMERA mode, so a walk
 * over bare terrain is the same code path as a walk down a street.
 */
function slopeProvider(metresPerDegreeLat: number, deepZ = 8): GlyphMapProvider {
  const N = 4;
  const deepCols = 2 ** deepZ * 2;
  const zooms = [
    { z: 0, cols: 1, rows: 1, tileCols: N, tileRows: N, tileLonSpan: 360, tileLatSpan: 180 },
    { z: deepZ, cols: deepCols, rows: deepCols / 2, tileCols: N, tileRows: N, tileLonSpan: 360 / deepCols, tileLatSpan: 360 / deepCols },
  ];
  return {
    id: "walk-test-slope",
    zooms,
    bounds(z, x, y) {
      const lvl = zooms.find((l) => l.z === z)!;
      const west = -180 + x * lvl.tileLonSpan;
      const north = 90 - y * lvl.tileLatSpan;
      return { west, east: west + lvl.tileLonSpan, south: north - lvl.tileLatSpan, north };
    },
    async loadTile(z, x, y): Promise<GlyphMapGeoTile> {
      const b = this.bounds(z, x, y);
      const elevation = new Float32Array((N + 1) * (N + 1));
      for (let row = 0; row <= N; row++) {
        // Row 0 is `bounds.north` (the tile contract).
        const lat = b.north - ((b.north - b.south) * row) / N;
        for (let col = 0; col <= N; col++) elevation[row * (N + 1) + col] = lat * metresPerDegreeLat;
      }
      return { cols: N, rows: N, bounds: b, source: "walk-test", sampler: "nearest", elevation };
    },
  };
}

const ELEVATION_CLASSIFIER: GlyphMapClassifier = {
  id: "walk-test",
  orderStatistic: false,
  classifyValue: () => 0,
  classify: (field) => new Uint8Array(field.cols * field.rows),
};

afterEach(() => {
  vi.restoreAllMocks();
  stubbedHosts.clear();
});

describe("walk mode — entering", () => {
  it("is off by default and leaves the camera orthographic", () => {
    const { map, done } = mount(baseOpts());
    expect(map.getWalk()).toBeNull();
    expect(map.scene.camera.kind).toBe("orthographic");
    done();
  });

  it("installs a perspective camera whose EYE is one eye-height above the surface point", () => {
    const projection = glyphMapGlobe();
    const { map, done } = mount({ ...baseOpts(), projection });
    map.setWalk({});

    const camera = map.scene.camera;
    expect(camera.kind).toBe("perspective");

    // `eyeDepth` is affine in the world point and vanishes AT the near
    // plane, `near` metres in front of the eye. Sampling it along the view
    // axis therefore locates the eye without reading a single camera
    // internal: solve for the point where the linear function crosses the
    // eye's own value.
    const surface = projection.project(ZURICH[0], ZURICH[1], 0);
    const oneMetreUp = projection.project(ZURICH[0], ZURICH[1], 1);
    const up = [0, 1, 2].map((i) => oneMetreUp[i]! - surface[i]!) as [number, number, number];
    const eye = [0, 1, 2].map((i) => surface[i]! + up[i]! * GLYPH_MAP_WALK_EYE_HEIGHT_M) as [number, number, number];

    // The eye is BEHIND the near plane (nothing at the eye is drawable) and
    // a point a metre ahead of it is in front — the two-sided statement that
    // the eye is where we say it is, to within a metre.
    expect(camera.eyeDepth(eye)).toBeLessThan(0);
    // Head height above the eye is still behind the near plane; the ground
    // 10 m ahead is in front of it.
    const ahead = 10 / GLYPH_MAP_EARTH_RADIUS_M;
    const north = projection.project(ZURICH[0], ZURICH[1] + (ahead * 180) / Math.PI, 0);
    expect(camera.eyeDepth(north)).toBeGreaterThan(0);

    // And the eye is at eye height, not at the datum and not at 100 m: the
    // surface point directly underfoot is BEHIND the near plane too (you are
    // standing on it), while the same point is nearer to the eye than the
    // point 10 m ahead is.
    const dEye = Math.hypot(eye[0] - surface[0]!, eye[1] - surface[1]!, eye[2] - surface[2]!);
    expect(dEye * GLYPH_MAP_EARTH_RADIUS_M).toBeCloseTo(GLYPH_MAP_WALK_EYE_HEIGHT_M, 6);
    done();
  });

  it("renders a CONVERGING ground — equal steps of distance take shrinking steps of row", () => {
    const { map, done } = mount(baseOpts());

    const rowAt = (metres: number): number => {
      const dLat = (metres / GLYPH_MAP_EARTH_RADIUS_M) * (180 / Math.PI);
      return map.project([ZURICH[0], ZURICH[1] + dLat]).row;
    };

    // Orthographic first: the same three ground points are EVENLY spaced,
    // because that is what an orthographic camera does at every tilt.
    map.setTilt(85);
    const ortho = [rowAt(10), rowAt(110), rowAt(210)];
    const orthoStep1 = ortho[0]! - ortho[1]!;
    const orthoStep2 = ortho[1]! - ortho[2]!;
    expect(orthoStep2 / orthoStep1).toBeCloseTo(1, 2);

    // Walking: the SAME three points converge hard toward the horizon.
    map.setWalk({});
    map.setBearing(0);
    const walk = [rowAt(10), rowAt(110), rowAt(210)];
    const walkStep1 = walk[0]! - walk[1]!;
    const walkStep2 = walk[1]! - walk[2]!;
    expect(walkStep1).toBeGreaterThan(0);
    expect(walkStep2).toBeGreaterThan(0);
    // 10 -> 110 m is a far bigger row jump than 110 -> 210 m: the definition
    // of a vanishing point, and 1.0 for every orthographic pose there is.
    expect(walkStep2 / walkStep1).toBeLessThan(0.2);
    done();
  });

  it("starts looking dead ahead and clamps the neck either side of the horizontal", () => {
    const { map, done } = mount(baseOpts());
    map.setWalk({});
    expect(map.getTilt()).toBe(GLYPH_MAP_WALK_HORIZON_TILT_DEG);
    expect(map.getWalk()!.pitch).toBe(0);
    expect(map.getMaxTilt()).toBe(GLYPH_MAP_WALK_HORIZON_TILT_DEG + GLYPH_MAP_WALK_MAX_PITCH_DEG);

    map.setTilt(GLYPH_MAP_WALK_HORIZON_TILT_DEG + 400);
    expect(map.getTilt()).toBe(GLYPH_MAP_WALK_HORIZON_TILT_DEG + GLYPH_MAP_WALK_MAX_PITCH_DEG);
    map.setTilt(-400);
    expect(map.getTilt()).toBe(GLYPH_MAP_WALK_HORIZON_TILT_DEG - GLYPH_MAP_WALK_MAX_PITCH_DEG);
    done();
  });

  it("refuses a flat sheet, naming the projection", () => {
    const { map, done } = mount({ ...baseOpts(), projection: glyphMapEquirectangular() });
    expect(() => map.setWalk({})).toThrow(/walk mode needs a projection navigated by orbiting/);
    expect(map.getWalk()).toBeNull();
    done();
  });
});

describe("walk mode — movement", () => {
  it("walks along the HEADING, at the configured speed", async () => {
    const { map, host, done } = mount(baseOpts());
    map.setWalk({ speed: 10 });
    map.setBearing(90); // east

    const before = map.getView().center;
    key(host, "keydown", "w");
    await motionFrames(16, 4);
    key(host, "keyup", "w");
    const after = map.getView().center;

    // East: longitude grew, latitude did not move (a heading-blind step
    // would have walked north, which is the whole failure this pins).
    expect(after[0]).toBeGreaterThan(before[0]);
    expect(Math.abs(after[1] - before[1]) * GLYPH_MAP_EARTH_RADIUS_M * (Math.PI / 180)).toBeLessThan(0.5);
    const metres = (after[0] - before[0]) * (Math.PI / 180) * GLYPH_MAP_EARTH_RADIUS_M * Math.cos(ZURICH[1] * Math.PI / 180);
    expect(metres).toBeGreaterThan(0.05);
    done();
  });

  it("walks NORTH at heading 0 and SOUTH on the back key", async () => {
    const { map, host, done } = mount(baseOpts());
    map.setWalk({ speed: 20 });
    map.setBearing(0);

    const start = map.getView().center;
    key(host, "keydown", "ArrowUp");
    await motionFrames(16, 4);
    key(host, "keyup", "ArrowUp");
    const forward = map.getView().center;
    expect(forward[1]).toBeGreaterThan(start[1]);
    expect(Math.abs(forward[0] - start[0])).toBeLessThan(1e-9);

    key(host, "keydown", "ArrowDown");
    await motionFrames(16, 4);
    key(host, "keyup", "ArrowDown");
    const back = map.getView().center;
    expect(back[1]).toBeLessThan(forward[1]);
    done();
  });

  it("does not move when walk mode is off, and releases the key when the window blurs", async () => {
    const { map, host, done } = mount(baseOpts());
    const before = map.getView().center;
    key(host, "keydown", "w");
    await motionFrames(16, 3);
    expect(map.getView().center).toEqual(before);

    map.setWalk({ speed: 20 });
    key(host, "keydown", "w");
    await motionFrames(16, 2);
    const moved = map.getView().center;
    expect(moved[1]).toBeGreaterThan(before[1]);

    host.ownerDocument!.defaultView!.dispatchEvent(new Event("blur"));
    await motionFrames(16, 3);
    // Nothing further: the stride stopped with the blur rather than running
    // on forever with no `keyup` ever coming.
    expect(map.getView().center[1]).toBeCloseTo(moved[1], 12);
    done();
  });

  it("a drag LOOKS instead of panning", () => {
    const { map, host, done } = mount(baseOpts());
    map.setWalk({});
    const center = map.getView().center;
    const bearing = map.getBearing();

    host.dispatchEvent(new PointerEvent("pointerdown", { clientX: 400, clientY: 300, pointerId: 1, bubbles: true, cancelable: true }));
    host.dispatchEvent(new PointerEvent("pointermove", { clientX: 460, clientY: 300, pointerId: 1, bubbles: true, cancelable: true }));
    host.dispatchEvent(new PointerEvent("pointerup", { clientX: 460, clientY: 300, pointerId: 1, bubbles: true, cancelable: true }));

    expect(map.getBearing()).not.toBeCloseTo(bearing, 6);
    // The walker did not slide: a pan would have moved the position.
    expect(map.getView().center).toEqual(center);
    done();
  });

  it("ignores the wheel", () => {
    const { map, host, done } = mount(baseOpts());
    map.setWalk({});
    const span = map.getView().span;
    host.dispatchEvent(new WheelEvent("wheel", { deltaY: -400, bubbles: true, cancelable: true }));
    expect(map.getView().span).toBe(span);
    done();
  });
});

describe("walk mode — standing on the ground", () => {
  it("puts the eye an eye-height above the TERRAIN, not above the datum", async () => {
    const ELEVATION = 500;
    const projection = glyphMapGlobe();
    const { map, done } = mount({
      ...baseOpts(),
      projection,
      layers: [{ type: "raster", source: flatProvider(ELEVATION), classifier: ELEVATION_CLASSIFIER }],
    });
    await new Promise<void>((resolve) => { map.on("load", () => resolve()); });
    map.setWalk({});

    const walk = map.getWalk()!;
    expect(walk.groundElevation).toBeCloseTo(ELEVATION, 6);

    // Where the eye actually is, stated as a PICTURE rather than as a
    // coordinate: at bearing 0 and pitch 0 the walker looks due north along
    // the local horizontal, so the point 100 m north AT EYE LEVEL is on the
    // view axis and lands on the grid's centre row, and the GROUND under it
    // — 1.7 m lower — lands below that.
    //
    // This is the discriminating pair. Plant the eye at the datum instead
    // (the failure this pins) and the ground 100 m ahead is 500 m ABOVE the
    // walker, so it moves to the other side of the centre row entirely.
    const camera = map.scene.camera;
    const aheadLat = ZURICH[1] + (100 / GLYPH_MAP_EARTH_RADIUS_M) * (180 / Math.PI);
    const eyeLevel = projection.project(ZURICH[0], aheadLat, ELEVATION + GLYPH_MAP_WALK_EYE_HEIGHT_M);
    const groundAhead = projection.project(ZURICH[0], aheadLat, ELEVATION);
    const rowEye = camera.project(eyeLevel, COLS, ROWS, 2)[1];
    const rowGround = camera.project(groundAhead, COLS, ROWS, 2)[1];
    expect(rowEye).toBeCloseTo(ROWS / 2, 1);
    expect(rowGround).toBeGreaterThan(ROWS / 2);
    done();
  });

  it("climbs: the eye rises with the ground as the walker walks uphill", async () => {
    // 20,000 m per degree of latitude, so a few metres north is a few metres
    // up — a slope steep enough that a handful of frames' walking is a
    // measurable climb, on a map with NOTHING but a raster layer mounted.
    const M_PER_DEG = 20_000;
    const { map, host, done } = mount({
      ...baseOpts(),
      layers: [{ type: "raster", source: slopeProvider(M_PER_DEG), classifier: ELEVATION_CLASSIFIER }],
    });
    await new Promise<void>((resolve) => { map.on("load", () => resolve()); });

    map.setWalk({ speed: 40 });
    map.setBearing(0); // north, i.e. uphill
    const startGround = map.getWalk()!.groundElevation;
    const startLat = map.getView().center[1];
    expect(Number.isFinite(startGround)).toBe(true);

    key(host, "keydown", "w");
    await motionFrames(16, 6);
    key(host, "keyup", "w");

    const walked = map.getWalk()!;
    const climbedLat = walked.center[1] - startLat;
    expect(climbedLat).toBeGreaterThan(0);
    // The ground the walker reports is the ground the TILE describes at the
    // position they walked to — not a value frozen at entry, and not the
    // datum. The tile is sampled at its own vertex resolution, so this is
    // "rose by roughly the slope", not an exact identity.
    const climbedM = walked.groundElevation - startGround;
    expect(climbedM).toBeGreaterThan(0);
    expect(climbedM).toBeLessThan(climbedLat * M_PER_DEG * 4);
    done();
  });

  it("re-samples the ground as the walker steps", async () => {
    const { map, host, done } = mount({
      ...baseOpts(),
      layers: [{ type: "raster", source: flatProvider(1200), classifier: ELEVATION_CLASSIFIER }],
    });
    await new Promise<void>((resolve) => { map.on("load", () => resolve()); });
    map.setWalk({ speed: 20 });
    expect(map.getWalk()!.groundElevation).toBeCloseTo(1200, 6);
    key(host, "keydown", "w");
    await motionFrames(16, 3);
    key(host, "keyup", "w");
    // The sampler is re-read per step (a constant field, so the assertion is
    // that it still reports the terrain rather than falling back to 0).
    expect(map.getWalk()!.groundElevation).toBeCloseTo(1200, 6);
    done();
  });
});

describe("walk mode — leaving", () => {
  it("restores the view, the pitch, the heading, the camera and the rendered BYTES", async () => {
    const { map, host, done } = mount(baseOpts());
    map.setTilt(40);
    map.setBearing(137);
    map.setView({ span: 0.02 });

    const camera = map.scene.camera;
    const before = {
      view: map.getView(),
      tilt: map.getTilt(),
      bearing: map.getBearing(),
      kind: camera.kind,
      rotX: camera.rotX,
      rotY: camera.rotY,
      zoom: camera.zoom,
      target: [...camera.target],
      mat: camera.mat ? [...camera.mat] : null,
      useMat: camera.useMat,
      text: map.scene.output.textContent,
    };

    map.setWalk({});
    map.setBearing(12);
    map.setTilt(GLYPH_MAP_WALK_HORIZON_TILT_DEG + 20);
    key(host, "keydown", "w");
    await motionFrames(16, 3);
    key(host, "keyup", "w");
    expect(map.getWalk()).not.toBeNull();

    map.setWalk(null);
    expect(map.getWalk()).toBeNull();

    const after = map.scene.camera;
    expect(after.kind).toBe(before.kind);
    expect(map.getView()).toEqual(before.view);
    expect(map.getTilt()).toBe(before.tilt);
    expect(map.getBearing()).toBe(before.bearing);
    expect(after.rotX).toBe(before.rotX);
    expect(after.rotY).toBe(before.rotY);
    expect(after.zoom).toBe(before.zoom);
    expect([...after.target]).toEqual(before.target);
    expect(after.mat ? [...after.mat] : null).toEqual(before.mat);
    expect(after.useMat).toBe(before.useMat);
    expect(map.scene.output.textContent).toBe(before.text);
    done();
  });

  it("a projection change leaves walk mode rather than blending through it", async () => {
    const { map, done } = mount(baseOpts());
    map.setWalk({});
    expect(map.getWalk()).not.toBeNull();
    await map.setProjection(glyphMapEquirectangular(), { durationMs: 0 });
    expect(map.getWalk()).toBeNull();
    expect(map.scene.camera.kind).toBe("orthographic");
    done();
  });
});

describe("walk mode — the tile budget", () => {
  it("sweeps only the local horizon, however deep the pyramid", async () => {
    const DEEP_Z = 14;
    const calls: { z: number; x: number; y: number }[] = [];
    const provider = flatProvider(0, calls, DEEP_Z);
    const { map, done } = mount({
      ...baseOpts(),
      layers: [{ type: "raster", source: provider, classifier: ELEVATION_CLASSIFIER }],
    });
    await new Promise<void>((resolve) => { map.on("load", () => resolve()); });

    map.setWalk({});
    await new Promise<void>((resolve) => { setTimeout(resolve, 300); });

    const distinct = [...new Set(calls.map((c) => `${c.z}/${c.x}_${c.y}`))];
    const deep = distinct.filter((k) => k.startsWith(`${DEEP_Z}/`)).map((k) => {
      const [x, y] = k.slice(String(DEEP_Z).length + 1).split("_").map(Number);
      return provider.bounds(DEEP_Z, x!, y!);
    });

    // A 400 m disc against 2.4 km tiles is at most a 2x2 block, and the
    // sweep's `padCells` slack adds one ring — so single digits, and no
    // pyramid depth can make it grow. This is the number that has to be
    // bounded: the widget's own measured budget elsewhere is <= 24 at a city
    // view and never more than 100.
    expect(deep.length).toBeGreaterThan(0);
    expect(deep.length).toBeLessThanOrEqual(16);

    // And they are the RIGHT tiles. Three failures this separates, all of
    // which a pure count would let through: the sweep falling to the "never
    // blank the layer" failsafe (which always picks tile `0_0` wherever the
    // camera is), a whole-level enumeration, and — the one that actually
    // happens without the local-horizon test — the camera admitting every
    // tile out to the padded candidate window, 17 km away, because at that
    // range the Earth's curvature has only dropped the ground 23 m and the
    // tile still projects ON GRID under a horizon-facing perspective camera.
    const under = deep.filter((b) =>
      ZURICH[0] >= b.west && ZURICH[0] <= b.east && ZURICH[1] >= b.south && ZURICH[1] <= b.north);
    expect(under.length).toBe(1);
    const tileLon = 360 / (2 ** DEEP_Z * 2);
    for (const b of deep) {
      expect(Math.abs((b.west + b.east) / 2 - ZURICH[0])).toBeLessThan(2 * tileLon);
      expect(Math.abs((b.south + b.north) / 2 - ZURICH[1])).toBeLessThan(2 * tileLon);
    }
    done();
  });

  it("drops everything past the local horizon, and keeps what is inside it", () => {
    const { map, done } = mount(baseOpts());
    map.setWalk({});
    map.setBearing(0);

    const northAt = (metres: number): readonly [number, number] =>
      [ZURICH[0], ZURICH[1] + (metres / GLYPH_MAP_EARTH_RADIUS_M) * (180 / Math.PI)];

    // Inside the horizon: visible. Past it: NOT — even though it is dead
    // ahead, on the near hemisphere, and lands squarely on the grid.
    const near = map.project(northAt(GLYPH_MAP_WALK_FAR_M * 0.5));
    const far = map.project(northAt(GLYPH_MAP_WALK_FAR_M * 5));
    expect(near.visible).toBe(true);
    expect(far.visible).toBe(false);
    // The discriminator: `far` is not rejected for being off-grid or behind
    // the eye. It projects to a perfectly ordinary cell, which is exactly
    // why `projection.visible` (derived for the orthographic camera, and
    // true for every point on the near hemisphere) cannot make this call.
    expect(Number.isFinite(far.col)).toBe(true);
    expect(far.col).toBeGreaterThanOrEqual(0);
    expect(far.col).toBeLessThanOrEqual(COLS);
    expect(far.row).toBeGreaterThanOrEqual(0);
    expect(far.row).toBeLessThanOrEqual(ROWS);
    done();
  });

  it("draws the buildings inside the horizon and none of the ones past it", () => {
    // Two identical blocks, one inside the horizon and one well past it,
    // each big enough to be unmissable if it drew at all.
    const block = (lon: number, lat: number, halfDeg: number) => ({
      id: `b${lat}`,
      geometry: "polygon" as const,
      rings: [[
        [lon - halfDeg, lat - halfDeg], [lon + halfDeg, lat - halfDeg],
        [lon + halfDeg, lat + halfDeg], [lon - halfDeg, lat + halfDeg],
        [lon - halfDeg, lat - halfDeg],
      ] as [number, number][]],
      properties: { render_height: 300 },
    });
    const degFor = (m: number) => (m / GLYPH_MAP_EARTH_RADIUS_M) * (180 / Math.PI);

    const renderFor = (features: ReturnType<typeof block>[]): string => {
      const { map, done } = mount({
        ...baseOpts(),
        layers: [{
          type: "fill-extrusion" as const,
          source: { features },
          color: "#ffffff",
          heightProperty: "render_height",
        }],
      });
      map.setWalk({});
      map.setBearing(0);
      map.scene.rerender();
      const text = map.scene.output.textContent ?? "";
      done();
      return text;
    };

    // The metric is the cells the BLOCK adds over the identical scene with no
    // block in it, not total ink: walk mode paints a sky, so a street-level
    // frame is never empty and "ink" would answer a question about the
    // backdrop. It is the stronger statement of the same property — a block
    // past the horizon must change NOT ONE CELL.
    const empty = renderFor([]);
    const changedBy = (features: ReturnType<typeof block>[]): number => {
      const text = renderFor(features);
      let changed = 0;
      for (let i = 0; i < Math.max(text.length, empty.length); i++) if (text[i] !== empty[i]) changed++;
      return changed;
    };

    const inside = changedBy([block(ZURICH[0], ZURICH[1] + degFor(GLYPH_MAP_WALK_FAR_M * 0.4), degFor(40))]);
    const beyond = changedBy([block(ZURICH[0], ZURICH[1] + degFor(GLYPH_MAP_WALK_FAR_M * 6), degFor(40))]);

    // The near block draws; the far one draws NOTHING. Measured across the
    // range, the same 300 m block paints 4,590 cells at 80 m, 1,485 at
    // 160 m, 480 at 400 m and zero from 800 m out — the far-field falloff
    // the spike said this view needs, delivered by the existing wall cull
    // rather than by a horizon predicate of walk mode's own (one was built,
    // measured to change not a cell, and dropped; see `nearSidePredicate`).
    expect(inside).toBeGreaterThan(0);
    expect(beyond).toBe(0);
  });

  it("reports a span that DESCRIBES the footprint", () => {
    const { map, done } = mount(baseOpts());
    map.setWalk({});
    const span = map.getView().span;
    const metres = span * (Math.PI / 180) * GLYPH_MAP_EARTH_RADIUS_M;
    expect(metres).toBeCloseTo(2 * GLYPH_MAP_WALK_FAR_M, 3);
    done();
  });
});
