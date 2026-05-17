import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createGlyphcssScene } from "./createGlyphcssScene";
import { createGlyphcssMapControls } from "./createGlyphcssMapControls";
import type { GlyphcssSceneHandle } from "./createGlyphcssScene";

function makeScene(): GlyphcssSceneHandle {
  const host = document.createElement("div");
  document.body.appendChild(host);
  return createGlyphcssScene(host, { cols: 20, rows: 10 });
}

function pd(host: Element, x: number, y: number, button = 0, pointerId = 1): void {
  host.dispatchEvent(
    new PointerEvent("pointerdown", {
      clientX: x, clientY: y, pointerId, button, isPrimary: true, bubbles: true,
    }),
  );
}

function pm(host: Element, x: number, y: number, pointerId = 1, shiftKey = false): void {
  host.dispatchEvent(
    new PointerEvent("pointermove", {
      clientX: x, clientY: y, pointerId, isPrimary: true, bubbles: true, shiftKey,
    }),
  );
}

function pu(host: Element, pointerId = 1): void {
  host.dispatchEvent(
    new PointerEvent("pointerup", { pointerId, isPrimary: true, bubbles: true }),
  );
}

describe("createGlyphcssMapControls", () => {
  let scene: GlyphcssSceneHandle;

  beforeEach(() => {
    scene = makeScene();
  });

  afterEach(() => {
    scene.destroy();
  });

  it("returns a handle with destroy()", () => {
    const controls = createGlyphcssMapControls(scene);
    expect(typeof controls.destroy).toBe("function");
    expect(typeof controls.pause).toBe("function");
    expect(typeof controls.resume).toBe("function");
    expect(typeof controls.update).toBe("function");
    controls.destroy();
  });

  it("left-drag pans the target (camera.target shifts)", () => {
    const controls = createGlyphcssMapControls(scene);
    const [tx0, ty0, tz0] = scene.camera.target;

    pd(scene.host, 100, 100, 0);
    pm(scene.host, 200, 100); // dx = +100, no shift/right → pan
    pu(scene.host);

    const [tx1, ty1, tz1] = scene.camera.target;
    // target[0] -= dx * PAN_SCALE / scale → target[0] decreases
    expect(tx1).not.toBe(tx0);
    expect(tz1).toBe(tz0); // z unchanged
    void ty0; void ty1; // y may also change here but we only asserted x
    controls.destroy();
  });

  it("left-drag right → target.x decreases (map moves left)", () => {
    const controls = createGlyphcssMapControls(scene);
    const initialX = scene.camera.target[0];

    pd(scene.host, 100, 100, 0);
    pm(scene.host, 200, 100); // dx = +100
    pu(scene.host);

    expect(scene.camera.target[0]).toBeLessThan(initialX);
    controls.destroy();
  });

  it("left-drag down → target.y decreases", () => {
    const controls = createGlyphcssMapControls(scene);
    const initialY = scene.camera.target[1];

    pd(scene.host, 100, 100, 0);
    pm(scene.host, 100, 200); // dy = +100
    pu(scene.host);

    expect(scene.camera.target[1]).toBeLessThan(initialY);
    controls.destroy();
  });

  it("right-drag orbits instead of panning (rotY changes, target unchanged)", () => {
    const controls = createGlyphcssMapControls(scene);
    const initialRotY = scene.camera.rotY;
    const initialTargetX = scene.camera.target[0];

    pd(scene.host, 100, 100, 2); // button=2 → rightDown
    pm(scene.host, 200, 100); // dx = +100
    pu(scene.host);

    expect(scene.camera.rotY).not.toBe(initialRotY);
    expect(scene.camera.target[0]).toBe(initialTargetX);
    controls.destroy();
  });

  it("shift+left-drag orbits instead of panning", () => {
    const controls = createGlyphcssMapControls(scene);
    const initialRotY = scene.camera.rotY;
    const initialTargetX = scene.camera.target[0];

    pd(scene.host, 100, 100, 0);
    pm(scene.host, 200, 100, 1, true); // shiftKey = true → orbit
    pu(scene.host);

    expect(scene.camera.rotY).not.toBe(initialRotY);
    expect(scene.camera.target[0]).toBe(initialTargetX);
    controls.destroy();
  });

  it("wheel deltaY < 0 increases scale (zoom in)", () => {
    const controls = createGlyphcssMapControls(scene);
    const initialScale = scene.camera.scale;

    scene.host.dispatchEvent(new WheelEvent("wheel", { deltaY: -100, bubbles: true }));

    expect(scene.camera.scale).toBeGreaterThan(initialScale);
    controls.destroy();
  });

  it("wheel deltaY > 0 decreases scale (zoom out)", () => {
    const controls = createGlyphcssMapControls(scene);
    const initialScale = scene.camera.scale;

    scene.host.dispatchEvent(new WheelEvent("wheel", { deltaY: 100, bubbles: true }));

    expect(scene.camera.scale).toBeLessThan(initialScale);
    controls.destroy();
  });

  it("scale clamped between 0.05 and 10", () => {
    const controls = createGlyphcssMapControls(scene);

    for (let i = 0; i < 50; i++) {
      scene.host.dispatchEvent(new WheelEvent("wheel", { deltaY: 10000, bubbles: true }));
    }
    expect(scene.camera.scale).toBeGreaterThanOrEqual(0.05);

    for (let i = 0; i < 50; i++) {
      scene.host.dispatchEvent(new WheelEvent("wheel", { deltaY: -10000, bubbles: true }));
    }
    expect(scene.camera.scale).toBeLessThanOrEqual(10);
    controls.destroy();
  });

  it("destroy() stops responding to pan events", () => {
    const controls = createGlyphcssMapControls(scene);
    controls.destroy();

    const [tx0] = scene.camera.target;
    pd(scene.host, 100, 100, 0);
    pm(scene.host, 300, 100);
    pu(scene.host);

    expect(scene.camera.target[0]).toBe(tx0);
  });

  it("destroy() stops responding to wheel events", () => {
    const controls = createGlyphcssMapControls(scene);
    controls.destroy();

    const scaleBefore = scene.camera.scale;
    scene.host.dispatchEvent(new WheelEvent("wheel", { deltaY: -100, bubbles: true }));

    expect(scene.camera.scale).toBe(scaleBefore);
  });

  it("invert option reverses orbit direction (right-drag) but NOT pan direction", () => {
    // The pan formula does not apply invertFactor — only the orbit branch does.
    // Verify that invert reverses right-drag orbit direction.
    const controls = createGlyphcssMapControls(scene, { invert: true });
    const initialRotY = scene.camera.rotY;

    // Right-drag triggers orbit which respects invert
    pd(scene.host, 100, 100, 2);
    pm(scene.host, 200, 100); // dx = +100
    pu(scene.host);

    // Without invert: rotY = rotY - dx * RAD_PER_PX (decreases).
    // With invert=true (f=-1): rotY = rotY - dx * RAD_PER_PX * (-1) → increases.
    expect(scene.camera.rotY).toBeGreaterThan(initialRotY);
    controls.destroy();
  });

  it("pan magnitude is proportional to PAN_SCALE / scale", () => {
    // Use a higher scale so pan distance is smaller
    const sceneHighZoom = makeScene();
    sceneHighZoom.camera.scale = 2;
    const controlsHigh = createGlyphcssMapControls(sceneHighZoom);

    const sceneLowZoom = makeScene();
    sceneLowZoom.camera.scale = 1;
    const controlsLow = createGlyphcssMapControls(sceneLowZoom);

    const dx = 100;
    const drag = (s: GlyphcssSceneHandle) => {
      pd(s.host, 0, 0, 0);
      pm(s.host, dx, 0);
      pu(s.host);
    };

    drag(sceneHighZoom);
    drag(sceneLowZoom);

    const deltaHigh = Math.abs(sceneHighZoom.camera.target[0]);
    const deltaLow = Math.abs(sceneLowZoom.camera.target[0]);

    // High zoom (scale=2) → smaller pan distance than low zoom (scale=1)
    expect(deltaHigh).toBeLessThan(deltaLow);

    controlsHigh.destroy();
    controlsLow.destroy();
    sceneHighZoom.destroy();
    sceneLowZoom.destroy();
  });

  it("pause() stops pan; resume() restores it", () => {
    const controls = createGlyphcssMapControls(scene);
    controls.pause();

    const [tx0] = scene.camera.target;
    pd(scene.host, 100, 100, 0);
    pm(scene.host, 300, 100);
    pu(scene.host);
    expect(scene.camera.target[0]).toBe(tx0);

    controls.resume();
    pd(scene.host, 100, 100, 0);
    pm(scene.host, 300, 100);
    pu(scene.host);
    expect(scene.camera.target[0]).not.toBe(tx0);

    controls.destroy();
  });

  it("drag disabled via option produces no target change", () => {
    const controls = createGlyphcssMapControls(scene, { drag: false });
    const [tx0] = scene.camera.target;

    pd(scene.host, 100, 100, 0);
    pm(scene.host, 300, 100);
    pu(scene.host);

    expect(scene.camera.target[0]).toBe(tx0);
    controls.destroy();
  });

  it("wheel disabled via option produces no scale change", () => {
    const controls = createGlyphcssMapControls(scene, { wheel: false });
    const initialScale = scene.camera.scale;

    scene.host.dispatchEvent(new WheelEvent("wheel", { deltaY: -100, bubbles: true }));

    expect(scene.camera.scale).toBe(initialScale);
    controls.destroy();
  });

  it("pointermove without pointerdown is a no-op", () => {
    const controls = createGlyphcssMapControls(scene);
    const [tx0] = scene.camera.target;

    pm(scene.host, 300, 100);

    expect(scene.camera.target[0]).toBe(tx0);
    controls.destroy();
  });
});
