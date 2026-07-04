import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createGlyphScene } from "./createGlyphScene";
import { createGlyphOrbitControls } from "./createGlyphOrbitControls";
import type { GlyphSceneHandle } from "./createGlyphScene";

function makeScene(): GlyphSceneHandle {
  const host = document.createElement("div");
  document.body.appendChild(host);
  return createGlyphScene(host, { cols: 20, rows: 10 });
}

function pd(host: Element, x: number, y: number, pointerId = 1): void {
  host.dispatchEvent(
    new PointerEvent("pointerdown", {
      clientX: x, clientY: y, pointerId, isPrimary: true, bubbles: true,
    }),
  );
}

function pm(host: Element, x: number, y: number, pointerId = 1): void {
  host.dispatchEvent(
    new PointerEvent("pointermove", {
      clientX: x, clientY: y, pointerId, isPrimary: true, bubbles: true,
    }),
  );
}

function pu(host: Element, pointerId = 1): void {
  host.dispatchEvent(
    new PointerEvent("pointerup", { pointerId, isPrimary: true, bubbles: true }),
  );
}

describe("createGlyphOrbitControls", () => {
  let scene: GlyphSceneHandle;

  beforeEach(() => {
    scene = makeScene();
  });

  afterEach(() => {
    scene.destroy();
  });

  it("returns a handle with destroy()", () => {
    const controls = createGlyphOrbitControls(scene);
    expect(typeof controls.destroy).toBe("function");
    expect(typeof controls.pause).toBe("function");
    expect(typeof controls.resume).toBe("function");
    expect(typeof controls.update).toBe("function");
    controls.destroy();
  });

  it("two-finger pinch zooms the camera (spread = zoom in, pinch = zoom out)", () => {
    const controls = createGlyphOrbitControls(scene, { wheel: true });
    const dispatch = (type: string, x: number, y: number, pointerId: number, isPrimary: boolean) =>
      scene.host.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, pointerId, isPrimary, bubbles: true }));
    const initialZoom = scene.camera.zoom;
    // two fingers 50px apart
    dispatch("pointerdown", 100, 100, 1, true);
    dispatch("pointerdown", 150, 100, 2, false);
    // spread to 150px apart → ~3× zoom in
    dispatch("pointermove", 250, 100, 2, false);
    expect(scene.camera.zoom).toBeGreaterThan(initialZoom);
    const zoomedIn = scene.camera.zoom;
    // bring together to 20px → zoom out
    dispatch("pointermove", 120, 100, 2, false);
    expect(scene.camera.zoom).toBeLessThan(zoomedIn);
    pu(scene.host, 1);
    pu(scene.host, 2);
    controls.destroy();
  });

  it("dragging right decreases rotY (camera spins left)", () => {
    const controls = createGlyphOrbitControls(scene);
    const initialRotY = scene.camera.rotY;

    pd(scene.host, 100, 100);
    pm(scene.host, 200, 100); // dx = +100, dy = 0
    pu(scene.host);

    // rotY = rotY - dx * RAD_PER_PX → rotY decreases when dx > 0
    expect(scene.camera.rotY).toBeLessThan(initialRotY);
    controls.destroy();
  });

  it("dragging left increases rotY", () => {
    const controls = createGlyphOrbitControls(scene);
    const initialRotY = scene.camera.rotY;

    pd(scene.host, 200, 100);
    pm(scene.host, 100, 100); // dx = -100
    pu(scene.host);

    expect(scene.camera.rotY).toBeGreaterThan(initialRotY);
    controls.destroy();
  });

  it("dragging down decreases rotX (camera orbits downward — drag-follows-pointer)", () => {
    const controls = createGlyphOrbitControls(scene);
    const initialRotX = scene.camera.rotX;

    pd(scene.host, 100, 100);
    pm(scene.host, 100, 200); // dy = +100
    pu(scene.host);

    expect(scene.camera.rotX).toBeLessThan(initialRotX);
    controls.destroy();
  });

  it("drag of 80 px tilts the camera by 20 degrees (4 px per degree)", () => {
    const controls = createGlyphOrbitControls(scene);
    const initialRotY = scene.camera.rotY;

    pd(scene.host, 100, 100);
    pm(scene.host, 180, 100); // dx = +80 → 80/4 = 20 deg
    pu(scene.host);

    // rotY = rotY - 80 * (1/4) = rotY - 20
    expect(scene.camera.rotY).toBeCloseTo(initialRotY - 20, 5);
    controls.destroy();
  });

  it("rotX is clamped to [-90, 90] degrees", () => {
    const controls = createGlyphOrbitControls(scene);

    // Drag down massively — should clamp at -90
    pd(scene.host, 0, 0);
    pm(scene.host, 0, 100000);
    pu(scene.host);

    expect(scene.camera.rotX).toBeLessThanOrEqual(90);
    expect(scene.camera.rotX).toBeGreaterThanOrEqual(-90);
    controls.destroy();
  });

  it("rotX clamp stops exactly at -90 degrees when dragging down past limit", () => {
    const controls = createGlyphOrbitControls(scene);
    scene.camera.rotX = 0;

    // drag 1000 px down: 1000/4 = 250 deg change, clamped to -90
    pd(scene.host, 0, 0);
    pm(scene.host, 0, 1000);
    pu(scene.host);

    expect(scene.camera.rotX).toBe(-90);
    controls.destroy();
  });

  it("wheel deltaY < 0 increases scale (zoom in)", () => {
    const controls = createGlyphOrbitControls(scene);
    const initialZoom = scene.camera.zoom;

    scene.host.dispatchEvent(new WheelEvent("wheel", { deltaY: -100, bubbles: true }));

    // delta = -100 * 0.001 = -0.1, scale *= (1 - (-0.1)) = scale * 1.1
    expect(scene.camera.zoom).toBeGreaterThan(initialZoom);
    controls.destroy();
  });

  it("wheel deltaY > 0 decreases scale (zoom out)", () => {
    const controls = createGlyphOrbitControls(scene);
    const initialZoom = scene.camera.zoom;

    scene.host.dispatchEvent(new WheelEvent("wheel", { deltaY: 100, bubbles: true }));

    expect(scene.camera.zoom).toBeLessThan(initialZoom);
    controls.destroy();
  });

  it("zoom is clamped between 0.1 and 500 (CSS px per world unit)", () => {
    const controls = createGlyphOrbitControls(scene);

    // Zoom out aggressively
    for (let i = 0; i < 50; i++) {
      scene.host.dispatchEvent(new WheelEvent("wheel", { deltaY: 10000, bubbles: true }));
    }
    expect(scene.camera.zoom).toBeGreaterThanOrEqual(0.1);

    // Zoom in aggressively
    for (let i = 0; i < 50; i++) {
      scene.host.dispatchEvent(new WheelEvent("wheel", { deltaY: -10000, bubbles: true }));
    }
    expect(scene.camera.zoom).toBeLessThanOrEqual(500);
    controls.destroy();
  });

  it("destroy() stops responding to pointer events", () => {
    const controls = createGlyphOrbitControls(scene);
    controls.destroy();

    const rotYBefore = scene.camera.rotY;
    pd(scene.host, 100, 100);
    pm(scene.host, 300, 100);
    pu(scene.host);

    expect(scene.camera.rotY).toBe(rotYBefore);
  });

  it("destroy() stops responding to wheel events", () => {
    const controls = createGlyphOrbitControls(scene);
    controls.destroy();

    const zoomBefore = scene.camera.zoom;
    scene.host.dispatchEvent(new WheelEvent("wheel", { deltaY: -100, bubbles: true }));

    expect(scene.camera.zoom).toBe(zoomBefore);
  });

  it("invert option reverses drag direction", () => {
    const controls = createGlyphOrbitControls(scene, { invert: true });
    const initialRotY = scene.camera.rotY;

    pd(scene.host, 100, 100);
    pm(scene.host, 200, 100); // dx = +100, with invert => rotY increases
    pu(scene.host);

    // invertFactor = -1 → rotY = rotY - dx * RAD_PER_PX * (-1) = rotY + dx * RAD_PER_PX
    expect(scene.camera.rotY).toBeGreaterThan(initialRotY);
    controls.destroy();
  });

  it("numeric invert factor scales drag magnitude", () => {
    const controls2x = createGlyphOrbitControls(scene, { invert: 2 });
    const initialRotY = scene.camera.rotY;

    pd(scene.host, 100, 100);
    pm(scene.host, 200, 100); // dx = +100
    pu(scene.host);

    // invertFactor = 2, DEG_PER_PX = 0.25 → change = 100 * 0.25 * 2 = 50 deg
    const expected = initialRotY - 100 * (1 / 4) * 2;
    expect(scene.camera.rotY).toBeCloseTo(expected, 5);
    controls2x.destroy();
  });

  it("pause() stops drag handling; resume() restores it", () => {
    const controls = createGlyphOrbitControls(scene);
    controls.pause();

    const rotYBefore = scene.camera.rotY;
    pd(scene.host, 100, 100);
    pm(scene.host, 300, 100);
    pu(scene.host);
    expect(scene.camera.rotY).toBe(rotYBefore);

    controls.resume();
    pd(scene.host, 100, 100);
    pm(scene.host, 300, 100); // dx = 200
    pu(scene.host);
    expect(scene.camera.rotY).not.toBe(rotYBefore);

    controls.destroy();
  });

  it("drag disabled via option produces no rotation", () => {
    const controls = createGlyphOrbitControls(scene, { drag: false });
    const initialRotY = scene.camera.rotY;

    pd(scene.host, 100, 100);
    pm(scene.host, 300, 100);
    pu(scene.host);

    expect(scene.camera.rotY).toBe(initialRotY);
    controls.destroy();
  });

  it("wheel disabled via option produces no scale change", () => {
    const controls = createGlyphOrbitControls(scene, { wheel: false });
    const initialZoom = scene.camera.zoom;

    scene.host.dispatchEvent(new WheelEvent("wheel", { deltaY: -100, bubbles: true }));

    expect(scene.camera.zoom).toBe(initialZoom);
    controls.destroy();
  });

  it("update() can re-enable drag mid-session", () => {
    const controls = createGlyphOrbitControls(scene, { drag: false });
    controls.update({ drag: true });

    const initialRotY = scene.camera.rotY;
    pd(scene.host, 100, 100);
    pm(scene.host, 300, 100);
    pu(scene.host);

    expect(scene.camera.rotY).not.toBe(initialRotY);
    controls.destroy();
  });

  it("pointermove without prior pointerdown is a no-op", () => {
    const controls = createGlyphOrbitControls(scene);
    const initialRotY = scene.camera.rotY;

    pm(scene.host, 300, 100);

    expect(scene.camera.rotY).toBe(initialRotY);
    controls.destroy();
  });

  it("non-primary pointer events are ignored for drag start", () => {
    const controls = createGlyphOrbitControls(scene);
    const initialRotY = scene.camera.rotY;

    scene.host.dispatchEvent(
      new PointerEvent("pointerdown", {
        clientX: 100, clientY: 100, pointerId: 2, isPrimary: false, bubbles: true,
      }),
    );
    pm(scene.host, 300, 100, 2);

    expect(scene.camera.rotY).toBe(initialRotY);
    controls.destroy();
  });
});

describe("createGlyphOrbitControls — events", () => {
  let scene: GlyphSceneHandle;
  beforeEach(() => { scene = makeScene(); });
  afterEach(() => { scene.destroy(); });

  it("exposes addEventListener / removeEventListener / hasEventListener", () => {
    const c = createGlyphOrbitControls(scene);
    expect(typeof c.addEventListener).toBe("function");
    expect(typeof c.removeEventListener).toBe("function");
    expect(typeof c.hasEventListener).toBe("function");
    c.destroy();
  });

  it("emits 'change' on drag with a camera snapshot", () => {
    const c = createGlyphOrbitControls(scene);
    const events: unknown[] = [];
    const fn = (e: { type: string; camera: { rotY: number } }) => events.push(e);
    c.addEventListener("change", fn);
    expect(c.hasEventListener("change", fn)).toBe(true);
    pd(scene.host, 100, 100);
    pm(scene.host, 160, 100);
    pu(scene.host);
    expect(events.length).toBeGreaterThan(0);
    expect((events[0] as { type: string }).type).toBe("change");
    expect(typeof (events[0] as { camera: { rotY: number } }).camera.rotY).toBe("number");
    c.removeEventListener("change", fn);
    expect(c.hasEventListener("change", fn)).toBe(false);
    c.destroy();
  });

  it("emits 'start' on pointerdown and 'end' on pointerup", () => {
    const c = createGlyphOrbitControls(scene);
    const types: string[] = [];
    c.addEventListener("start", () => types.push("start"));
    c.addEventListener("end", () => types.push("end"));
    pd(scene.host, 100, 100);
    pu(scene.host);
    expect(types).toEqual(["start", "end"]);
    c.destroy();
  });

  it("removeEventListener stops delivery", () => {
    const c = createGlyphOrbitControls(scene);
    let n = 0;
    const fn = () => { n += 1; };
    c.addEventListener("change", fn);
    pd(scene.host, 100, 100); pm(scene.host, 150, 100);
    const after = n;
    c.removeEventListener("change", fn);
    pm(scene.host, 200, 100); pu(scene.host);
    expect(n).toBe(after);
    c.destroy();
  });
});
