import { afterEach, describe, expect, it, vi } from "vitest";
import { createGlyphMap, type GlyphMapOptions } from "./widget";
import { glyphMapEquirectangular, glyphMapGlobe, glyphMapMercator } from "./projection";

const maps: ReturnType<typeof createGlyphMap>[] = [];
afterEach(() => {
  for (const m of maps.splice(0)) {
    m.destroy();
    m.host.remove();
  }
  vi.restoreAllMocks();
});
function mount(projection: GlyphMapOptions["projection"], snapPan?: boolean, tilt = 0, bearing = 0) {
  const host = document.createElement("div");
  document.body.append(host);
  const map = createGlyphMap(host, {
    view: { center: [-60, -20], span: 60, cols: 80, rows: 40 },
    projection,
    snapPan,
    tilt,
    bearing,
    layers: [
      {
        type: "fill",
        source: {
          features: [
            {
              rings: [
                [
                  [-75, -28],
                  [-48, -28],
                  [-48, -12],
                  [-75, -12],
                  [-75, -28],
                ],
              ],
            },
          ],
        },
        color: "#123456",
      },
      {
        type: "line",
        source: {
          features: [
            {
              rings: [
                [
                  [-75, -28],
                  [-48, -28],
                  [-48, -12],
                  [-75, -12],
                  [-75, -28],
                ],
              ],
            },
          ],
        },
        experimentalGlyphStrategy: "box",
      },
    ],
  });
  maps.push(map);
  return map;
}
const pose = (m: ReturnType<typeof createGlyphMap>) => {
  const c = m.scene.getOptions().camera!;
  return [c.rotX, c.rotY, c.zoom, ...c.target, ...(c.mat ?? [])];
};

describe("whole-cell rendered pan", () => {
  it.each([
    ["equirectangular", glyphMapEquirectangular],
    ["mercator", glyphMapMercator],
    ["globe", glyphMapGlobe],
  ] as const)("%s freezes sub-cell setView moves while retaining the exact view", async (_name, factory) => {
    const m = mount(factory(), true);
    await m.idle();
    const text = m.scene.output.textContent,
      initial = pose(m);
    for (const d of [0.001, 0.01, 0.02]) {
      m.setView({ center: [-60 + d, -20 + d] });
      await m.idle();
      expect(m.getView().center).toEqual([-60 + d, -20 + d]);
      expect(pose(m)).toEqual(initial);
      expect(m.scene.output.textContent).toBe(text);
    }
    m.setView({ center: [-59, -19] });
    await m.idle();
    expect(pose(m)).not.toEqual(initial);
  });
  it.each([
    [0, 0],
    [35, 0],
    [35, 43],
  ])("shifts a flat sheet rigidly by whole cells at tilt %s bearing %s", async (tilt, bearing) => {
    const m = mount(glyphMapEquirectangular(), true, tilt, bearing);
    await m.idle();
    const before = [
      [-70, -25],
      [-55, -15],
      [-64, -24],
    ].map((p) => m.project(p as [number, number]));
    const text = m.scene.output.textContent;
    m.setView({ center: [-57, -18] });
    await m.idle();
    const after = [
      [-70, -25],
      [-55, -15],
      [-64, -24],
    ].map((p) => m.project(p as [number, number]));
    const dc = after[0]!.col - before[0]!.col,
      dr = after[0]!.row - before[0]!.row;
    expect(Math.abs(dc) + Math.abs(dr)).toBeGreaterThan(0);
    expect(dc).toBeCloseTo(Math.round(dc), 9);
    expect(dr).toBeCloseTo(Math.round(dr), 9);
    for (let i = 1; i < 3; i++) {
      expect(after[i]!.col - before[i]!.col).toBeCloseTo(dc, 9);
      expect(after[i]!.row - before[i]!.row).toBeCloseTo(dr, 9);
    }
    expect(m.scene.output.textContent).not.toBe(text);
  });
  it("leaves zoom and tilt continuous and toggles back to the exact pose", async () => {
    const m = mount(glyphMapGlobe(), true);
    await m.idle();
    m.setView({ center: [-59.99, -19.99] });
    const p = pose(m);
    m.setView({ span: 59.99 });
    expect(pose(m)).not.toEqual(p);
    const q = pose(m);
    m.setTilt(0.001);
    expect(pose(m)).not.toEqual(q);
    m.setView({ center: [-59.98, -19.98] });
    m.setSnapPan(false);
    expect(m.getSnapPan()).toBe(false);
    const raw = mount(glyphMapGlobe(), false);
    await raw.idle();
    raw.setView({ center: m.getView().center, span: 59.99 });
    raw.setTilt(0.001);
    expect(pose(m)).toEqual(pose(raw));
  });
  it("keeps omitted and false output byte-identical through pan, zoom and tilt", async () => {
    const a = mount(glyphMapGlobe()),
      b = mount(glyphMapGlobe(), false);
    await Promise.all([a.idle(), b.idle()]);
    for (const center of [
      [-60, -20],
      [-59.97, -20.01],
      [-55, 0],
    ] as const) {
      for (const m of [a, b]) {
        m.setView({ center, span: 61 });
        m.setTilt(3);
        await m.idle();
      }
      expect(a.scene.output.textContent).toBe(b.scene.output.textContent);
      expect(pose(a)).toEqual(pose(b));
    }
  });
  it("accumulates exact sub-cell pointer deltas rather than losing them to snapping", async () => {
    const m = mount(glyphMapGlobe(), true);
    await m.idle();
    const initial = pose(m),
      start = m.getView().center;
    m.host.dispatchEvent(
      new PointerEvent("pointerdown", { pointerId: 1, clientX: 100, clientY: 100, button: 0, bubbles: true }),
    );
    for (let i = 1; i <= 4; i++)
      m.host.dispatchEvent(
        new PointerEvent("pointermove", {
          pointerId: 1,
          clientX: 100 + i * 0.1,
          clientY: 100,
          buttons: 1,
          bubbles: true,
        }),
      );
    expect(m.getView().center).not.toEqual(start);
    expect(pose(m)).toEqual(initial);
    m.host.dispatchEvent(
      new PointerEvent("pointermove", { pointerId: 1, clientX: 150, clientY: 100, buttons: 1, bubbles: true }),
    );
    expect(pose(m)).not.toEqual(initial);
    m.host.dispatchEvent(new PointerEvent("pointercancel", { pointerId: 1, bubbles: true }));
    await m.idle();
  });
});

// Known open: glyphcss dithers terrain by SCREEN cell (Bayer index), so a
// whole-cell shift still re-dithers fills. Flip to `it` once dithering is
// anchored to the content.
it.fails("moves the actual flat picture by exactly one cell, including fills and borders", async () => {
  const m = mount(glyphMapEquirectangular(), true);
  await m.idle();
  const before = (m.scene.output.textContent ?? "").split("\n").map((s) => s.padEnd(80));
  const center = m.project(m.getView().center),
    at = m.unproject([center.col + 1, center.row])!;
  m.setView({ center: at });
  await m.idle();
  const after = (m.scene.output.textContent ?? "").split("\n").map((s) => s.padEnd(80));
  expect(before.join("")).toMatch(/[─│┌┐└┘]/);
  expect(before.join("")).toMatch(/[^ ─│┌┐└┘\n]/);
  expect(after).not.toEqual(before);
  for (let r = 1; r < 39; r++) expect(after[r]!.slice(0, 79)).toBe(before[r]!.slice(1, 80));
});
it("keeps non-opted pans continuous", async () => {
  const m = mount(glyphMapGlobe());
  await m.idle();
  const p = pose(m);
  m.setView({ center: [-59.99, -19.99] });
  expect(pose(m)).not.toEqual(p);
  expect(m.project(m.getView().center).col).toBeCloseTo(40, 9);
});

it.each([
  [13.123, 47.456],
  [70, 89.99],
])("retains the anchor pose exactly at centre %s,%s with bearing and tilt", async (lon, lat) => {
  const m = mount(glyphMapGlobe(), true, 3, 32);
  m.setView({ center: [lon, lat] });
  m.setSnapPan(true);
  await m.idle();
  const p = pose(m);
  m.setView({ center: [lon + 1e-7, lat + 1e-7] });
  expect(pose(m)).toEqual(p);
});
it("does not resurrect a stale pan pose after changing projection", async () => {
  const m = mount(glyphMapGlobe(), true);
  await m.idle();
  m.setView({ center: [-59.99, -19.99] });
  await m.setProjection(glyphMapEquirectangular(), { duration: 0 });
  await m.idle();
  m.host.dispatchEvent(
    new PointerEvent("pointerdown", { pointerId: 1, clientX: 100, clientY: 100, button: 0, bubbles: true }),
  );
  m.host.dispatchEvent(
    new PointerEvent("pointermove", { pointerId: 1, clientX: 100.01, clientY: 100, buttons: 1, bubbles: true }),
  );
  expect(m.scene.getOptions().camera!.rotY).toBe(0);
  expect(m.getView().center[0]).toBeCloseTo(-59.99, 2);
  m.host.dispatchEvent(new PointerEvent("pointercancel", { pointerId: 1, bubbles: true }));
  await m.idle();
});

it("bypasses snapping while walking and restores the exact pan remainder on exit", async () => {
  const m = mount(glyphMapGlobe(), true);
  await m.idle();
  m.setView({ span: 0.01, center: [8, 47] });
  m.setView({ center: [8.000001, 47.000001] });
  const held = m.getView().center,
    p = pose(m);
  m.setWalk({ sky: false });
  await m.idle();
  const eye = pose(m);
  m.setView({ center: [held[0] + 1e-7, held[1] + 1e-7] });
  expect(pose(m)).not.toEqual(eye);
  m.setWalk(null);
  await m.idle();
  expect(m.getView().center).toEqual(held);
  expect(pose(m)).toEqual(p);
  const raw = mount(glyphMapGlobe(), false);
  raw.setView({ span: 0.01, center: held });
  await raw.idle();
  for (const map of [m, raw]) {
    map.host.dispatchEvent(
      new PointerEvent("pointerdown", { pointerId: 1, clientX: 100, clientY: 100, button: 0, bubbles: true }),
    );
    map.host.dispatchEvent(
      new PointerEvent("pointermove", { pointerId: 1, clientX: 100.001, clientY: 100, buttons: 1, bubbles: true }),
    );
  }
  expect(m.getView().center[0]).toBeCloseTo(raw.getView().center[0], 11);
  expect(m.getView().center[1]).toBeCloseTo(raw.getView().center[1], 11);
  for (const map of [m, raw])
    map.host.dispatchEvent(new PointerEvent("pointercancel", { pointerId: 1, bubbles: true }));
  await Promise.all([m.idle(), raw.idle()]);
});
