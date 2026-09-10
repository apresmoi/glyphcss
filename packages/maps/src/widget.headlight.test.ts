import { describe, expect, it } from "vitest";
import { createGlyphOrthographicCamera } from "glyphcss";
import { createGlyphMap, glyphMapHeadlightDirection } from "./widget";
import { glyphMapGlobe } from "./projection";
import { glyphMapSubsolarPoint, glyphMapSunDirection } from "./sun";
import type { GlyphMapClassifier } from "./types";
import type { GlyphMapGeoTile } from "./tile";

/**
 * `keyLight: "headlight"` — the "everything lit, like a globo terráqueo" mode.
 *
 * TWO clauses, and BOTH are load-bearing. A test asserting only "no dark
 * hemisphere" passes on pure ambient (directional intensity 0), which lights
 * every cell identically and so ERASES terrain relief — the whole reason the
 * terrain layer exists. So every headlight assertion here is paired with a
 * relief one, and the pure-ambient control below renders that alternative and
 * shows exactly what it costs.
 *
 * Fixture notes:
 *  - happy-dom has no layout, so `view.cols`/`rows` are given explicitly and
 *    `autoSize` stays off (the widget default) — the same shape
 *    `widget.sun.test.ts` uses.
 *  - `sin(180 - L) === sin(L)`, so a far-side point shares its near-side
 *    twin's COLUMN. Nothing here keys on a single projected point, but the
 *    quadrant probe below splits on ROWS as well as columns for that reason.
 */

const FLAT: GlyphMapClassifier = { id: "flat", orderStatistic: false, classifyValue: () => 0 };

const COLS = 40;
const ROWS = 20;
/** `COLS` cells plus the row's trailing newline, so `i % WIDTH` is a column. */
const WIDTH = COLS + 1;

const AMBIENT = 0.2;
const KEY_INTENSITY = 1.15;
/** The single palette grey every cell starts from, before the Lambert term. */
const BASE_GREY = 0xc0;
/** What a cell lit by AMBIENT ALONE renders as — the "unlit" floor. */
const AMBIENT_FLOOR = Math.floor(BASE_GREY * AMBIENT);

/**
 * A world tile whose vertex elevations either are flat or carry a strong
 * ripple. The ripple's job is to tilt each quad's face normal away from the
 * sphere's own outward normal — that tilt IS the terrain relief a map reads
 * shape from, and it is what pure ambient deletes.
 */
function worldTile(kind: "flat" | "ripple", cols = 24, rows = 12): GlyphMapGeoTile {
  const elevation = new Float32Array((cols + 1) * (rows + 1));
  if (kind === "ripple") {
    for (let y = 0; y <= rows; y++) {
      for (let x = 0; x <= cols; x++) {
        elevation[y * (cols + 1) + x] = ((x + y) % 2 === 0 ? 1 : -1) * 4000;
      }
    }
  }
  return {
    bounds: { west: -180, east: 180, south: -85, north: 85 },
    cols,
    rows,
    elevation,
    source: "synthetic",
    sampler: "nearest",
  };
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

interface Cell { readonly col: number; readonly row: number; readonly v: number; }

/** Every coloured (i.e. covered) cell of the render, with its red channel as a monotone brightness probe (the palette is one grey). */
function litCells(pre: HTMLElement): Cell[] {
  const colors = renderedColors(pre);
  const out: Cell[] = [];
  for (let i = 0; i < colors.length; i++) {
    const c = colors[i];
    if (!c) continue;
    out.push({ col: i % WIDTH, row: Math.floor(i / WIDTH), v: Number.parseInt(c.slice(1, 3), 16) });
  }
  return out;
}

const mean = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
function stddev(xs: readonly number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
}

interface MountOptions {
  readonly keyLight?: "fixed" | "headlight";
  readonly relief?: "flat" | "ripple";
  readonly ambient?: number;
  readonly intensity?: number;
  readonly center?: readonly [number, number];
}

function mount(o: MountOptions = {}) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const map = createGlyphMap(host, {
    view: { center: (o.center ?? [0, 0]) as [number, number], span: 120, cols: COLS, rows: ROWS },
    projection: glyphMapGlobe({ radius: 1, exaggeration: o.relief === "ripple" ? 300 : 0 }),
    keyLight: o.keyLight,
    scene: {
      // Deliberately aimed AWAY from the camera's own axis — this is exactly
      // the azimuth/elevation light the page's Full mode used to leave in
      // place, and the light a headlight has to override.
      directionalLight: { direction: [0.5, 0.7, 0.5], intensity: o.intensity ?? KEY_INTENSITY, color: "#ffffff" },
      ambientLight: { intensity: o.ambient ?? AMBIENT, color: "#ffffff" },
    },
    layers: [{ type: "raster", source: worldTile(o.relief ?? "flat"), classifier: FLAT, colors: ["#c0c0c0"] }],
  });
  map.scene.rerender();
  return {
    host,
    map,
    cells: () => litCells(map.scene.output),
    done: () => { map.destroy(); host.remove(); },
  };
}

/**
 * The visible disc split into four quadrants about its own centroid. A
 * headlight is radially symmetric about the view axis, so its four quadrant
 * means agree; ANY fixed off-axis light splits them.
 */
function quadrantMeans(cells: readonly Cell[]): number[] {
  const cx = mean(cells.map((c) => c.col));
  const cy = mean(cells.map((c) => c.row));
  const q: number[][] = [[], [], [], []];
  for (const c of cells) q[(c.col < cx ? 0 : 1) + (c.row < cy ? 0 : 2)].push(c.v);
  return q.map((xs) => (xs.length === 0 ? NaN : mean(xs)));
}

/** The cells in the middle of the disc, where the sphere's own curvature barely varies — so any shade variation there is RELIEF, not curvature. */
function centralPatch(cells: readonly Cell[]): number[] {
  const cx = mean(cells.map((c) => c.col));
  const cy = mean(cells.map((c) => c.row));
  const rx = Math.max(...cells.map((c) => Math.abs(c.col - cx)));
  const ry = Math.max(...cells.map((c) => Math.abs(c.row - cy)));
  return cells
    .filter((c) => Math.abs(c.col - cx) <= rx * 0.35 && Math.abs(c.row - cy) <= ry * 0.35)
    .map((c) => c.v);
}

describe("createGlyphMap — keyLight: 'headlight' (the page's Full sun mode)", () => {
  it("lights the WHOLE visible face: no dark hemisphere, no cell left at the ambient floor", () => {
    const lit = mount({ keyLight: "headlight" });
    const cells = lit.cells();
    expect(cells.length).toBeGreaterThan(100);

    const q = quadrantMeans(cells);
    // Radially symmetric about the view axis: no half is the "night" half.
    expect(Math.max(...q) - Math.min(...q)).toBeLessThan(6);
    // Nothing sits at the ambient-only floor — every covered cell takes real
    // key light.
    expect(Math.min(...cells.map((c) => c.v))).toBeGreaterThan(AMBIENT_FLOOR + 4);
    lit.done();
  });

  it("is what the FIXED light cannot do: the same scene un-headlit has a genuinely dark half", () => {
    const fixed = mount({ keyLight: "fixed" });
    const q = quadrantMeans(fixed.cells());
    // The pre-fix behaviour, pinned so this test can never quietly become
    // vacuous: an off-axis fixed light splits the disc into lit and dark.
    expect(Math.max(...q) - Math.min(...q)).toBeGreaterThan(20);
    fixed.done();
  });

  it("keeps terrain relief legible — the ripple varies shade where the sphere's own curvature does not", () => {
    const flat = mount({ keyLight: "headlight", relief: "flat" });
    const flatSpread = stddev(centralPatch(flat.cells()));
    flat.done();

    const ripple = mount({ keyLight: "headlight", relief: "ripple" });
    const rippleSpread = stddev(centralPatch(ripple.cells()));
    ripple.done();

    // Curvature alone is nearly flat across the middle of the disc; the
    // relief is not.
    expect(rippleSpread).toBeGreaterThan(flatSpread + 8);
  });

  it("pure ambient (the alternative mechanism) has no dark half EITHER — and flattens the relief to nothing", () => {
    // Mechanism (b), rendered rather than asserted from theory: ambient at
    // full, key at zero. It passes the "no dark hemisphere" clause and fails
    // the relief one, which is why that clause alone would have hidden it.
    const ambientOnly = mount({ keyLight: "fixed", relief: "ripple", ambient: 1, intensity: 0 });
    const cells = ambientOnly.cells();
    const q = quadrantMeans(cells);
    expect(Math.max(...q) - Math.min(...q)).toBeLessThan(6);
    // Every covered cell renders the SAME colour: the map is flat paint.
    expect(new Set(cells.map((c) => c.v)).size).toBe(1);
    expect(stddev(centralPatch(cells))).toBe(0);
    ambientOnly.done();
  });

  it("follows the camera as it orbits: the lit centre moves with the view, it does not just move the dark side", () => {
    const a = mount({ keyLight: "headlight", center: [0, 0] });
    const dirA = a.map.getKeyLightDirection()!;
    const qa = quadrantMeans(a.cells());
    a.done();

    const b = mount({ keyLight: "headlight", center: [90, 30] });
    const dirB = b.map.getKeyLightDirection()!;
    const qb = quadrantMeans(b.cells());
    b.done();

    // The light genuinely moved with the camera...
    expect(dirA).not.toEqual(dirB);
    // ...and BOTH views are evenly lit, which is the whole claim: a light
    // that merely rotated would leave one of them with a dark half.
    expect(Math.max(...qa) - Math.min(...qa)).toBeLessThan(6);
    expect(Math.max(...qb) - Math.min(...qb)).toBeLessThan(6);
  });
});

describe("glyphMapHeadlightDirection — the sign convention, proved against the real camera", () => {
  /**
   * glyphcss's `direction` is the vector from the shaded surface TOWARD the
   * light (AGENTS.md, "Numeric conventions"). A headlight's light IS the
   * camera, so the claim to prove is: stepping a world point along `+d`
   * moves it TOWARD the camera, i.e. strictly INCREASES its projected depth
   * (`rasterize.ts`'s convention, larger = nearer). `-d` must strictly
   * decrease it — which is what fails if the sign is flipped.
   */
  it("points TOWARD the camera: +d increases projected depth, -d decreases it", () => {
    const grid = { cols: 40, rows: 20, cellAspect: 0.5 } as const;
    const depth = (cam: ReturnType<typeof createGlyphOrthographicCamera>, p: readonly [number, number, number]) =>
      cam.project(p as [number, number, number], grid.cols, grid.rows, grid.cellAspect)[2];

    for (const [rotX, rotY] of [[90, 0], [0, 0], [65, 45], [120, -30], [40, 200], [12.5, 77.25]]) {
      const cam = createGlyphOrthographicCamera({ zoom: 1, rotX, rotY });
      const d = glyphMapHeadlightDirection(rotX, rotY);
      expect(Math.hypot(d[0], d[1], d[2])).toBeCloseTo(1, 12);
      // Probed from several unrelated origins: an orthographic camera's depth
      // is affine, so this holds everywhere or nowhere.
      for (const o of [[0, 0, 0], [0.3, -0.7, 0.2], [-1.5, 2, -0.4]] as const) {
        const here = depth(cam, o);
        const toward = depth(cam, [o[0] + 0.1 * d[0], o[1] + 0.1 * d[1], o[2] + 0.1 * d[2]]);
        const away = depth(cam, [o[0] - 0.1 * d[0], o[1] - 0.1 * d[1], o[2] - 0.1 * d[2]]);
        expect(toward).toBeGreaterThan(here);
        expect(away).toBeLessThan(here);
      }
    }
  });

  /**
   * The independent cross-check: `glyphMapGlobe.cameraForCenter(lon, lat)` is
   * the camera framing that puts `(lon, lat)` at the centre of the visible
   * disc, and `glyphMapSunDirection` is the light direction for a sun
   * DIRECTLY OVERHEAD there. A headlight is a sun overhead at the point you
   * are looking at, so the two must be the same vector — two independently
   * authored derivations meeting.
   */
  it("equals the SUN direction for a subsolar point at the view centre", () => {
    const globe = glyphMapGlobe({ radius: 1, exaggeration: 0 });
    // An instant, and the view centred exactly on the subsolar point it
    // resolves to.
    const at = Date.UTC(2024, 6, 4, 9, 30, 0);
    const sub = glyphMapSubsolarPoint(at);
    const { rotX, rotY } = globe.cameraForCenter!(sub.lon, sub.lat);
    const head = glyphMapHeadlightDirection(rotX, rotY);
    const sun = glyphMapSunDirection(globe, at)!;
    expect(head[0]).toBeCloseTo(sun[0], 12);
    expect(head[1]).toBeCloseTo(sun[1], 12);
    expect(head[2]).toBeCloseTo(sun[2], 12);
  });
});

describe("createGlyphMap — keyLight mode plumbing", () => {
  const globe = () => glyphMapGlobe({ radius: 1, exaggeration: 0 });

  function bare(keyLight?: "fixed" | "headlight", sun?: Parameters<typeof createGlyphMap>[1]["sun"]) {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const map = createGlyphMap(host, {
      view: { center: [0, 0], span: 120, cols: COLS, rows: ROWS },
      projection: globe(),
      keyLight,
      sun,
      scene: { directionalLight: { direction: [0.5, 0.7, 0.5], intensity: KEY_INTENSITY, color: "#abcdef" } },
      layers: [{ type: "raster", source: worldTile("flat"), classifier: FLAT, colors: ["#c0c0c0"] }],
    });
    map.scene.rerender();
    return { host, map, done: () => { map.destroy(); host.remove(); } };
  }

  it("'fixed' is the default and touches nothing — byte-identical to omitting it", () => {
    const omitted = bare(undefined);
    expect(omitted.map.getKeyLight()).toBe("fixed");
    expect(omitted.map.getKeyLightDirection()).toBeNull();
    expect(omitted.map.scene.getOptions().directionalLight).toEqual({ direction: [0.5, 0.7, 0.5], intensity: KEY_INTENSITY, color: "#abcdef" });
    const html = omitted.map.scene.output.innerHTML;
    omitted.done();

    const explicit = bare("fixed");
    expect(explicit.map.scene.output.innerHTML).toBe(html);
    explicit.done();
  });

  it("writes DIRECTION only — the consumer's intensity and colour survive", () => {
    const lit = bare("headlight");
    const light = lit.map.scene.getOptions().directionalLight!;
    expect(light.direction).toEqual(glyphMapHeadlightDirection(90, 0));
    expect(light.intensity).toBe(KEY_INTENSITY);
    expect(light.color).toBe("#abcdef");
    lit.done();
  });

  it("follows the camera through setView, setTilt and setKeyLight", () => {
    const lit = bare("headlight");
    const dirNow = () => lit.map.scene.getOptions().directionalLight!.direction;

    lit.map.setView({ center: [40, -25] });
    expect(dirNow()).toEqual(lit.map.getKeyLightDirection());
    const afterView = [...dirNow()];

    lit.map.setTilt(20);
    expect(dirNow()).toEqual(lit.map.getKeyLightDirection());
    expect(dirNow()).not.toEqual(afterView);

    // Switching back to "fixed" stops the widget updating it (the last value
    // stays — the consumer owns the field).
    const parked = [...dirNow()];
    lit.map.setKeyLight("fixed");
    expect(lit.map.getKeyLightDirection()).toBeNull();
    lit.map.setView({ center: [-120, 60] });
    expect(dirNow()).toEqual(parked);

    // ...and switching back on resumes from wherever the camera now is.
    lit.map.setKeyLight("headlight");
    expect(dirNow()).toEqual(lit.map.getKeyLightDirection());
    expect(dirNow()).not.toEqual(parked);
    lit.done();
  });

  it("the SUN still wins: 'realtime'/'manual' are unchanged by a headlight being on", () => {
    const date = Date.UTC(2024, 5, 21, 12, 0, 0);
    const sunOnly = bare("fixed", { mode: "manual", date });
    const sunDir = [...sunOnly.map.scene.getOptions().directionalLight!.direction];
    const sunHtml = sunOnly.map.scene.output.innerHTML;
    sunOnly.done();

    const both = bare("headlight", { mode: "manual", date });
    expect(both.map.scene.getOptions().directionalLight!.direction).toEqual(sunDir);
    expect(both.map.getKeyLightDirection()).toEqual(both.map.getSunDirection());
    // Same render, to the byte: turning the headlight on changed nothing at
    // all while the sun owns the light.
    expect(both.map.scene.output.innerHTML).toBe(sunHtml);

    // And the sun keeps owning it as the camera moves.
    both.map.setView({ center: [70, 10] });
    expect(both.map.scene.getOptions().directionalLight!.direction).toEqual(sunDir);
    both.done();
  });

  it("hands the key light back to the headlight the moment the sun is switched off", () => {
    const map = bare("headlight", { mode: "manual", date: Date.UTC(2024, 5, 21, 12, 0, 0) });
    expect(map.map.getKeyLightDirection()).toEqual(map.map.getSunDirection());
    map.map.setSun({ mode: "off" });
    expect(map.map.getSunDirection()).toBeNull();
    expect(map.map.scene.getOptions().directionalLight!.direction).toEqual(glyphMapHeadlightDirection(90, 0));
    map.done();
  });
});
