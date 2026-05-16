/**
 * Tests for createPolyFirstPersonControls.
 *
 * Covers: pointer-lock acquisition, mouselook (rotX/rotY), per-axis
 * enabled toggles, keyboard movement on RAF tick, jump arc + gravity,
 * crouch height delta, lifecycle.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPolyScene, type PolySceneHandle } from "./createPolyScene";
import {
  createPolyFirstPersonControls,
  type PolyFirstPersonControlsHandle,
} from "./createPolyFirstPersonControls";

type Frame = (now: number) => void;
let rafQueue: Frame[] = [];
let rafId = 0;
let nowMs = 0;

function installManualRaf(): void {
  rafQueue = [];
  rafId = 0;
  nowMs = 0;
  vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((cb: Frame) => {
    rafQueue.push(cb);
    return ++rafId;
  });
  vi.spyOn(globalThis, "cancelAnimationFrame").mockImplementation(() => {
    rafQueue = [];
  });
}

function tickFrame(advanceMs = 16.67): void {
  nowMs += advanceMs;
  const frames = rafQueue;
  rafQueue = [];
  for (const f of frames) f(nowMs);
}

function pressKey(code: string): void {
  window.dispatchEvent(new KeyboardEvent("keydown", { code, bubbles: true }));
}

function releaseKey(code: string): void {
  window.dispatchEvent(new KeyboardEvent("keyup", { code, bubbles: true }));
}

function fakePointerLock(host: HTMLElement, locked: boolean): void {
  Object.defineProperty(document, "pointerLockElement", {
    configurable: true,
    get: () => (locked ? host : null),
  });
  document.dispatchEvent(new Event("pointerlockchange"));
}

describe("createPolyFirstPersonControls", () => {
  let host: HTMLElement;
  let scene: PolySceneHandle;
  let controls: PolyFirstPersonControlsHandle | null;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    // Initialize at rotX=90 (horizontal) so mouselook pitch math is clean.
    scene = createPolyScene(host, { rotX: 90, rotY: 0, zoom: 1, target: [0, 0, 0] });
    controls = null;
    installManualRaf();
    // Stub pointer-lock APIs (jsdom doesn't implement them).
    host.requestPointerLock = vi.fn(() => fakePointerLock(host, true));
    document.exitPointerLock = vi.fn(() => fakePointerLock(host, false));
  });

  afterEach(() => {
    if (controls) controls.destroy();
    scene.destroy();
    if (host.parentNode) host.parentNode.removeChild(host);
    vi.restoreAllMocks();
  });

  describe("defaults", () => {
    it("attaches mouselook crosshair cursor", () => {
      controls = createPolyFirstPersonControls(scene);
      expect(host.style.cursor).toBe("crosshair");
    });

    it("syncs target.z to eyeHeight on attach", () => {
      controls = createPolyFirstPersonControls(scene, { eyeHeight: 1.7, groundZ: 0 });
      expect((scene.getOptions().target ?? [0, 0, 0])[2]).toBeCloseTo(1.7, 3);
    });

    it("starts the RAF tick", () => {
      controls = createPolyFirstPersonControls(scene);
      expect(rafQueue.length).toBeGreaterThan(0);
    });
  });

  describe("mouselook", () => {
    it("ignores mousemove without pointer-lock", () => {
      controls = createPolyFirstPersonControls(scene);
      const before = scene.getOptions().rotY ?? 0;
      document.dispatchEvent(new MouseEvent("mousemove", { movementX: 100, movementY: 0 }));
      expect(scene.getOptions().rotY).toBe(before);
    });

    it("yaw decreases on mouse-right when locked", () => {
      controls = createPolyFirstPersonControls(scene, { lookSensitivity: 1 });
      host.click();
      fakePointerLock(host, true);
      const before = scene.getOptions().rotY ?? 0;
      document.dispatchEvent(new MouseEvent("mousemove", { movementX: 10, movementY: 0 }));
      expect(scene.getOptions().rotY).toBeCloseTo(((before - 10) % 360 + 360) % 360, 1);
    });

    it("pitch decreases on mouse-down (look down) when locked", () => {
      controls = createPolyFirstPersonControls(scene, { lookSensitivity: 1 });
      host.click();
      fakePointerLock(host, true);
      const before = scene.getOptions().rotX ?? 90;
      document.dispatchEvent(new MouseEvent("mousemove", { movementX: 0, movementY: 10 }));
      expect(scene.getOptions().rotX).toBeCloseTo(before - 10, 1);
    });

    it("clamps pitch to [minPitch, maxPitch]", () => {
      controls = createPolyFirstPersonControls(scene, {
        lookSensitivity: 1,
        minPitch: 30,
        maxPitch: 150,
      });
      host.click();
      fakePointerLock(host, true);
      document.dispatchEvent(new MouseEvent("mousemove", { movementX: 0, movementY: 1000 }));
      expect(scene.getOptions().rotX).toBe(30);
      document.dispatchEvent(new MouseEvent("mousemove", { movementX: 0, movementY: -10000 }));
      expect(scene.getOptions().rotX).toBe(150);
    });

    it("invertY flips vertical mouselook", () => {
      controls = createPolyFirstPersonControls(scene, { lookSensitivity: 1, invertY: true });
      host.click();
      fakePointerLock(host, true);
      const before = scene.getOptions().rotX ?? 90;
      document.dispatchEvent(new MouseEvent("mousemove", { movementX: 0, movementY: 10 }));
      expect(scene.getOptions().rotX).toBeCloseTo(before + 10, 1);
    });

    it("disabling lookEnabled stops yaw updates", () => {
      controls = createPolyFirstPersonControls(scene, { lookEnabled: false });
      const before = scene.getOptions().rotY ?? 0;
      // No pointer-lock since lookEnabled is off, simulate anyway:
      fakePointerLock(host, true);
      document.dispatchEvent(new MouseEvent("mousemove", { movementX: 100 }));
      expect(scene.getOptions().rotY).toBe(before);
    });
  });

  // The cameraOrigin model exists so the polycss perspective viewer
  // coincides with `cameraOrigin` in world space. The invariant is:
  //   target = origin + lookDir(rotX, rotY) * (perspective / BASE_TILE)
  // and mouselook (rotX/rotY change) MUST leave origin fixed. These tests
  // pin down those two properties directly so a regression in the math
  // shows up as a unit-test failure, not a visual drift bug.
  describe("origin/target identity", () => {
    const TILE = 50; // BASE_TILE
    const PERSPECTIVE = 2000;

    function expectedTarget(origin: [number, number, number], rotXDeg: number, rotYDeg: number): [number, number, number] {
      const rx = (rotXDeg * Math.PI) / 180;
      const ry = (rotYDeg * Math.PI) / 180;
      const fx = -Math.sin(rx) * Math.cos(ry);
      const fy = -Math.sin(rx) * Math.sin(ry);
      const fz = -Math.cos(rx);
      const off = PERSPECTIVE / TILE;
      return [origin[0] + fx * off, origin[1] + fy * off, origin[2] + fz * off];
    }

    it("target = origin + lookDir * (perspective/tile) on attach", () => {
      scene.setOptions({ perspective: PERSPECTIVE, rotX: 90, rotY: 0, target: [10, 20, 5] });
      controls = createPolyFirstPersonControls(scene, { eyeHeight: 0, groundZ: 5 });
      const origin = controls.getOrigin();
      const target = scene.getOptions().target ?? [0, 0, 0];
      const expected = expectedTarget(origin, 90, 0);
      expect(target[0]).toBeCloseTo(expected[0], 4);
      expect(target[1]).toBeCloseTo(expected[1], 4);
      expect(target[2]).toBeCloseTo(expected[2], 4);
    });

    it("identity holds across multiple yaw angles", () => {
      scene.setOptions({ perspective: PERSPECTIVE, rotX: 90, rotY: 0 });
      controls = createPolyFirstPersonControls(scene, { lookSensitivity: 1 });
      host.click();
      fakePointerLock(host, true);
      for (const yawDelta of [10, 25, -40, 90, -180]) {
        document.dispatchEvent(new MouseEvent("mousemove", { movementX: -yawDelta, movementY: 0 }));
        const sceneOpts = scene.getOptions();
        const origin = controls.getOrigin();
        const target = sceneOpts.target ?? [0, 0, 0];
        const expected = expectedTarget(origin, sceneOpts.rotX ?? 0, sceneOpts.rotY ?? 0);
        expect(target[0]).toBeCloseTo(expected[0], 4);
        expect(target[1]).toBeCloseTo(expected[1], 4);
        expect(target[2]).toBeCloseTo(expected[2], 4);
      }
    });

    it("identity holds across pitch changes", () => {
      scene.setOptions({ perspective: PERSPECTIVE, rotX: 90, rotY: 45 });
      controls = createPolyFirstPersonControls(scene, { lookSensitivity: 1, minPitch: 10, maxPitch: 170 });
      host.click();
      fakePointerLock(host, true);
      for (const pitchDelta of [10, -20, 30, -60]) {
        document.dispatchEvent(new MouseEvent("mousemove", { movementX: 0, movementY: pitchDelta }));
        const sceneOpts = scene.getOptions();
        const origin = controls.getOrigin();
        const target = sceneOpts.target ?? [0, 0, 0];
        const expected = expectedTarget(origin, sceneOpts.rotX ?? 0, sceneOpts.rotY ?? 0);
        expect(target[0]).toBeCloseTo(expected[0], 4);
        expect(target[1]).toBeCloseTo(expected[1], 4);
        expect(target[2]).toBeCloseTo(expected[2], 4);
      }
    });

    it("mouselook keeps cameraOrigin FIXED (in-place rotation, not orbit)", () => {
      scene.setOptions({ perspective: PERSPECTIVE, rotX: 90, rotY: 0, target: [3, 7, 4] });
      controls = createPolyFirstPersonControls(scene, { lookSensitivity: 1, eyeHeight: 0, groundZ: 4 });
      const originBefore = controls.getOrigin();
      host.click();
      fakePointerLock(host, true);
      // Apply a long mouselook sweep — yaw + pitch — and verify origin doesn't drift.
      for (let i = 0; i < 30; i++) {
        document.dispatchEvent(new MouseEvent("mousemove", { movementX: 8, movementY: 3 }));
      }
      const originAfter = controls.getOrigin();
      expect(originAfter[0]).toBeCloseTo(originBefore[0], 4);
      expect(originAfter[1]).toBeCloseTo(originBefore[1], 4);
      expect(originAfter[2]).toBeCloseTo(originBefore[2], 4);
    });

    it("lookOffset scales with sceneOptions.perspective", () => {
      // Two scenes, different perspective. Same origin, same rotation.
      // |target - origin| should equal perspective / tile in each.
      for (const persp of [500, 2000, 16000]) {
        scene.setOptions({ perspective: persp, rotX: 90, rotY: 0, target: [0, 0, 0] });
        if (controls) controls.destroy();
        controls = createPolyFirstPersonControls(scene, { eyeHeight: 0, groundZ: 0 });
        const origin = controls.getOrigin();
        const target = scene.getOptions().target ?? [0, 0, 0];
        const dist = Math.hypot(target[0] - origin[0], target[1] - origin[1], target[2] - origin[2]);
        expect(dist).toBeCloseTo(persp / TILE, 2);
      }
    });
  });

  describe("movement", () => {
    // FPV maintains cameraOrigin internally (target is a derived look-at
    // point ahead of the origin). All movement tests check getOrigin().
    it("W moves origin forward (toward -world-X at rotY=0)", () => {
      controls = createPolyFirstPersonControls(scene, { moveSpeed: 10 });
      const before = controls.getOrigin();
      pressKey("KeyW");
      tickFrame(100);
      const after = controls.getOrigin();
      expect(after[0]).toBeLessThan(before[0]);
      expect(after[1]).toBeCloseTo(before[1], 3);
      releaseKey("KeyW");
    });

    it("D moves origin right (+world-Y at rotY=0)", () => {
      controls = createPolyFirstPersonControls(scene, { moveSpeed: 10 });
      const before = controls.getOrigin();
      pressKey("KeyD");
      tickFrame(100);
      const after = controls.getOrigin();
      expect(after[0]).toBeCloseTo(before[0], 3);
      expect(after[1]).toBeGreaterThan(before[1]);
      releaseKey("KeyD");
    });

    it("S moves opposite of W", () => {
      controls = createPolyFirstPersonControls(scene, { moveSpeed: 10 });
      const before = controls.getOrigin();
      pressKey("KeyS");
      tickFrame(100);
      const after = controls.getOrigin();
      expect(after[0]).toBeGreaterThan(before[0]);
      releaseKey("KeyS");
    });

    it("arrow keys behave like WASD", () => {
      controls = createPolyFirstPersonControls(scene, { moveSpeed: 10 });
      const before = controls.getOrigin();
      pressKey("ArrowUp");
      tickFrame(100);
      const after = controls.getOrigin();
      expect(after[0]).toBeLessThan(before[0]);
      releaseKey("ArrowUp");
    });

    it("diagonal movement normalizes speed", () => {
      // First-frame dt is fixed at 0.0167 by the loop; with moveSpeed=10 a
      // single cardinal step is ~0.167 units. Diagonal w/ normalization should
      // produce the same total distance — not sqrt(2) times larger.
      controls = createPolyFirstPersonControls(scene, { moveSpeed: 10 });
      const before = controls.getOrigin();
      pressKey("KeyW");
      pressKey("KeyD");
      tickFrame(100);
      const after = controls.getOrigin();
      const dist = Math.hypot(after[0] - before[0], after[1] - before[1]);
      expect(dist).toBeGreaterThan(0.1);
      expect(dist).toBeLessThan(0.2);
      releaseKey("KeyW");
      releaseKey("KeyD");
    });

    it("disabling moveEnabled stops key-driven movement", () => {
      controls = createPolyFirstPersonControls(scene, { moveEnabled: false, moveSpeed: 10 });
      const before = controls.getOrigin();
      pressKey("KeyW");
      tickFrame(100);
      const after = controls.getOrigin();
      expect(after[0]).toBeCloseTo(before[0], 3);
      expect(after[1]).toBeCloseTo(before[1], 3);
      releaseKey("KeyW");
    });
  });

  describe("jump", () => {
    it("Space launches a jump arc", () => {
      controls = createPolyFirstPersonControls(scene, {
        eyeHeight: 1,
        groundZ: 0,
        jumpVelocity: 5,
        gravity: 10,
      });
      const beforeZ = (scene.getOptions().target ?? [0, 0, 0])[2];
      pressKey("Space");
      tickFrame(100); // 100ms in → still going up
      const peakZ = (scene.getOptions().target ?? [0, 0, 0])[2];
      expect(peakZ).toBeGreaterThan(beforeZ);
      releaseKey("Space");
      // Let it fall back to ground.
      for (let i = 0; i < 60; i++) tickFrame(50);
      const endZ = (scene.getOptions().target ?? [0, 0, 0])[2];
      expect(endZ).toBeCloseTo(beforeZ, 2);
    });

    it("Space ignored when jumpEnabled:false", () => {
      controls = createPolyFirstPersonControls(scene, { jumpEnabled: false });
      const beforeZ = (scene.getOptions().target ?? [0, 0, 0])[2];
      pressKey("Space");
      tickFrame(100);
      releaseKey("Space");
      const afterZ = (scene.getOptions().target ?? [0, 0, 0])[2];
      expect(afterZ).toBeCloseTo(beforeZ, 3);
    });

    it("does not double-jump mid-air", () => {
      controls = createPolyFirstPersonControls(scene, {
        eyeHeight: 1,
        jumpVelocity: 5,
        gravity: 10,
      });
      pressKey("Space");
      tickFrame(50);
      releaseKey("Space");
      const midZ = (scene.getOptions().target ?? [0, 0, 0])[2];
      // Re-trigger jump while airborne should be ignored (already non-zero offset).
      pressKey("Space");
      tickFrame(0);
      const stillMidZ = (scene.getOptions().target ?? [0, 0, 0])[2];
      // Should not have jumped again — vertical velocity not reset.
      expect(stillMidZ).toBeCloseTo(midZ, 2);
      releaseKey("Space");
    });
  });

  describe("crouch", () => {
    it("Ctrl held lowers eye height to crouchHeight", () => {
      controls = createPolyFirstPersonControls(scene, {
        eyeHeight: 1.8,
        crouchHeight: 0.9,
        groundZ: 0,
      });
      const before = (scene.getOptions().target ?? [0, 0, 0])[2];
      expect(before).toBeCloseTo(1.8, 3);
      pressKey("ControlLeft");
      tickFrame(16);
      expect((scene.getOptions().target ?? [0, 0, 0])[2]).toBeCloseTo(0.9, 3);
      releaseKey("ControlLeft");
      tickFrame(16);
      expect((scene.getOptions().target ?? [0, 0, 0])[2]).toBeCloseTo(1.8, 3);
    });

    it("crouchEnabled:false disables Ctrl", () => {
      controls = createPolyFirstPersonControls(scene, {
        eyeHeight: 1.8,
        crouchHeight: 0.9,
        crouchEnabled: false,
      });
      pressKey("ControlLeft");
      tickFrame(16);
      expect((scene.getOptions().target ?? [0, 0, 0])[2]).toBeCloseTo(1.8, 3);
      releaseKey("ControlLeft");
    });
  });

  describe("lifecycle", () => {
    it("pause halts movement", () => {
      controls = createPolyFirstPersonControls(scene, { moveSpeed: 10 });
      const before = controls.getOrigin();
      controls.pause();
      pressKey("KeyW");
      tickFrame(100);
      const after = controls.getOrigin();
      expect(after[0]).toBeCloseTo(before[0], 3);
      releaseKey("KeyW");
    });

    it("resume re-attaches and ticks", () => {
      controls = createPolyFirstPersonControls(scene, { moveSpeed: 10 });
      controls.pause();
      controls.resume();
      const before = controls.getOrigin();
      pressKey("KeyW");
      tickFrame(100);
      const after = controls.getOrigin();
      expect(after[0]).toBeLessThan(before[0]);
      releaseKey("KeyW");
    });

    it("destroy is idempotent and clears listeners", () => {
      controls = createPolyFirstPersonControls(scene);
      controls.destroy();
      expect(() => controls?.destroy()).not.toThrow();
    });

    it("update changes options live", () => {
      controls = createPolyFirstPersonControls(scene, { moveSpeed: 1 });
      controls.update({ moveSpeed: 100 });
      const before = controls.getOrigin();
      pressKey("KeyW");
      tickFrame(100);
      const after = controls.getOrigin();
      // First-frame dt is 0.0167. speed=100 → ~1.67 units forward.
      const dx = Math.abs(after[0] - before[0]);
      expect(dx).toBeGreaterThan(1);
      expect(dx).toBeLessThan(2);
      releaseKey("KeyW");
    });

    it("update of eyeHeight resyncs target.z", () => {
      controls = createPolyFirstPersonControls(scene, { eyeHeight: 1.7 });
      controls.update({ eyeHeight: 3 });
      expect((scene.getOptions().target ?? [0, 0, 0])[2]).toBeCloseTo(3, 3);
    });
  });
});
