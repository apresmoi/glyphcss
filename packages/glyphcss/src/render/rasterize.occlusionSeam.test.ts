/**
 * Cross-layer occlusion SEAMS between two adjacent opaque detail layers.
 *
 * The shared occlusion id-map (`computeOcclusionIds`) is rasterized at the
 * BASE grid's own resolution (x the scene supersample), but a `density > 1`
 * detail layer renders at `density` x that resolution and looks its owner up
 * by point-sampling the id-map at each detail cell's centre
 * (`rasterize.ts`'s cross-layer blanking loop). Ownership is therefore
 * all-or-nothing per BASE cell, while coverage is decided per DETAIL cell.
 *
 * Where two adjacent meshes SHARE an edge — every tile boundary of a
 * `@glyphcss/maps` raster layer mounted at `density > 1`, which is what this
 * regression came in as — the base cell straddling that edge is claimed by
 * exactly one of them. The other blanks every one of its own detail cells
 * inside that base cell, even the ones it genuinely covers and the winner
 * does not. Nothing paints them: measured on the real `/maps` globe at
 * density 1.4, a median seam of 0.75 base cells over ~1,500 separate runs
 * per frame (~4% of the painted area), in BOTH axes, and present at integer
 * densities (2, 3) just as much as fractional ones.
 *
 * The fixture is the minimal form of that: two coplanar quads sharing the
 * edge `y = 0`, each mounted as its own opaque detail layer. They never
 * overlap, so cross-layer occlusion has nothing legitimate to hide — the
 * opaque render must be identical to the same scene rendered `transparent`
 * (which skips local blanking entirely and is otherwise the same
 * rasterization). Any difference IS the seam.
 *
 * Fixture notes: happy-dom has no layout, so `stubMonospaceMetrics` gives
 * the hidden cell probes a real advance — without it every detail layer
 * measures a zero-width cell and bails before rendering. `mode: "solid"`
 * (not `ink`) so a quad's winding cannot silently blank it. Screen col
 * tracks world Y and screen row tracks world X under this camera, so two
 * quads split on `y` are LEFT/RIGHT neighbours and the seam is a COLUMN —
 * assertions below name the exact column window rather than counting ink
 * across a whole row.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createGlyphScene } from "../api/createGlyphScene";
import { createGlyphOrthographicCamera } from "../api/createGlyphCamera";

const COLS = 60, ROWS = 24, CELL_W = 8, CELL_H = 16, PROBE_FONT_PX = 16;

const rect = (w: number, h: number) =>
  ({ width: w, height: h, top: 0, left: 0, right: w, bottom: h, x: 0, y: 0, toJSON() {} }) as DOMRect;
const EMPTY = rect(0, 0);

function stubMonospaceMetrics(): void {
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const el = this as HTMLElement;
    if (el.tagName !== "PRE" || !/visibility:\s*hidden/.test(el.style.cssText)) return EMPTY;
    const fontPx = parseFloat(/font-size:\s*([\d.]+)px/.exec(el.style.cssText)?.[1] ?? String(PROBE_FONT_PX));
    const k = fontPx / PROBE_FONT_PX;
    const lines = (el.textContent ?? "").split("\n").length || 1;
    return rect(CELL_W * k, CELL_H * k * lines);
  });
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

/** A quad in the z = 0 plane spanning world y in [y0, y1], x in [-3, 3], facing +Z. */
function quad(y0: number, y1: number) {
  return [{
    vertices: [[-3, y0, 0], [3, y0, 0], [3, y1, 0], [-3, y1, 0]] as [number, number, number][],
    color: "#3388cc",
  }];
}

function mount(density: number, transparent: boolean) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const scene = createGlyphScene(host, {
    cols: COLS, rows: ROWS, mode: "solid",
    camera: createGlyphOrthographicCamera({ rotX: 0, rotY: 0, zoom: 40 }),
  });
  scene.add(quad(-4, 0), { density, transparent });
  scene.add(quad(0, 4), { density, transparent });
  scene.rerender();
  return { host, scene, pres: Array.from(host.querySelectorAll<HTMLPreElement>("pre.glyph-output--detail")) };
}

/** Cells inked in `clear` (no local blanking) but blank in `opaque`, per detail layer. */
function occlusionBlanked(opaque: HTMLPreElement[], clear: HTMLPreElement[]): { total: number; perMesh: number[]; columns: number[][] } {
  const perMesh: number[] = [];
  const columns: number[][] = [];
  let total = 0;
  for (let i = 0; i < clear.length; i++) {
    const o = (opaque[i]?.textContent ?? "").split("\n");
    const c = (clear[i]?.textContent ?? "").split("\n");
    let n = 0;
    const cols = new Set<number>();
    for (let r = 0; r < c.length; r++) {
      const cr = c[r] ?? "", or = o[r] ?? "";
      for (let col = 0; col < cr.length; col++) {
        if (cr[col] !== " " && (or[col] ?? " ") === " ") { n++; cols.add(col); }
      }
    }
    perMesh.push(n);
    columns.push([...cols].sort((a, b) => a - b));
    total += n;
  }
  return { total, perMesh, columns };
}

describe("cross-layer occlusion — no seam between adjacent opaque detail layers", () => {
  // Both fractional and integer: the defect is NOT specific to a fractional
  // density (a plausible-sounding but wrong reading of the original report —
  // it reproduces identically at 2 and 3).
  for (const density of [1.4, 2, 3]) {
    it(`density ${density}: two edge-sharing coplanar meshes blank none of each other's cells`, () => {
      stubMonospaceMetrics();
      const opaque = mount(density, false);
      const clear = mount(density, true);

      // Both renders must actually have produced two detail grids with real
      // ink — otherwise "no difference" would pass for the wrong reason.
      expect(opaque.pres).toHaveLength(2);
      expect(clear.pres).toHaveLength(2);
      for (const p of clear.pres) {
        expect([...(p.textContent ?? "")].filter((ch) => ch !== " " && ch !== "\n").length).toBeGreaterThan(100);
      }

      const seam = occlusionBlanked(opaque.pres, clear.pres);
      expect({ perMesh: seam.perMesh, columns: seam.columns }).toEqual({ perMesh: [0, 0], columns: [[], []] });

      opaque.scene.destroy(); opaque.host.remove();
      clear.scene.destroy(); clear.host.remove();
    });
  }

  it("a mesh genuinely BEHIND another is still blanked where the nearer one covers it", () => {
    stubMonospaceMetrics();
    const host = document.createElement("div");
    document.body.appendChild(host);
    const scene = createGlyphScene(host, {
      cols: COLS, rows: ROWS, mode: "solid",
      camera: createGlyphOrthographicCamera({ rotX: 0, rotY: 0, zoom: 40 }),
    });
    // Far mesh spans the whole window; near mesh covers its right half at a
    // clearly nearer depth. The far mesh's own detail grid must lose exactly
    // the cells the near one covers — the occlusion this mechanism is FOR,
    // which the seam fix must not disable.
    scene.add([{ vertices: [[-3, -4, 0], [3, -4, 0], [3, 4, 0], [-3, 4, 0]] as [number, number, number][], color: "#3388cc" }], { density: 2 });
    scene.add([{ vertices: [[-3, 0, 2], [3, 0, 2], [3, 4, 2], [-3, 4, 2]] as [number, number, number][], color: "#cc3333" }], { density: 2 });
    scene.rerender();

    const pres = Array.from(host.querySelectorAll<HTMLPreElement>("pre.glyph-output--detail"));
    expect(pres).toHaveLength(2);
    const far = (pres[0]!.textContent ?? "").split("\n");
    // Count inked cells per column of the FAR mesh's grid: its right half
    // (under the near quad) must be substantially emptier than its left.
    const inkAt = (col: number) => far.reduce((n, line) => n + ((line[col] ?? " ") !== " " ? 1 : 0), 0);
    const width = Math.max(...far.map((l) => l.length));
    let left = 0, right = 0;
    for (let c = 0; c < width; c++) (c < width / 2 ? (left += inkAt(c)) : (right += inkAt(c)));
    expect(left).toBeGreaterThan(0);
    expect(right * 4).toBeLessThan(left);

    scene.destroy(); host.remove();
  });
});
