/**
 * The reported live bug: "the extrusion fill sometimes fails to render the
 * walls or sides of the extrusion."
 *
 * "Sometimes" was the whole diagnosis. A `fill-extrusion`'s CAP is culled by
 * the rasterizer itself, from the face's own outward normal — a view-
 * independent property of the geometry, correct on every frame for free. Its
 * WALLS cannot work that way (tangential normals; see `layers.ts`'s "Far
 * hemisphere" section), so they were culled against `projection.visible` at
 * mesh BUILD time — and the mesh is built by `scheduleTileUpdate`, on a 180ms
 * debounce that EVERY moving frame re-arms. Through a drag and its inertial
 * glide, therefore, no rebuild ever ran: the walls kept the verdict taken for
 * a camera the view had long since left, so an extrusion the camera had
 * turned to face rendered its roof and none of its sides, and then popped its
 * sides in once motion stopped.
 *
 * Measured on this file's own fixture before the fix: 0 of 41 wall faces for
 * 681ms — the drag, the whole glide, and the debounce after it.
 *
 * The fix moves the verdict off the geometry: `glyphMapVectorMesh` emits every
 * wall (camera-independent, so a static source never rebuilds at all) and the
 * widget re-culls per rendered frame through `nearSideSyncs`, the same
 * registry that keeps a symbol's hemisphere visibility current. Measured cost
 * on the real baked z0 admin_0 tile (177 countries, 2,058 wall faces): 0.5ms
 * to re-cull against 13.7ms to rebuild the mesh.
 *
 * A settled-view test cannot see any of this — the debounce always wins
 * eventually. So the assertion here is per-snapshot ACROSS a real inertial
 * glide, against a reference map freshly mounted at that same view, exactly
 * the shape `widget.points.test.ts`'s label-flicker test uses one frame at a
 * time. The reference is freshly MOUNTED (not `setView`'d) on purpose: a
 * reference that shared the live map's staleness would agree with it and
 * assert nothing.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createGlyphMap, type GlyphMapHandle, type GlyphMapView } from "./widget";
import { glyphMapGlobe } from "./projection";
import type { GlyphMapVectorFeature } from "./vector/types";

const COLS = 120;
const ROWS = 48;
/** ~19% of the globe's radius: tall enough that the wall band is most of the shape's ink when seen obliquely. */
const WALL_HEIGHT_M = 1_200_000;

function mockHostRect(host: HTMLElement, width: number, height: number): void {
  Object.defineProperty(host, "getBoundingClientRect", {
    value: () => ({ width, height, top: 0, left: 0, right: width, bottom: height, x: 0, y: 0, toJSON() {} }),
    configurable: true,
  });
}

function ring(west: number, east: number, south: number, north: number, step = 5): [number, number][] {
  const out: [number, number][] = [];
  for (let lon = west; lon <= east; lon += step) out.push([lon, south]);
  for (let lat = south + step; lat <= north; lat += step) out.push([east, lat]);
  for (let lon = east - step; lon >= west; lon -= step) out.push([lon, north]);
  for (let lat = north - step; lat >= south; lat -= step) out.push([west, lat]);
  out.push([west, south]);
  return out;
}

/**
 * Placed so that at the mount view (`center: [0, 0]`) the box is beyond the
 * HORIZON, not merely beyond the limb. Those are different distances for a
 * tall extrusion: a 1,200 km top ring on a `radius: 1` globe stays clear of
 * the limb for `acos(1/1.188)` = 32.7 degrees of extra arc (see
 * `widget.extrusionHorizon.test.ts`), so a box starting at lon 95 — 5 degrees
 * past the limb — genuinely shows a wall band from the very first frame and
 * `starts at zero ink` below would be asserting the horizon bug, not the
 * staleness this file is about. The nearest corner here (lon 135, lat 20) is
 * 131.7 degrees of arc from the view centre, 9 degrees clear of that reach.
 */
const BOX: GlyphMapVectorFeature = {
  geometryType: "polygon",
  properties: { height: WALL_HEIGHT_M },
  rings: [ring(135, 180, -20, 20)],
  polygons: [[ring(135, 180, -20, 20)]],
};

function grids(host: HTMLElement): string[] {
  return Array.from(host.querySelectorAll("pre")).map((pre) => pre.textContent ?? "");
}

function inkedCells(gridList: readonly string[]): number {
  return gridList.reduce((n, grid) => n + [...grid].filter((c) => c !== " " && c !== "\n").length, 0);
}

function differingCells(before: readonly string[], after: readonly string[]): number {
  let n = 0;
  for (let g = 0; g < Math.max(before.length, after.length); g++) {
    const a = (before[g] ?? "").split("\n");
    const b = (after[g] ?? "").split("\n");
    for (let row = 0; row < Math.max(a.length, b.length); row++) {
      const ar = a[row] ?? "", br = b[row] ?? "";
      for (let col = 0; col < Math.max(ar.length, br.length); col++) if ((ar[col] ?? " ") !== (br[col] ?? " ")) n++;
    }
  }
  return n;
}

const live: { host: HTMLElement; map: GlyphMapHandle }[] = [];

function mount(center: readonly [number, number], span = 150): { host: HTMLElement; map: GlyphMapHandle } {
  const host = document.createElement("div");
  document.body.appendChild(host);
  mockHostRect(host, 1200, 600);
  const map = createGlyphMap(host, {
    view: { center: [center[0], center[1]], span, cols: COLS, rows: ROWS },
    projection: glyphMapGlobe({ radius: 1, exaggeration: 1 }),
    tilt: 0,
  });
  map.addLayer({
    type: "fill-extrusion", id: "box", color: "#ff0000",
    source: { features: [BOX] }, heightProperty: "height",
  });
  const entry = { host, map };
  live.push(entry);
  return entry;
}

const frame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
const settle = () => new Promise<void>((r) => setTimeout(r, 40));

function firePointer(host: HTMLElement, type: string, x: number): void {
  host.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: 300, pointerId: 1, bubbles: true }));
}

afterEach(() => {
  for (const { map, host } of live.splice(0)) { map.destroy(); host.remove(); }
  document.body.innerHTML = "";
});

interface Snapshot { readonly view: GlyphMapView; readonly grids: readonly string[] }

/**
 * Fling the globe eastward so the far-side box swings around to the limb —
 * the most oblique view of it there is, which is exactly where a wall band
 * contributes the most ink and a missing one is most visible — and snapshot
 * the rendered grids as the glide decays.
 *
 * Snapshots are taken on a LONGITUDE stride, not per animation frame: this
 * environment's `requestAnimationFrame` fires tens of thousands of times a
 * second, so a per-frame capture would be tens of thousands of identical
 * pictures rather than better coverage of the glide.
 */
async function glideSnapshots(host: HTMLElement, map: GlyphMapHandle): Promise<Snapshot[]> {
  firePointer(host, "pointerdown", 900);
  for (let i = 1; i <= 12; i++) { firePointer(host, "pointermove", 900 - i * 40); await frame(); }
  firePointer(host, "pointerup", 900 - 12 * 40);

  const snapshots: Snapshot[] = [];
  let lastLon = Number.NaN;
  const started = Date.now();
  let previous = map.getView().center[0];
  let still = 0;
  while (Date.now() - started < 3000) {
    await frame();
    const view = map.getView();
    const lon = view.center[0];
    still = lon === previous ? still + 1 : 0;
    previous = lon;
    if (!(Math.abs(lon - lastLon) < 3)) {
      lastLon = lon;
      snapshots.push({ view, grids: grids(host) });
    }
    if (still > 200) break;
  }
  return snapshots;
}

describe("fill-extrusion walls — the cull is a per-frame verdict, not baked geometry", () => {
  it("never drops a wall face during an inertial glide (every snapshot matches a map freshly built for that same view)", async () => {
    const { host, map } = mount([0, 0]);
    await settle();
    map.scene.rerender();
    // The box starts wholly beyond the horizon — past the limb by more than
    // its own top ring's horizon reach (see `BOX`) — so nothing of it is
    // drawn, and every wall the glide reveals is a wall the mount-time cull
    // removed.
    expect(inkedCells(grids(host))).toBe(0);

    const snapshots = await glideSnapshots(host, map);
    // A glide that barely moved would make every assertion below vacuous.
    expect(snapshots.length).toBeGreaterThan(4);
    expect(Math.abs(snapshots[snapshots.length - 1].view.center[0] - snapshots[0].view.center[0])).toBeGreaterThan(20);

    const stale: string[] = [];
    let revealed = 0;
    for (const snapshot of snapshots) {
      const reference = mount(snapshot.view.center, snapshot.view.span);
      await settle();
      reference.map.scene.rerender();
      const truth = grids(reference.host);
      revealed = Math.max(revealed, inkedCells(truth));
      const differing = differingCells(snapshot.grids, truth);
      if (differing) {
        stale.push(`lon ${snapshot.view.center[0].toFixed(1)}: ${differing} cells differ (live ${inkedCells(snapshot.grids)} ink, truth ${inkedCells(truth)})`);
      }
    }
    // The glide really did bring the extrusion into view — otherwise "no
    // frame differs" would just mean "nothing was ever drawn".
    expect(revealed).toBeGreaterThan(100);
    expect(stale).toEqual([]);
  }, 60000);

  it("shows the wall band, not just the roof, on the very first frame the box crosses the limb", async () => {
    // The user-visible shape of the defect: the cap is culled by the
    // rasterizer per frame and so was always right, while the walls carried a
    // stale verdict — an extrusion drawn as a flat lid with no sides.
    const { host, map } = mount([0, 0]);
    await settle();
    map.scene.rerender();
    expect(inkedCells(grids(host))).toBe(0);

    firePointer(host, "pointerdown", 1150);
    // ONE pointermove carries the box past the limb, with no frame awaited —
    // so neither the widget's own motion frame nor the 180ms tile debounce
    // has had any chance to run. The drag spans nearly the whole host width
    // because `BOX` now starts beyond the HORIZON rather than merely beyond
    // the limb (see its doc), which is 40 degrees further round.
    firePointer(host, "pointermove", 100);
    map.scene.rerender();
    firePointer(host, "pointerup", 100);

    const liveInk = inkedCells(grids(host));
    const reference = mount(map.getView().center, map.getView().span);
    await settle();
    reference.map.scene.rerender();
    expect(inkedCells(grids(reference.host))).toBeGreaterThan(100);
    expect(liveInk).toBe(inkedCells(grids(reference.host)));
    expect(differingCells(grids(host), grids(reference.host))).toBe(0);
  }, 60000);
});
