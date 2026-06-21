import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createGlyphScene } from "./createGlyphScene";
import { createGlyphFirstPersonControls } from "./createGlyphFirstPersonControls";
import { createGlyphOrthographicCamera } from "./createGlyphCamera";
import type { GlyphSceneHandle } from "./createGlyphScene";

function makeScene(): GlyphSceneHandle {
  const host = document.createElement("div");
  document.body.appendChild(host);
  return createGlyphScene(host, { cols: 20, rows: 10 });
}

// Controllable rAF: capture the latest scheduled callback; `step(ms)` runs one
// tick (the control re-schedules from inside tick, which we re-capture).
function mockRaf() {
  let cb: FrameRequestCallback | null = null;
  let t = 0;
  vi.stubGlobal("requestAnimationFrame", (fn: FrameRequestCallback) => { cb = fn; return 1; });
  vi.stubGlobal("cancelAnimationFrame", () => { cb = null; });
  return {
    step(ms = 16): void { t += ms; const fn = cb; cb = null; fn?.(t); },
    restore(): void { vi.unstubAllGlobals(); },
  };
}

function keydown(code: string): void {
  window.dispatchEvent(new KeyboardEvent("keydown", { code, bubbles: true }));
}
function keyup(code: string): void {
  window.dispatchEvent(new KeyboardEvent("keyup", { code, bubbles: true }));
}

function lookMove(dx: number, dy: number): void {
  const ev = new MouseEvent("mousemove", { bubbles: true });
  Object.defineProperty(ev, "movementX", { value: dx });
  Object.defineProperty(ev, "movementY", { value: dy });
  document.dispatchEvent(ev);
}

function setLocked(host: Element): void {
  Object.defineProperty(document, "pointerLockElement", { value: host, configurable: true });
  document.dispatchEvent(new Event("pointerlockchange"));
}

describe("createGlyphFirstPersonControls", () => {
  let scene: GlyphSceneHandle;

  beforeEach(() => {
    scene = makeScene();
    scene.camera.rotY = 0;
    scene.camera.rotX = 90;
    scene.camera.target = [0, 0, 0];
  });

  afterEach(() => {
    for (const c of ["KeyW", "KeyS", "KeyA", "KeyD", "Space", "ControlLeft"]) keyup(c);
    scene.destroy();
  });

  it("returns the full handle", () => {
    const c = createGlyphFirstPersonControls(scene);
    for (const m of ["update", "pause", "resume", "destroy", "lock", "unlock", "isLocked", "getOrigin", "setOrigin"]) {
      expect(typeof (c as Record<string, unknown>)[m]).toBe("function");
    }
    c.destroy();
  });

  it("requires a perspective camera", () => {
    const host = document.createElement("div");
    const ortho = createGlyphScene(host, { cols: 10, rows: 10, camera: createGlyphOrthographicCamera() });
    expect(() => createGlyphFirstPersonControls(ortho)).toThrow(/perspective camera/);
    ortho.destroy();
  });

  it("enables eyeMode on attach and restores it on destroy", () => {
    const c = createGlyphFirstPersonControls(scene);
    expect(scene.camera.eyeMode).toBe(true);
    c.destroy();
    expect(scene.camera.eyeMode).toBe(false);
  });

  it("seeds the eye from target + eyeHeight; setOrigin/getOrigin round-trip", () => {
    const c = createGlyphFirstPersonControls(scene, { eyeHeight: 1.7, groundZ: 0 });
    expect(c.getOrigin()[2]).toBeCloseTo(1.7, 5);
    c.setOrigin([5, 6, 2]);
    expect(c.getOrigin()).toEqual([5, 6, 2]);
    // In eyeMode the target IS the eye.
    expect(scene.camera.target).toEqual([5, 6, 2]);
    c.destroy();
  });

  it("pointer-lock mouselook: dx right decreases rotY, pitch clamps", () => {
    const c = createGlyphFirstPersonControls(scene, { lookSensitivity: 0.15 });
    setLocked(scene.host);
    expect(c.isLocked()).toBe(true);
    const rotY0 = scene.camera.rotY;
    lookMove(100, 0); // dx +100 → rotY -= 15
    expect(scene.camera.rotY).toBeCloseTo(((rotY0 - 15) % 360 + 360) % 360, 4);
    lookMove(0, 100000); // huge pitch down → clamped to maxPitch (175)
    expect(scene.camera.rotX).toBeLessThanOrEqual(175);
    expect(scene.camera.rotX).toBeGreaterThanOrEqual(5);
    c.destroy();
  });

  it("WASD walks the eye on the XY plane (rAF-driven)", () => {
    const raf = mockRaf();
    const c = createGlyphFirstPersonControls(scene, { moveSpeed: 10 });
    const start = c.getOrigin();
    keydown("KeyW");
    raf.step(16);
    raf.step(16);
    const after = c.getOrigin();
    expect(after[0] !== start[0] || after[1] !== start[1]).toBe(true);
    keyup("KeyW");
    c.destroy();
    raf.restore();
  });

  it("Space jumps then gravity returns to ground (rAF-driven)", () => {
    const raf = mockRaf();
    const c = createGlyphFirstPersonControls(scene, { eyeHeight: 1, gravity: 18, jumpVelocity: 7 });
    keydown("Space");
    raf.step(16);
    expect(c.getOrigin()[2]).toBeGreaterThan(1); // airborne
    for (let i = 0; i < 200; i++) raf.step(16); // let gravity land it
    expect(c.getOrigin()[2]).toBeCloseTo(1, 2);
    c.destroy();
    raf.restore();
  });

  it("update() can disable look", () => {
    const c = createGlyphFirstPersonControls(scene, { lookSensitivity: 0.15 });
    setLocked(scene.host);
    c.update({ lookEnabled: false });
    const rotY0 = scene.camera.rotY;
    lookMove(100, 0);
    expect(scene.camera.rotY).toBe(rotY0);
    c.destroy();
  });
});
