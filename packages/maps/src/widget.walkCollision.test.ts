/**
 * Street-level walk mode — BUILDINGS ARE SOLID, through the real widget.
 *
 * `walkCollision.test.ts` pins the geometry in isolation; this pins the
 * WIRING, which is where the model can be perfect and the feature still be
 * absent. Every silent failure here is one where the maths is right:
 *
 *  - The index is never fed (no source registered), so nothing blocks and
 *    the reported "you can get through them" is unchanged.
 *  - The index is fed from the wrong layer kind, so a park or a lake fences
 *    the reader in.
 *  - The index is built ONCE and never invalidated, so a building the reader
 *    walked away from keeps blocking a street it no longer stands on — and,
 *    worse, one that streamed in does not block at all.
 *  - The defeat key is not wired, so a reader who gets stuck stays stuck.
 *
 * Assertions count METRES walked, never ink: a picture can look right while
 * the walker is standing inside a wall.
 *
 * Fixture traps (shared with `widget.walk.test.ts`): happy-dom has no layout,
 * so `getBoundingClientRect` is stubbed for real cell metrics, and the motion
 * loop's `dt` comes from the rAF timestamp — which is why the walking speed
 * below is absurd (the frames are ~2 ms apart here) and the assertions are
 * about where the walker ENDS UP rather than how long it took.
 *
 * That trap used to be a real one, and it is now closed rather than lived
 * with. The motion loop's `dt` is `rAF timestamp - previous`, clamped to
 * `[1, 64]` ms, and every distance below is `SPEED * dt`. Left on the wall
 * clock the harness sits ON the 1 ms floor, so it is calibrated for frames
 * that cost nothing — and a machine under load (a full-suite run, another
 * test file in the same worker pool) pushes a frame to 10 or 60 ms and
 * multiplies one step by up to 64. The two clauses with the tightest windows
 * (a two-frame drive that has to stay short of `STREAM_WALL_M / 2`, and the
 * slide's tangential travel) failed intermittently that way, on a build that
 * changed nothing about collision.
 *
 * So `requestAnimationFrame` is STUBBED here with a clock that advances by
 * exactly {@link RAF_STEP_MS} per frame, and `driveForward` waits on a plain
 * macrotask instead of on a frame of its own. That reproduces the numbers
 * this file was written against exactly — the first frame carries the loop's
 * own 16 ms seed and every later one is the 1 ms floor, so an unobstructed
 * 40-frame drive is 55 m and a two-frame one is 17 m — while making them the
 * SAME numbers on every machine. No assertion moved.
 *
 * Every walk here also declines the SKY (`sky: false`): it is a backdrop and
 * nothing in this file looks at a pixel, so its geometry and compositor pass
 * are cost this file has no reason to pay.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createGlyphMap } from "./widget";
import { GLYPH_MAP_WALK_BODY_RADIUS_M } from "./walkCollision";
import { GLYPH_MAP_EARTH_RADIUS_M, glyphMapGlobe } from "./projection";
import type { GlyphMapLayer } from "./widget";
import type { GlyphMapVectorProvider, GlyphMapVectorTile } from "./vector/types";

const COLS = 140, ROWS = 63, CELL_W = 8, CELL_H = 16, BASE_FONT_PX = 16;
const ZURICH: readonly [number, number] = [8.5445, 47.37418];
const METRES_PER_DEGREE = GLYPH_MAP_EARTH_RADIUS_M * (Math.PI / 180);
/**
 * Metres per second. Deliberately not a walking pace: the harness's rAF
 * frames land ~2 ms apart, so this is what makes 40 frames a walk of tens of
 * metres rather than of centimetres. The step it produces (~1.9 m) is still
 * subdivided by the resolver into sub-steps well under a body radius.
 */
const SPEED = 1000;
/** Frames per drive — 55 m of ground covered unobstructed, far past any wall below. */
const FRAMES = 40;
/**
 * Milliseconds the stubbed frame clock advances per frame. `1` is the motion
 * loop's own `dt` FLOOR (`Math.max(1, now - previous)`), which is where this
 * harness's real frames already sat — so this pins the calibration the file
 * was written against rather than choosing a new one.
 */
const RAF_STEP_MS = 1;

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

/** Metres east/north of `ZURICH`, as lon/lat. */
function at(east: number, north: number, origin: readonly [number, number] = ZURICH): [number, number] {
  return [
    origin[0] + east / (METRES_PER_DEGREE * Math.cos(origin[1] * (Math.PI / 180))),
    origin[1] + north / METRES_PER_DEGREE,
  ];
}

/** How far east/north of `ZURICH` a lon/lat is, in metres. */
function eastNorth(p: readonly [number, number]): [number, number] {
  return [
    (p[0] - ZURICH[0]) * METRES_PER_DEGREE * Math.cos(ZURICH[1] * (Math.PI / 180)),
    (p[1] - ZURICH[1]) * METRES_PER_DEGREE,
  ];
}

/** A rectangular building, authored in metres about `ZURICH`. */
function building(west: number, east: number, south: number, north: number, height = 20) {
  return {
    id: `b-${west}-${east}-${south}-${north}`,
    geometryType: "polygon" as const,
    rings: [[
      at(west, south), at(east, south), at(east, north), at(west, north), at(west, south),
    ] as [number, number][]],
    properties: { render_height: height },
  };
}

const extrusion = (features: ReturnType<typeof building>[]): GlyphMapLayer => ({
  type: "fill-extrusion",
  source: { features },
  color: "#cccccc",
  heightProperty: "render_height",
});

/**
 * A frame clock that advances by exactly {@link RAF_STEP_MS} per FIRED
 * callback. Installed per mount and torn down by `vi.unstubAllGlobals()`.
 */
let rafClock = 0;
function stubDeterministicFrames(): void {
  rafClock = 0;
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => setTimeout(() => {
    rafClock += RAF_STEP_MS;
    cb(rafClock);
  }, 0) as unknown as number);
  vi.stubGlobal("cancelAnimationFrame", (id: number) => { clearTimeout(id as unknown as ReturnType<typeof setTimeout>); });
}

function mount(layers: GlyphMapLayer[] = []) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  stubMonospaceMetrics(host);
  stubDeterministicFrames();
  const map = createGlyphMap(host, {
    projection: glyphMapGlobe(),
    view: { center: [...ZURICH] as [number, number], span: 0.01, cols: COLS, rows: ROWS },
    layers,
  });
  return { map, host, done: () => { map.destroy(); host.remove(); } };
}

function key(host: HTMLElement, type: "keydown" | "keyup", k: string): void {
  host.ownerDocument!.dispatchEvent(new KeyboardEvent(type, { key: k, bubbles: true, cancelable: true }));
}

/** Hold `w` (plus any extra keys) for `frames` displayed frames, and report where the walker ends up in metres. */
async function driveForward(host: HTMLElement, map: ReturnType<typeof createGlyphMap>, extra: string[] = [], frames = FRAMES): Promise<[number, number]> {
  for (const k of extra) key(host, "keydown", k);
  key(host, "keydown", "w");
  // A plain macrotask, NOT a frame of the test's own: the stubbed clock
  // advances once per fired callback, so borrowing a frame here would double
  // every `dt` and halve the calibration above.
  for (let i = 0; i < frames; i++) await new Promise<void>((resolve) => { setTimeout(resolve, 0); });
  key(host, "keyup", "w");
  for (const k of extra) key(host, "keyup", k);
  return eastNorth(map.getView().center);
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  stubbedHosts.clear();
});

/**
 * What an UNOBSTRUCTED drive covers, metres — a floor, not a figure. The
 * harness's rAF interval is not fixed, so the free walk measures 50-56 m
 * across runs; what every "walked through it" assertion needs is a number
 * comfortably past the far side of the 30 m-deep blocks below and nowhere
 * near where a stopped walker stands (9.7 m).
 */
const FREE_M = 40;
/** The face of every wall used below: a block filling 10..30 m north. */
const WALL_M = 10;
/** Where a walker stopped by that wall stands: a body short of it, within one sub-step. */
const STOPPED_MIN = WALL_M - GLYPH_MAP_WALK_BODY_RADIUS_M - 0.4;
const STOPPED_MAX = WALL_M - GLYPH_MAP_WALK_BODY_RADIUS_M + 1e-9;

describe("walk collision — buildings block", () => {
  it("walks straight through the same space with NOTHING mounted", async () => {
    // The control: without it, every assertion below could be satisfied by a
    // walker who simply never moves.
    const { map, host, done } = mount();
    map.setWalk({ speed: SPEED, sky: false });
    map.setBearing(0);
    const [, north] = await driveForward(host, map);
    expect(north).toBeGreaterThan(FREE_M);
    done();
  });

  it("STOPS a walker driven into a fill-extrusion, a body radius short of its wall", async () => {
    const { map, host, done } = mount([extrusion([building(-40, 40, WALL_M, 30)])]);
    map.setWalk({ speed: SPEED, sky: false });
    map.setBearing(0);
    const [east, north] = await driveForward(host, map);
    // Did not pass through — the reported defect, in one number.
    expect(north).toBeLessThan(STOPPED_MAX);
    // And did not stop early: it is against the wall, not stalled in the road.
    expect(north).toBeGreaterThan(STOPPED_MIN);
    // A wall does not push sideways.
    expect(Math.abs(east)).toBeLessThan(0.01);
    done();
  });

  it("does NOT block on a `fill` layer — a park, a lake, landcover stay walkable", async () => {
    const { map, host, done } = mount([{
      type: "fill",
      source: { features: [building(-40, 40, WALL_M, 30)] },
      color: "#224422",
    }]);
    map.setWalk({ speed: SPEED, sky: false });
    map.setBearing(0);
    const [, north] = await driveForward(host, map);
    expect(north).toBeGreaterThan(FREE_M);
    done();
  });

  it("SLIDES along the wall when it is taken at an angle", async () => {
    const { map, host, done } = mount([extrusion([building(-200, 200, WALL_M, 30)])]);
    map.setWalk({ speed: SPEED, sky: false });
    map.setBearing(45);
    const [east, north] = await driveForward(host, map);
    // Against the wall...
    expect(north).toBeLessThan(STOPPED_MAX);
    expect(north).toBeGreaterThan(STOPPED_MIN);
    // ...and a long way ALONG it. Halting on contact would have left the
    // walker at ~9.7 east; sliding keeps the whole tangential component of
    // every step after contact, so it is most of the 52 m of east intent.
    expect(east).toBeGreaterThan(30);
    done();
  });

  it("lets the walker through a gap between two buildings", async () => {
    const { map, host, done } = mount([extrusion([
      building(-40, -0.6, WALL_M, 30),
      building(0.6, 40, WALL_M, 30),
    ])]);
    map.setWalk({ speed: SPEED, sky: false });
    map.setBearing(0);
    const [, north] = await driveForward(host, map);
    // Out the far side of a 20 m deep block.
    expect(north).toBeGreaterThan(35);
    done();
  });
});

describe("walk collision — never trapped", () => {
  it("lets a walker STANDING INSIDE a building walk out of it", async () => {
    // The tile-streaming case. The walker is 5 m inside the block's SOUTH
    // edge and walks north, i.e. DEEPER for the next 25 m — the direction a
    // "may only reduce penetration" rule refuses, which would leave the
    // reader pressing a key with nothing happening.
    const { map, host, done } = mount([extrusion([building(-30, 30, -5, 55)])]);
    map.setWalk({ speed: SPEED, sky: false });
    map.setBearing(0);
    const [, north] = await driveForward(host, map);
    // Not merely "moved a bit": all the way out and well clear.
    expect(north).toBeGreaterThan(FREE_M);
    done();
  });

  it("a building that arrives AROUND the walker still lets them leave", async () => {
    const { map, host, done } = mount();
    map.setWalk({ speed: SPEED, sky: false });
    map.setBearing(0);
    // Mounted after the walk began, centred on the walker — the index has to
    // be invalidated for this to block anything at all, and the escape has to
    // fire for the walker to get anywhere.
    map.addLayer(extrusion([building(-30, 30, -5, 55)]));
    const [, north] = await driveForward(host, map);
    expect(north).toBeGreaterThan(FREE_M);
    done();
  });
});

describe("walk collision — the defeat key and the option", () => {
  it("passes through walls while `g` is held, and blocks again when it is released", async () => {
    const { map, host, done } = mount([extrusion([building(-40, 40, WALL_M, 30)])]);
    map.setWalk({ speed: SPEED, sky: false });
    map.setBearing(0);
    const [, ghosted] = await driveForward(host, map, ["g"]);
    expect(ghosted).toBeGreaterThan(FREE_M);

    // Turn around and walk back into the same block WITHOUT the key: it is
    // solid again, so the walker is stopped by its far (north) wall.
    map.setBearing(180);
    const [, back] = await driveForward(host, map);
    expect(back).toBeGreaterThan(30 + GLYPH_MAP_WALK_BODY_RADIUS_M - 1e-9);
    done();
  });

  it("a window BLUR releases the ghost key, like every other held key", async () => {
    const { map, host, done } = mount([extrusion([building(-40, 40, WALL_M, 30)])]);
    map.setWalk({ speed: SPEED, sky: false });
    map.setBearing(0);
    key(host, "keydown", "g");
    host.ownerDocument!.defaultView!.dispatchEvent(new Event("blur"));
    const [, north] = await driveForward(host, map);
    expect(north).toBeLessThan(STOPPED_MAX);
    done();
  });

  it("`collision: false` turns the whole model off", async () => {
    const { map, host, done } = mount([extrusion([building(-40, 40, WALL_M, 30)])]);
    map.setWalk({ speed: SPEED, collision: false, sky: false });
    map.setBearing(0);
    expect(map.getWalk()!.collision).toBe(false);
    const [, north] = await driveForward(host, map);
    expect(north).toBeGreaterThan(FREE_M);
    done();
  });

  it("defaults to ON", () => {
    const { map, done } = mount();
    map.setWalk({});
    expect(map.getWalk()!.collision).toBe(true);
    done();
  });
});

/**
 * A vector provider holding ONE tile that does not arrive until the test says
 * so — the streaming case, which is the whole reason the index is invalidated
 * on a rebuild rather than built once.
 */
function pendingProvider(features: ReturnType<typeof building>[]): { source: GlyphMapVectorProvider; land: () => void } {
  let land = () => {};
  const pending = new Promise<GlyphMapVectorTile>((resolve) => {
    land = () => resolve({
      z: 0, x: 0, y: 0,
      bounds: { west: -180, east: 180, south: -90, north: 90 },
      layers: { buildings: features },
      source: "synthetic",
      simplify: "none",
    });
  });
  return {
    land: () => land(),
    source: {
      id: "synthetic-buildings",
      zooms: [{ z: 0, cols: 1, rows: 1, tileLonSpan: 360, tileLatSpan: 180, tileCols: 4096, tileRows: 4096 }],
      bounds: () => ({ west: -180, east: 180, south: -90, north: 90 }),
      loadTile: () => pending,
    },
  };
}

describe("walk collision — the index follows the mounted layers", () => {
  it("blocks on buildings that STREAM IN after the index was first built", async () => {
    // Further out than the other walls here: the first frame of a drive
    // carries a large `dt` in this harness (~17 m), and the walker has to
    // take real steps BEFORE the tile lands for the index to be built empty.
    const STREAM_WALL_M = 60;
    const { source, land } = pendingProvider([building(-40, 40, STREAM_WALL_M, 90)]);
    const { map, host, done } = mount([{
      type: "fill-extrusion", source, sourceLayer: "buildings",
      color: "#cccccc", heightProperty: "render_height",
    }]);
    map.setWalk({ speed: SPEED, sky: false });
    map.setBearing(0);

    // Two frames with the tile still in flight: the walker moves, which is
    // what BUILDS the index — empty, because there is nothing mounted yet.
    const [, before] = await driveForward(host, map, [], 2);
    expect(before).toBeGreaterThan(0);
    expect(before).toBeLessThan(STREAM_WALL_M / 2);

    land();
    await vi.waitFor(() => {
      map.scene.rerender();
      expect((map.scene.output.textContent ?? "").replace(/[\s\n]/g, "").length).toBeGreaterThan(0);
    });

    // The wall that arrived is solid. A build-once index would walk the
    // reader straight through the block that just appeared in front of them.
    const [, after] = await driveForward(host, map, [], 60);
    expect(after).toBeLessThan(STREAM_WALL_M - GLYPH_MAP_WALK_BODY_RADIUS_M + 1e-9);
    expect(after).toBeGreaterThan(STREAM_WALL_M - GLYPH_MAP_WALK_BODY_RADIUS_M - 0.4);
    done();
  });

  it("frees the street again when the building layer is removed", async () => {
    const { map, host, done } = mount();
    const id = map.addLayer(extrusion([building(-40, 40, WALL_M, 30)]));
    map.setWalk({ speed: SPEED, sky: false });
    map.setBearing(0);
    const [, blocked] = await driveForward(host, map);
    expect(blocked).toBeLessThan(STOPPED_MAX);

    map.removeLayer(id);
    const [, freed] = await driveForward(host, map);
    // The index was rebuilt without it — a stale index would keep the wall
    // standing in a street with nothing in it.
    expect(freed).toBeGreaterThan(FREE_M);
    done();
  });
});
