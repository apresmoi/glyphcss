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

  it("rotX is clamped to [-π/2, π/2]", () => {
    const controls = createGlyphOrbitControls(scene);

    // Drag down massively
    pd(scene.host, 0, 0);
    pm(scene.host, 0, 100000);
    pu(scene.host);

    expect(scene.camera.rotX).toBeLessThanOrEqual(Math.PI / 2);
    expect(scene.camera.rotX).toBeGreaterThanOrEqual(-Math.PI / 2);
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

  it("scale is clamped between 0.05 and 10", () => {
    const controls = createGlyphOrbitControls(scene);

    // Zoom out aggressively
    for (let i = 0; i < 50; i++) {
      scene.host.dispatchEvent(new WheelEvent("wheel", { deltaY: 10000, bubbles: true }));
    }
    expect(scene.camera.zoom).toBeGreaterThanOrEqual(0.05);

    // Zoom in aggressively
    for (let i = 0; i < 50; i++) {
      scene.host.dispatchEvent(new WheelEvent("wheel", { deltaY: -10000, bubbles: true }));
    }
    expect(scene.camera.zoom).toBeLessThanOrEqual(10);
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

    // invertFactor = 2 → change is twice the default (factor 1)
    const RAD_PER_PX = (1 / 4) * (Math.PI / 180);
    const expected = initialRotY - 100 * RAD_PER_PX * 2;
    expect(scene.camera.rotY).toBeCloseTo(expected, 10);
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
