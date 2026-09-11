/**
 * FIDELITY GATE for the cross-layer occlusion path at `density > 1`.
 *
 * Every other fidelity gate this repo owns is a browser digest of `/maps`
 * (`bench/maps-render`'s eight-waypoint globe digest at two grid shapes, and
 * an ad-hoc street-level walk digest), and all three take their samples from
 * scenes whose geometry lives in the BASE grid. None of them covers a scene
 * with a separated detail layer at a density above 1 — which is precisely the
 * configuration `computeOcclusionIds` exists for, and therefore the only
 * configuration in which a change to it can move a cell. A change to the
 * id-map raster is invisible to all three by construction, so this file is
 * the gate that can see it.
 *
 * ## What it hashes
 *
 * Every `<pre>` the scene produces — the base grid plus each detail output,
 * each with its own CSS `transform`, in DOM order — over a table of scenes
 * crossed with camera poses. That is the same quantity `bench/maps-render`'s
 * digest hashes, taken here against a deterministic in-process scene instead
 * of a live page, so it is reproducible to the bit rather than "reproducible
 * within one build" (the browser digest's own documented limit).
 *
 * ## What each scene is for
 *
 * The guarantees this path carries are listed in `AGENTS.md`'s "Per-mesh
 * detail layers"; a digest that exercised only one of them would pass while
 * another broke, so the table covers them one clause at a time:
 *
 *  - `density` — two detail layers at 2x and 3x over a relief base: the
 *    plain cross-layer blanking decision and the SAME-POINT ownership
 *    refinement (`OcclusionMap.slopeCol`), which only runs when no group
 *    overrides the claim.
 *  - `group` — four tiles under one `detailGroup`, i.e. one id, one lattice.
 *  - `alpha` — a textured detail quad with a transparent margin over a
 *    textured base, samplers supplied procedurally through
 *    `setTextureSamplers`: the alpha-aware claim.
 *  - `claims` — `occlusionPriority` + `occlusionContourPx` + `occlusionClaim`
 *    together, which is the branch that takes the FINE internal raster and
 *    withholds the slope refinement.
 *  - `supersample` — the id-map built at the scene's supersample, where the
 *    map's lattice and the detail output's differ by more than the density.
 *  - `street` — a positioned PERSPECTIVE camera standing inside its own
 *    geometry, so most polygons straddle the near plane: the id-map's own
 *    near-plane clip, and the depth fork (`project()[3] ?? [2]`).
 *  - `culled` — `street` again with a consumer-driven cull marking 85% of the
 *    walls `Polygon.hidden`, the ratio `@glyphcss/maps`' walk-mode wall cull
 *    produces. This is the ONE scene in the table whose digest is expected to
 *    move when the id-map starts honouring `hidden`, and it is separated from
 *    the rest for exactly that reason: the other six pin byte-identity, this
 *    one pins the fix.
 *
 * ## Non-blank guard
 *
 * A digest over blank grids is stable and worthless, so every scene/pose
 * asserts a minimum painted-cell count in the base grid AND in the detail
 * outputs before its hash is taken. `bench/maps-render` carries the same
 * guard for the same reason.
 */
import { describe, expect, it, afterEach } from "vitest";
import { createHash } from "node:crypto";
import { createGlyphScene } from "./createGlyphScene";
import { createGlyphOrthographicCamera, createGlyphPerspectiveCamera } from "./createGlyphCamera";
import type { GlyphSceneOptions, GlyphMeshTransform } from "./types";
import type { Polygon, Vec3 } from "@glyphcss/core";
import type { TextureSampler } from "@glyphcss/core";

const COLS = 64;
const ROWS = 28;
const ASPECT = 2;

afterEach(() => { document.body.innerHTML = ""; });

function host(): HTMLElement {
  const div = document.createElement("div");
  document.body.appendChild(div);
  return div;
}

/** Deterministic value noise — the same relief for every run of this file. */
function noise(x: number, y: number): number {
  const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return s - Math.floor(s);
}

/** A `n x n` height-field patch spanning `[x0,x1] x [y0,y1]`, quads. */
function relief(x0: number, x1: number, y0: number, y1: number, n: number, amp: number, color: (h: number) => string): Polygon[] {
  const out: Polygon[] = [];
  const at = (i: number, j: number): Vec3 => {
    const x = x0 + ((x1 - x0) * i) / n, y = y0 + ((y1 - y0) * j) / n;
    return [x, y, (noise(i * 0.7, j * 1.3) - 0.5) * amp];
  };
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const a = at(i, j), b = at(i + 1, j), c = at(i + 1, j + 1), d = at(i, j + 1);
    out.push({ vertices: [a, b, c, d], color: color((a[2] + c[2]) / 2) });
  }
  return out;
}

const BANDS = ["#1c3f77", "#2f5a36", "#5f7536", "#9c7b50", "#cdb49a", "#f0f0f0"];
const band = (h: number): string => BANDS[Math.max(0, Math.min(BANDS.length - 1, Math.floor((h + 0.5) * BANDS.length)))]!;

/** Flat quad in the X/Y plane at `z`. */
function quad(z: number, x0: number, x1: number, y0: number, y1: number, color: string, extra: Partial<Polygon> = {}): Polygon {
  return { vertices: [[x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z]], color, ...extra };
}

/** Axis-aligned box walls + cap, standing on z=0 — a city block. */
function building(cx: number, cy: number, w: number, h: number, color: string, hidden: (i: number) => boolean): Polygon[] {
  const out: Polygon[] = [];
  const c: Vec3[] = [[cx - w, cy - w, 0], [cx + w, cy - w, 0], [cx + w, cy + w, 0], [cx - w, cy + w, 0]];
  for (let e = 0; e < 4; e++) {
    const a = c[e]!, b = c[(e + 1) % 4]!;
    out.push({ vertices: [a, b, [b[0], b[1], h], [a[0], a[1], h]], color, ...(hidden(e) ? { hidden: true } : {}) });
  }
  out.push({ vertices: c.map((v) => [v[0], v[1], h] as Vec3), color, ...(hidden(4) ? { hidden: true } : {}) });
  return out;
}

function city(cull: boolean): Polygon[] {
  const out: Polygon[] = [];
  let n = 0;
  // 85% of every polygon hidden when culling — `@glyphcss/maps`' walk-mode
  // wall cull hides 38,954 of 45,726 extrusion polygons per frame.
  const hidden = () => cull && (n++ % 20) >= 3;
  for (let y = -3; y <= 3; y++) for (let x = -3; x <= 3; x++) {
    if (x === 0 && y === 0) continue;
    out.push(...building(x * 9, y * 9, 3, 3 + ((x * 7 + y * 5 + 40) % 9), "#8d8478", hidden));
  }
  return out;
}

/** A 8x8 RGBA sampler with a transparent margin — the sprite case. */
function spriteSampler(): TextureSampler {
  const w = 8, h = 8, data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    const inside = x >= 2 && x <= 5 && y >= 2 && y <= 5;
    data[i] = inside ? 220 : 30;
    data[i + 1] = inside ? 90 : 30;
    data[i + 2] = inside ? 60 : 30;
    data[i + 3] = inside ? 255 : 0;
  }
  return { width: w, height: h, data, lowDetail: false };
}

/** Opaque 4x4 checker — a base plate that claims every texel. */
function plateSampler(): TextureSampler {
  const w = 4, h = 4, data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4, on = (x + y) % 2 === 0;
    data[i] = on ? 200 : 60; data[i + 1] = on ? 190 : 70; data[i + 2] = on ? 120 : 150; data[i + 3] = 255;
  }
  return { width: w, height: h, data, lowDetail: false };
}

const UV_QUAD: [number, number][] = [[0, 0], [1, 0], [1, 1], [0, 1]];

type Mesh = { polygons: Polygon[]; transform?: GlyphMeshTransform };
type Scene = {
  id: string;
  options?: Partial<GlyphSceneOptions>;
  meshes: Mesh[];
  samplers?: Map<string, TextureSampler>;
  /** Minimum painted cells: [base, detail total]. */
  minInk: [number, number];
};

const ORTHO_POSES: { id: string; cam: () => GlyphSceneOptions["camera"] }[] = [
  { id: "iso", cam: () => createGlyphOrthographicCamera({ rotX: 65, rotY: 45, zoom: 110 }) },
  { id: "front", cam: () => createGlyphOrthographicCamera({ rotX: 0, rotY: 0, zoom: 95 }) },
  { id: "tilt", cam: () => createGlyphOrthographicCamera({ rotX: 40, rotY: -20, zoom: 130 }) },
];

const STREET_POSES: { id: string; cam: () => GlyphSceneOptions["camera"] }[] = [
  { id: "eye-n", cam: () => createGlyphPerspectiveCamera({ rotX: 86, rotY: 0, zoom: 30, position: [0, -18, 2.2] }) },
  { id: "eye-e", cam: () => createGlyphPerspectiveCamera({ rotX: 74, rotY: 24, zoom: 30, position: [-6, -20, 3.5] }) },
];

const SCENES: Scene[] = [
  {
    id: "density",
    meshes: [
      { polygons: relief(-4, 4, -4, 4, 26, 1.2, band) },
      { polygons: relief(-2, 0, -2, 2, 14, 0.6, () => "#d05a3c"), transform: { density: 2, position: [0, 0, 0.9] } },
      { polygons: relief(0.2, 2, -2, 2, 14, 0.6, () => "#3cb0d0"), transform: { density: 3, position: [0, 0, 0.9] } },
    ],
    minInk: [175, 720],
  },
  {
    id: "group",
    meshes: [
      { polygons: relief(-4, 4, -4, 4, 22, 1.0, band) },
      { polygons: relief(-2, 0, -2, 0, 10, 0.4, () => "#d05a3c"), transform: { density: 2.4, detailGroup: "tiles", position: [0, 0, 0.8] } },
      { polygons: relief(0, 2, -2, 0, 10, 0.4, () => "#d0a03c"), transform: { density: 2.4, detailGroup: "tiles", position: [0, 0, 0.8] } },
      { polygons: relief(-2, 0, 0, 2, 10, 0.4, () => "#3cd07a"), transform: { density: 2.4, detailGroup: "tiles", position: [0, 0, 0.8] } },
      { polygons: relief(0, 2, 0, 2, 10, 0.4, () => "#3c7ad0"), transform: { density: 2.4, detailGroup: "tiles", position: [0, 0, 0.8] } },
    ],
    minInk: [169, 790],
  },
  {
    id: "alpha",
    samplers: new Map<string, TextureSampler>([["sprite", spriteSampler()], ["plate", plateSampler()]]),
    meshes: [
      {
        polygons: [
          quad(0, -4, 4, -4, 4, "#7a8a99", { uvs: [[0, 0], [4, 0], [4, 4], [0, 4]], texture: "plate", textureWrap: { s: "repeat", t: "repeat" } }),
        ],
      },
      {
        polygons: [quad(1.2, -2.4, 2.4, -2, 2, "#ffffff", { uvs: UV_QUAD, texture: "sprite" })],
        transform: { density: 2 },
      },
      { polygons: [quad(2.2, -1, 1, -0.6, 0.6, "#ff0044")], transform: { density: 3 } },
    ],
    minInk: [189, 180],
  },
  {
    id: "claims",
    samplers: new Map<string, TextureSampler>([["sprite", spriteSampler()]]),
    meshes: [
      { polygons: relief(-4, 4, -4, 4, 20, 1.0, band) },
      {
        polygons: [quad(-2, -3, 3, -2.5, 2.5, "#ffcc00", { uvs: UV_QUAD, texture: "sprite" })],
        transform: { density: 2, occlusionPriority: 2, occlusionContourPx: 3 },
      },
      { polygons: [quad(0.4, -1.5, 1.5, -1.2, 1.2, "#2255dd")], transform: { density: 1.5, occlusionClaim: "geometry" } },
    ],
    minInk: [165, 109],
  },
  {
    id: "supersample",
    options: { supersample: 2 },
    meshes: [
      { polygons: relief(-4, 4, -4, 4, 24, 1.1, band) },
      { polygons: relief(-2.5, 1, -2, 2, 12, 0.5, () => "#d05a3c"), transform: { density: 1.4, position: [0, 0, 0.85] } },
    ],
    minInk: [251, 216],
  },
];

const STREET_SCENES: Scene[] = [
  {
    id: "street",
    meshes: [
      { polygons: [quad(0, -40, 40, -40, 40, "#3d3d42")] },
      { polygons: city(false) },
      { polygons: [quad(0.02, -7, 7, -30, 30, "#c8c2a8")], transform: { density: 2 } },
    ],
    minInk: [341, 77],
  },
  {
    id: "culled",
    meshes: [
      { polygons: [quad(0, -40, 40, -40, 40, "#3d3d42")] },
      { polygons: city(true) },
      { polygons: [quad(0.02, -7, 7, -30, 30, "#c8c2a8")], transform: { density: 2 } },
    ],
    minInk: [256, 77],
  },
];

interface Grids { base: string; details: string[]; baseInk: number; detailInk: number }

function renderScene(scene: Scene, camera: GlyphSceneOptions["camera"]): Grids {
  const el = host();
  const s = createGlyphScene(el, {
    camera,
    cols: COLS, rows: ROWS, cellAspect: ASPECT,
    mode: "solid", useColors: true, doubleSided: false,
    glyphPalette: "ascii",
    directionalLight: { direction: [0.4, 0.5, 0.75], intensity: 0.8 },
    ambientLight: { intensity: 0.3 },
    ...scene.options,
  });
  if (scene.samplers) s.setTextureSamplers(scene.samplers);
  for (const m of scene.meshes) s.add(m.polygons, m.transform);
  s.rerender();
  const pres = Array.from(el.querySelectorAll("pre")) as HTMLPreElement[];
  const ink = (t: string): number => { let n = 0; for (const ch of t) if (ch !== " " && ch !== "\n") n++; return n; };
  let base = "", baseInk = 0, detailInk = 0;
  const details: string[] = [];
  for (const p of pres) {
    // Hash the transform beside the content: a detail `<pre>` that moved on
    // screen renders differently even with identical text.
    const payload = `${p.style.transform} ${p.innerHTML}`;
    if (p.className.includes("detail")) { details.push(payload); detailInk += ink(p.textContent ?? ""); }
    else { base = payload; baseInk = ink(p.textContent ?? ""); }
  }
  s.destroy();
  el.remove();
  return { base, details, baseInk, detailInk };
}

const h16 = (s: string): string => createHash("sha256").update(s).digest("hex").slice(0, 16);

function digestOf(scenes: Scene[], poses: { id: string; cam: () => GlyphSceneOptions["camera"] }[]): { total: string; per: Record<string, string> } {
  const per: Record<string, string> = {};
  const parts: string[] = [];
  for (const scene of scenes) for (const pose of poses) {
    const g = renderScene(scene, pose.cam());
    if (process.env.GLYPH_INK) console.log(`INK ${scene.id}/${pose.id} base=${g.baseInk} detail=${g.detailInk} pres=${g.details.length}`);
    expect(g.details.length, `${scene.id}/${pose.id}: no detail <pre> — the scene under test did not separate`).toBeGreaterThan(0);
    expect(g.baseInk, `${scene.id}/${pose.id}: base grid is blank — a digest here measures nothing`).toBeGreaterThanOrEqual(scene.minInk[0]);
    expect(g.detailInk, `${scene.id}/${pose.id}: detail grids are blank — a digest here measures nothing`).toBeGreaterThanOrEqual(scene.minInk[1]);
    const d = h16([g.base, ...g.details].join(""));
    per[`${scene.id}/${pose.id}`] = d;
    parts.push(d);
  }
  return { total: createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 24), per };
}

/**
 * Recorded on `main` at `b7f60e41`, and unchanged by either half of the
 * id-map work (`Polygon.hidden`, then the pre-projection cull runs): NOT ONE
 * of these six scenes carries a hidden polygon, and a cull run that rejects
 * pre-projection claims nothing it would have claimed anyway.
 */
const OPAQUE_DIGEST = "8fb1206af6a43893b65cc871";
/**
 * The street table. `street` carries no hidden polygon and its two
 * sub-digests are pinned exactly as the six ortho scenes are; `culled` is the
 * clause the `hidden` fix MOVED, from `1b42f4fa5be67e4157049175` on `main` at
 * `b7f60e41` to the value below.
 *
 * Every moved cell was counted and classified, and they all move one way:
 * the detail road gains 797 cells (24 at `eye-n`, 773 at `eye-e`), every one
 * of them blank before and painted after, and the base grid loses 84 (2 and
 * 82), every one of them painted before and blank after. NOT ONE detail cell
 * was taken away and not one base cell was added. The 797 are cells the road
 * covers that a culled wall was claiming while painting nothing; the 84 are
 * cells the base grid was painting with geometry BEHIND the road, kept only
 * because a culled wall in front of both owned the id-map cell. Both are the
 * render of the scene the consumer's cull describes — which is the property
 * `rasterize.occlusionHidden.test.ts` pins directly, as cell-for-cell
 * equivalence with deleting those polygons outright.
 */
const STREET_DIGEST = "d532d577c1ffbf111b21ff54";

describe("detail-layer fidelity digest (density > 1)", () => {
  it("is unchanged across the ortho scene table", () => {
    const { total, per } = digestOf(SCENES, ORTHO_POSES);
    expect({ total, per }).toMatchSnapshot();
    expect(total).toBe(OPAQUE_DIGEST);
  });

  it("is unchanged across the street-level table", () => {
    const { total, per } = digestOf(STREET_SCENES, STREET_POSES);
    expect({ total, per }).toMatchSnapshot();
    expect(total).toBe(STREET_DIGEST);
  });

  /**
   * The DEFECT, stated as a property of the two street scenes rather than as
   * a hash: `culled` is `street` with 85% of the same polygons marked
   * `Polygon.hidden`, so the detail road can only gain cells — every cell it
   * loses in `street` is lost to a wall that, in `culled`, is not drawn at
   * all and paints nothing there. Equality is the bug: a polygon the consumer
   * culled still claimed the id-map cell and still blanked the layer beneath.
   *
   * Deleting the `hidden` skip in `computeOcclusionIds` turns the inequality
   * back into an equality, which is the mutation check for it.
   */
  it("a polygon the consumer culled stops blanking the layer behind it", () => {
    const street = STREET_POSES.map((p) => renderScene(STREET_SCENES[0]!, p.cam()));
    const culled = STREET_POSES.map((p) => renderScene(STREET_SCENES[1]!, p.cam()));
    // The cull is real: it removes painted cells from the base grid.
    for (let i = 0; i < street.length; i++) {
      expect(culled[i]!.baseInk, `${STREET_POSES[i]!.id}: the cull painted no fewer base cells`).toBeLessThan(street[i]!.baseInk);
    }
    // And the detail layer gets those cells back.
    const gained = street.map((s, i) => culled[i]!.detailInk - s.detailInk);
    expect(gained.every((g) => g > 0), `detail cells gained per pose: ${gained.join(", ")}`).toBe(true);
  });
});
