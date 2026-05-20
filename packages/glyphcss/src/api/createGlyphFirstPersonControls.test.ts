import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createGlyphScene } from "./createGlyphScene";
import { createGlyphFirstPersonControls } from "./createGlyphFirstPersonControls";
import { createGlyphOrthographicCamera } from "./createGlyphCamera";
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

function kd(key: string): void {
  document.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
}

function ku(key: string): void {
  document.dispatchEvent(new KeyboardEvent("keyup", { key, bubbles: true }));
}

describe("createGlyphFirstPersonControls", () => {
  let scene: GlyphSceneHandle;

  beforeEach(() => {
    scene = makeScene();
    // Reset camera to a known state
    scene.camera.rotY = 0;
    scene.camera.rotX = 0;
    scene.camera.target = [0, 0, 0];
  });

  afterEach(() => {
    // Make sure all keys are released to avoid cross-test leakage
    for (const key of ["w", "s", "a", "d", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]) {
      ku(key);
    }
    scene.destroy();
  });

  it("returns a handle with destroy()", () => {
    const controls = createGlyphFirstPersonControls(scene);
    expect(typeof controls.destroy).toBe("function");
    expect(typeof controls.pause).toBe("function");
    expect(typeof controls.resume).toBe("function");
    expect(typeof controls.update).toBe("function");
    controls.destroy();
  });

  it("mouse-drag right decreases rotY (look right)", () => {
    const controls = createGlyphFirstPersonControls(scene);
    const initialRotY = scene.camera.rotY;

    pd(scene.host, 100, 100);
    pm(scene.host, 200, 100); // dx = +100
    pu(scene.host);

    // rotY = rotY - dx * lookSpeed * invertFactor → decreases when dx > 0
    expect(scene.camera.rotY).toBeLessThan(initialRotY);
    controls.destroy();
  });

  it("mouse-drag left increases rotY (look left)", () => {
    const controls = createGlyphFirstPersonControls(scene);
    const initialRotY = scene.camera.rotY;

    pd(scene.host, 200, 100);
    pm(scene.host, 100, 100); // dx = -100
    pu(scene.host);

    expect(scene.camera.rotY).toBeGreaterThan(initialRotY);
    controls.destroy();
  });

  it("mouse-drag down increases rotX (look down)", () => {
    const controls = createGlyphFirstPersonControls(scene);
    const initialRotX = scene.camera.rotX;

    pd(scene.host, 100, 100);
    pm(scene.host, 100, 200); // dy = +100
    pu(scene.host);

    expect(scene.camera.rotX).toBeGreaterThan(initialRotX);
    controls.destroy();
  });

  it("rotX is clamped to [-π/2, π/2]", () => {
    const controls = createGlyphFirstPersonControls(scene);

    pd(scene.host, 0, 0);
    pm(scene.host, 0, 100000); // huge dy
    pu(scene.host);

    expect(scene.camera.rotX).toBeLessThanOrEqual(Math.PI / 2);
    expect(scene.camera.rotX).toBeGreaterThanOrEqual(-Math.PI / 2);
    controls.destroy();
  });

  it("lookSpeed option scales mouse-drag rotation magnitude", () => {
    const controlsFast = createGlyphFirstPersonControls(scene, { lookSpeed: 0.01 });
    const dx = 100;

    pd(scene.host, 0, 0);
    pm(scene.host, dx, 0);
    pu(scene.host);

    const rotYFast = scene.camera.rotY;

    // Reset
    controlsFast.destroy();
    scene.camera.rotY = 0;

    const controlsSlow = createGlyphFirstPersonControls(scene, { lookSpeed: 0.001 });
    pd(scene.host, 0, 0);
    pm(scene.host, dx, 0);
    pu(scene.host);

    const rotYSlow = scene.camera.rotY;
    controlsSlow.destroy();

    // Fast lookSpeed → larger rotation magnitude
    expect(Math.abs(rotYFast)).toBeGreaterThan(Math.abs(rotYSlow));
  });

  it("invert option reverses drag direction", () => {
    const controls = createGlyphFirstPersonControls(scene, { invert: true });
    const initialRotY = scene.camera.rotY;

    pd(scene.host, 100, 100);
    pm(scene.host, 200, 100); // dx = +100, invert → rotY increases
    pu(scene.host);

    expect(scene.camera.rotY).toBeGreaterThan(initialRotY);
    controls.destroy();
  });

  it("'w' key moves camera target forward (negative z-ish in camera space)", async () => {
    const controls = createGlyphFirstPersonControls(scene, { keyboard: true });
    // rotY=0: forward = sinY=0, cosY=1 → target moves toward -cosY direction
    const initialY = scene.camera.target[1];

    kd("w");
    // The keyTick is driven by rAF which may not fire in happy-dom;
    // directly call the scene's rerender to flush any pending state — but
    // key processing is rAF-driven. We simulate by re-dispatching keydown
    // and manually invoking rerender in a microtask to at least verify
    // the key registration. Instead, check if holding 'w' for one keyTick
    // produces movement when we trigger the RAF manually via a real rAF call.
    // In happy-dom, requestAnimationFrame callbacks fire in next microtask.
    await new Promise((r) => requestAnimationFrame(r));
    ku("w");

    // At rotY=0: cosY=1, sinY=0; 'w' → target[1] -= cosY * moveSpeed → decreases
    expect(scene.camera.target[1]).toBeLessThan(initialY);
    controls.destroy();
  });

  it("'s' key moves camera target backward", async () => {
    const controls = createGlyphFirstPersonControls(scene, { keyboard: true });
    const initialY = scene.camera.target[1];

    kd("s");
    await new Promise((r) => requestAnimationFrame(r));
    ku("s");

    // 's' → target[1] += cosY * moveSpeed → increases
    expect(scene.camera.target[1]).toBeGreaterThan(initialY);
    controls.destroy();
  });

  it("'a' key strafes left (target.x decreases at rotY=0)", async () => {
    const controls = createGlyphFirstPersonControls(scene, { keyboard: true });
    const initialX = scene.camera.target[0];

    kd("a");
    await new Promise((r) => requestAnimationFrame(r));
    ku("a");

    // 'a' → target[0] -= cosY * moveSpeed → decreases at rotY=0 (cosY=1)
    expect(scene.camera.target[0]).toBeLessThan(initialX);
    controls.destroy();
  });

  it("'d' key strafes right (target.x increases at rotY=0)", async () => {
    const controls = createGlyphFirstPersonControls(scene, { keyboard: true });
    const initialX = scene.camera.target[0];

    kd("d");
    await new Promise((r) => requestAnimationFrame(r));
    ku("d");

    // 'd' → target[0] += cosY * moveSpeed → increases at rotY=0
    expect(scene.camera.target[0]).toBeGreaterThan(initialX);
    controls.destroy();
  });

  it("moveSpeed option scales keyboard movement magnitude", async () => {
    const controlsFast = createGlyphFirstPersonControls(scene, { moveSpeed: 0.5 });
    kd("w");
    await new Promise((r) => requestAnimationFrame(r));
    ku("w");
    const fastDelta = Math.abs(scene.camera.target[1]);

    controlsFast.destroy();
    scene.camera.target = [0, 0, 0];

    const controlsSlow = createGlyphFirstPersonControls(scene, { moveSpeed: 0.01 });
    kd("w");
    await new Promise((r) => requestAnimationFrame(r));
    ku("w");
    const slowDelta = Math.abs(scene.camera.target[1]);
    controlsSlow.destroy();

    expect(fastDelta).toBeGreaterThan(slowDelta);
  });

  it("arrow keys also move the camera", async () => {
    const controls = createGlyphFirstPersonControls(scene, { keyboard: true });
    const initialY = scene.camera.target[1];

    kd("ArrowUp");
    await new Promise((r) => requestAnimationFrame(r));
    ku("ArrowUp");

    expect(scene.camera.target[1]).not.toBe(initialY);
    controls.destroy();
  });

  it("destroy() stops responding to mouse-drag events", () => {
    const controls = createGlyphFirstPersonControls(scene);
    controls.destroy();

    const rotYBefore = scene.camera.rotY;
    pd(scene.host, 100, 100);
    pm(scene.host, 300, 100);
    pu(scene.host);

    expect(scene.camera.rotY).toBe(rotYBefore);
  });

  it("destroy() stops keyboard processing", async () => {
    const controls = createGlyphFirstPersonControls(scene, { keyboard: true });
    controls.destroy();

    const initialY = scene.camera.target[1];
    kd("w");
    await new Promise((r) => requestAnimationFrame(r));
    ku("w");

    expect(scene.camera.target[1]).toBe(initialY);
  });

  it("pause() stops drag handling; resume() restores it", () => {
    const controls = createGlyphFirstPersonControls(scene);
    controls.pause();

    const rotYBefore = scene.camera.rotY;
    pd(scene.host, 100, 100);
    pm(scene.host, 300, 100);
    pu(scene.host);
    expect(scene.camera.rotY).toBe(rotYBefore);

    controls.resume();
    pd(scene.host, 100, 100);
    pm(scene.host, 300, 100);
    pu(scene.host);
    expect(scene.camera.rotY).not.toBe(rotYBefore);

    controls.destroy();
  });

  it("drag disabled via option produces no rotation", () => {
    const controls = createGlyphFirstPersonControls(scene, { drag: false });
    const initialRotY = scene.camera.rotY;

    pd(scene.host, 100, 100);
    pm(scene.host, 300, 100);
    pu(scene.host);

    expect(scene.camera.rotY).toBe(initialRotY);
    controls.destroy();
  });

  it("keyboard disabled via option produces no movement on key press", async () => {
    const controls = createGlyphFirstPersonControls(scene, { keyboard: false });
    const initialY = scene.camera.target[1];

    kd("w");
    await new Promise((r) => requestAnimationFrame(r));
    ku("w");

    expect(scene.camera.target[1]).toBe(initialY);
    controls.destroy();
  });

  it("pointermove without pointerdown is a no-op", () => {
    const controls = createGlyphFirstPersonControls(scene);
    const initialRotY = scene.camera.rotY;

    pm(scene.host, 300, 100);

    expect(scene.camera.rotY).toBe(initialRotY);
    controls.destroy();
  });

  it("sets eyeMode=true on the camera at attach time", () => {
    expect(scene.camera.eyeMode).toBe(false);
    const controls = createGlyphFirstPersonControls(scene);
    expect(scene.camera.eyeMode).toBe(true);
    controls.destroy();
  });

  it("restores eyeMode=false on the camera after destroy", () => {
    const controls = createGlyphFirstPersonControls(scene);
    expect(scene.camera.eyeMode).toBe(true);
    controls.destroy();
    expect(scene.camera.eyeMode).toBe(false);
  });
});

describe("createGlyphFirstPersonControls — orthographic camera rejection", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("throws when the scene has an orthographic camera", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const orthoCamera = createGlyphOrthographicCamera();
    const scene = createGlyphScene(host, { camera: orthoCamera, cols: 20, rows: 10 });
    expect(() => createGlyphFirstPersonControls(scene)).toThrow(
      /GlyphFirstPersonControls requires a perspective camera/,
    );
    scene.destroy();
  });
});
