import { describe, expect, it } from "vitest";
import { createGlyphMap } from "./widget";
import { glyphMapEquirectangular, glyphMapGlobe } from "./projection";

declare global {
  // eslint-disable-next-line no-var
  var __glyphRenderStage: ((stage: string) => void) | undefined;
}

function mockHostRect(host: HTMLElement, width: number, height: number): void {
  Object.defineProperty(host, "getBoundingClientRect", {
    value: () => ({ width, height, top: 0, left: 0, right: width, bottom: height, x: 0, y: 0, toJSON() {} }),
    configurable: true,
  });
}

function mount(overrides: Partial<Parameters<typeof createGlyphMap>[1]> = {}) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  mockHostRect(host, 1200, 600);
  const map = createGlyphMap(host, {
    view: { center: [0, 20], span: 140, cols: 80, rows: 40 },
    projection: glyphMapGlobe(),
    tilt: 40,
    ...overrides,
  });
  return { host, map };
}

function firePointer(host: HTMLElement, type: string, x: number, y: number, pointerId = 1): void {
  host.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, pointerId, bubbles: true }));
}

/** Counts full render passes (`base-validate` is the first stage of one). */
function countRenders<T>(run: () => T): { renders: number; result: T } {
  let renders = 0;
  const previous = globalThis.__glyphRenderStage;
  globalThis.__glyphRenderStage = (stage) => { if (stage === "base-validate") renders++; };
  try {
    return { renders, result: run() };
  } finally {
    const seen = renders;
    globalThis.__glyphRenderStage = previous;
    renders = seen;
  }
}

const frame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * The rule the motion loop exists to enforce: input events accumulate state,
 * the FRAME renders. A trackpad emits 60-120 events/s in separate tasks, and
 * glyphcss coalesces renders on a microtask (which drains at the end of every
 * task) — so before the loop, N events inside one displayed frame bought N
 * complete grid renders and threw all but the last away unpainted.
 */
describe("createGlyphMap — one render per displayed frame", () => {
  it("a burst of pointermoves inside one frame costs ONE render, not one each", async () => {
    const { host, map } = mount();
    await frame();
    let renders = 0;
    const previous = globalThis.__glyphRenderStage;
    globalThis.__glyphRenderStage = (stage) => { if (stage === "base-validate") renders++; };
    try {
      firePointer(host, "pointerdown", 400, 300);
      for (let i = 1; i <= 12; i++) firePointer(host, "pointermove", 400 + i * 6, 300 + i * 3);
      // Every event has landed; nothing has been painted yet.
      expect(renders).toBe(0);
      await frame();
      expect(renders).toBe(1);
      firePointer(host, "pointerup", 400 + 12 * 6, 300 + 12 * 3);
    } finally {
      globalThis.__glyphRenderStage = previous;
    }
    map.destroy();
    host.remove();
  });

  it("a burst of wheel events inside one frame costs ONE render", async () => {
    const { host, map } = mount();
    await frame();
    let renders = 0;
    const previous = globalThis.__glyphRenderStage;
    globalThis.__glyphRenderStage = (stage) => { if (stage === "base-validate") renders++; };
    try {
      for (let i = 0; i < 10; i++) {
        host.dispatchEvent(new WheelEvent("wheel", { deltaY: -40, deltaMode: 0, cancelable: true, bubbles: true }));
      }
      await frame();
      expect(renders).toBe(1);
    } finally {
      globalThis.__glyphRenderStage = previous;
    }
    map.destroy();
    host.remove();
  });

  it("camera and view state still update SYNCHRONOUSLY per event — only the render is deferred", () => {
    const { host, map } = mount();
    const before = { rotY: map.scene.camera.rotY, lon: map.getView().center[0] };
    firePointer(host, "pointerdown", 400, 300);
    firePointer(host, "pointermove", 460, 300);
    // No frame has run. A caller reading `getView()`/`camera` between events
    // must not see the pre-gesture value.
    expect(map.scene.camera.rotY).not.toBe(before.rotY);
    expect(map.getView().center[0]).not.toBe(before.lon);
    firePointer(host, "pointerup", 460, 300);
    map.destroy();
    host.remove();
  });

  it("a settled map runs no animation frames at all", async () => {
    const { host, map } = mount();
    await frame();
    await wait(60);
    const { renders } = countRenders(() => undefined);
    let idleRenders = 0;
    const previous = globalThis.__glyphRenderStage;
    globalThis.__glyphRenderStage = (stage) => { if (stage === "base-validate") idleRenders++; };
    try {
      for (let i = 0; i < 6; i++) await frame();
      expect(idleRenders).toBe(0);
    } finally {
      globalThis.__glyphRenderStage = previous;
    }
    void renders;
    map.destroy();
    host.remove();
  });
});

describe("createGlyphMap — inertial glide", () => {
  it("keeps moving after pointerup, then stops on its own", async () => {
    const { host, map } = mount();
    await frame();
    firePointer(host, "pointerdown", 400, 300);
    for (let i = 1; i <= 8; i++) {
      firePointer(host, "pointermove", 400 + i * 24, 300);
      await frame();
    }
    firePointer(host, "pointerup", 400 + 8 * 24, 300);
    const atRelease = map.getView().center[0];
    await frame();
    await frame();
    const gliding = map.getView().center[0];
    expect(gliding).not.toBe(atRelease);

    // The glide decays to a stop rather than running forever.
    await wait(900);
    const settled = map.getView().center[0];
    await wait(200);
    expect(map.getView().center[0]).toBe(settled);
    map.destroy();
    host.remove();
  });

  it("a drag that PAUSED before release does not fling", async () => {
    const { host, map } = mount();
    await frame();
    firePointer(host, "pointerdown", 400, 300);
    for (let i = 1; i <= 6; i++) {
      firePointer(host, "pointermove", 400 + i * 24, 300);
      await frame();
    }
    await wait(140); // the finger stopped and rested before lifting
    firePointer(host, "pointerup", 400 + 6 * 24, 300);
    const atRelease = map.getView().center[0];
    await frame();
    await frame();
    expect(map.getView().center[0]).toBe(atRelease);
    map.destroy();
    host.remove();
  });

  it("grabbing the map again stops the glide where it is", async () => {
    const { host, map } = mount();
    await frame();
    firePointer(host, "pointerdown", 400, 300);
    for (let i = 1; i <= 8; i++) {
      firePointer(host, "pointermove", 400 + i * 24, 300);
      await frame();
    }
    firePointer(host, "pointerup", 400 + 8 * 24, 300);
    await frame();
    firePointer(host, "pointerdown", 500, 300);
    const grabbed = map.getView().center[0];
    await frame();
    await frame();
    expect(map.getView().center[0]).toBe(grabbed);
    firePointer(host, "pointerup", 500, 300);
    map.destroy();
    host.remove();
  });
});

describe("createGlyphMap — flyTo", () => {
  it("eases to the requested centre and span, and lands exactly on them", async () => {
    const { host, map } = mount();
    await frame();
    const flight = map.flyTo({ center: [120, -30], span: 20 }, { durationMs: 300 });
    await wait(120);
    const mid = map.getView();
    // Genuinely in flight: neither endpoint.
    expect(mid.center[0]).toBeGreaterThan(0);
    expect(mid.center[0]).toBeLessThan(120);
    await flight;
    expect(map.getView().center[0]).toBeCloseTo(120, 6);
    expect(map.getView().center[1]).toBeCloseTo(-30, 6);
    expect(map.getView().span).toBeCloseTo(20, 6);
    map.destroy();
    host.remove();
  });

  it("bows the span OUT at mid-arc so a long flight never skims at final detail", async () => {
    const { host, map } = mount({ view: { center: [0, 20], span: 60, cols: 80, rows: 40 } });
    await frame();
    const flight = map.flyTo({ center: [170, -40], span: 6 }, { durationMs: 400, bow: 3 });
    await wait(180);
    // Mid-arc span is ABOVE both endpoints — that is the bow, and it is what
    // bounds how much fine terrain is ever needed mid-flight.
    expect(map.getView().span).toBeGreaterThan(60);
    await flight;
    expect(map.getView().span).toBeCloseTo(6, 6);
    map.destroy();
    host.remove();
  });

  it("bow: 1 flies a straight log-span interpolation with no zoom-out", async () => {
    const { host, map } = mount({ view: { center: [0, 20], span: 60, cols: 80, rows: 40 } });
    await frame();
    const flight = map.flyTo({ center: [170, -40], span: 6 }, { durationMs: 300, bow: 1 });
    await wait(140);
    expect(map.getView().span).toBeLessThanOrEqual(60);
    await flight;
    map.destroy();
    host.remove();
  });

  it("takes the SHORTER longitude arc across the antimeridian", async () => {
    const { host, map } = mount({ view: { center: [170, 0], span: 60, cols: 80, rows: 40 } });
    await frame();
    const flight = map.flyTo({ center: [-170, 0] }, { durationMs: 300 });
    await wait(140);
    // 20 degrees east through 180, never 340 degrees west through 0.
    const lon = map.getView().center[0];
    expect(lon).toBeGreaterThan(169);
    expect(lon).toBeLessThan(191);
    await flight;
    map.destroy();
    host.remove();
  });

  it("durationMs 0 is instant and equivalent to setView", async () => {
    const { host, map } = mount();
    await frame();
    await map.flyTo({ center: [45, -12], span: 33 }, { durationMs: 0 });
    expect(map.getView().center[0]).toBeCloseTo(45, 9);
    expect(map.getView().span).toBeCloseTo(33, 9);
    map.destroy();
    host.remove();
  });

  it("flyTo({ bounds }) frames the same box fitBounds does", async () => {
    const bounds = { west: 4, east: 12, south: 44, north: 49 };
    const a = mount();
    await frame();
    a.map.fitBounds(bounds);
    const fitted = a.map.getView();
    a.map.destroy();
    a.host.remove();

    const b = mount();
    await frame();
    await b.map.flyTo({ bounds }, { durationMs: 0 });
    expect(b.map.getView().center[0]).toBeCloseTo(fitted.center[0], 9);
    expect(b.map.getView().center[1]).toBeCloseTo(fitted.center[1], 9);
    expect(b.map.getView().span).toBeCloseTo(fitted.span, 9);
    b.map.destroy();
    b.host.remove();
  });

  it("an interrupted flight hands over CONTINUOUSLY from where the camera is, never snapping", async () => {
    const { host, map } = mount();
    await frame();
    const first = map.flyTo({ center: [170, -50], span: 8 }, { durationMs: 600 });
    await wait(260);
    const before = { rotX: map.scene.camera.rotX, rotY: map.scene.camera.rotY, zoom: map.scene.camera.zoom };

    const second = map.flyTo({ center: [-40, 60], span: 90 }, { durationMs: 600 });
    await frame();
    await frame();
    const after = { rotX: map.scene.camera.rotX, rotY: map.scene.camera.rotY, zoom: map.scene.camera.zoom };
    // The same acceptance shape as the projection-transition interrupt (J4):
    // a snap showed up there as tens of degrees and a >10x zoom step.
    expect(Math.abs(after.rotX - before.rotX)).toBeLessThan(5);
    expect(Math.abs(after.rotY - before.rotY)).toBeLessThan(5);
    expect(after.zoom / before.zoom).toBeGreaterThan(0.7);
    expect(after.zoom / before.zoom).toBeLessThan(1.3);
    await first;
    await second;
    map.destroy();
    host.remove();
  });

  it("a drag mid-flight takes over in place, and the abandoned flight still resolves", async () => {
    const { host, map } = mount();
    await frame();
    const flight = map.flyTo({ center: [170, -50], span: 8 }, { durationMs: 600 });
    await wait(200);
    const before = map.getView().center[0];
    firePointer(host, "pointerdown", 400, 300);
    firePointer(host, "pointermove", 402, 300);
    firePointer(host, "pointerup", 402, 300);
    await frame();
    // A tiny drag moves the view a tiny amount — the flight is not still
    // dragging it toward 170.
    expect(Math.abs(map.getView().center[0] - before)).toBeLessThan(5);
    await flight; // resolves rather than hanging the caller
    map.destroy();
    host.remove();
  });

  it("a flight abandoned by destroy() still resolves", async () => {
    const { host, map } = mount();
    await frame();
    const flight = map.flyTo({ center: [170, -50], span: 8 }, { durationMs: 600 });
    await wait(80);
    map.destroy();
    await flight;
    host.remove();
  });
});

describe("createGlyphMap — motion and projection transitions share one loop", () => {
  it("a projection transition still completes while the motion loop owns the frame", async () => {
    const { host, map } = mount();
    await frame();
    await map.setProjection(glyphMapEquirectangular(), { durationMs: 120 });
    // Settled on the exact endpoint: a sheet projection frames by target, not
    // by orbit rotation.
    expect(map.scene.camera.target.some((v) => v !== 0)).toBe(true);
    map.destroy();
    host.remove();
  });
});
