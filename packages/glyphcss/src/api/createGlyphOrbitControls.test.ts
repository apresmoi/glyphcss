import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
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

  it("rotX is clamped to [-90, 90] degrees (default pitchRange)", () => {
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

  it("pitchRange: null removes the clamp (old clampPitch: false)", () => {
    const controls = createGlyphOrbitControls(scene, { pitchRange: null });
    scene.camera.rotX = 0;

    pd(scene.host, 0, 0);
    pm(scene.host, 0, 1000); // 1000/4 = 250 deg
    pu(scene.host);

    expect(scene.camera.rotX).toBeCloseTo(-250, 5);
    controls.destroy();
  });

  it("pitchRange: custom [min, max] clamps to those bounds", () => {
    const controls = createGlyphOrbitControls(scene, { pitchRange: [-30, 30] });
    scene.camera.rotX = 0;

    pd(scene.host, 0, 0);
    pm(scene.host, 0, 1000);
    pu(scene.host);

    expect(scene.camera.rotX).toBe(-30);
    controls.destroy();
  });

  it("update({ pitchRange }) changes the clamp mid-session", () => {
    const controls = createGlyphOrbitControls(scene);
    controls.update({ pitchRange: [-10, 10] });
    scene.camera.rotX = 0;

    pd(scene.host, 0, 0);
    pm(scene.host, 0, 1000);
    pu(scene.host);

    expect(scene.camera.rotX).toBe(-10);
    controls.destroy();
  });

  it("world +Z projects screen-up (no roll) at every turntable pitch, including views past ±90 with pitchRange: null", () => {
    const controls = createGlyphOrbitControls(scene, { pitchRange: null });
    const cols = 20, rows = 10, cellAspect = 1;
    for (const rotY of [0, 37, 90, 180, 275]) {
      for (const rotX of [-170, -90, -45, 0, 45, 90, 135, 179]) {
        scene.camera.rotX = rotX;
        scene.camera.rotY = rotY;
        const origin = scene.camera.project([0, 0, 0], cols, rows, cellAspect);
        const tip = scene.camera.project([0, 0, 1], cols, rows, cellAspect);
        // No roll: the +Z axis never picks up a horizontal (column) offset —
        // the up-vector holds at every pitch this range now reaches.
        expect(tip[0] - origin[0]).toBeCloseTo(0, 9);
      }
    }
    controls.destroy();
  });

  it("default behaviour replays byte-identical to the pre-trackball implementation across a mixed drag/wheel/pinch sequence", () => {
    const controls = createGlyphOrbitControls(scene);
    const rotX0 = scene.camera.rotX;
    const rotY0 = scene.camera.rotY;
    const zoom0 = scene.camera.zoom;

    // single-finger drag: dx=+60, dy=-40
    pd(scene.host, 100, 100);
    pm(scene.host, 160, 60);
    pu(scene.host);

    // wheel zoom in
    scene.host.dispatchEvent(new WheelEvent("wheel", { deltaY: -50, bubbles: true }));

    // two-finger pinch: 50px apart -> 100px apart
    scene.host.dispatchEvent(new PointerEvent("pointerdown", { clientX: 0, clientY: 0, pointerId: 1, isPrimary: true, bubbles: true }));
    scene.host.dispatchEvent(new PointerEvent("pointerdown", { clientX: 50, clientY: 0, pointerId: 2, isPrimary: false, bubbles: true }));
    scene.host.dispatchEvent(new PointerEvent("pointermove", { clientX: 100, clientY: 0, pointerId: 2, isPrimary: false, bubbles: true }));
    pu(scene.host, 1);
    pu(scene.host, 2);

    const DEG_PER_PX = 1 / 4;
    const expectedRotY = rotY0 - 60 * DEG_PER_PX;
    const expectedRotX = Math.max(-90, Math.min(90, rotX0 - -40 * DEG_PER_PX));
    const afterWheel = Math.max(0.1, Math.min(500, zoom0 * (1 - -50 * 0.001)));
    const expectedZoom = Math.max(0.1, Math.min(500, afterWheel * (100 / 50)));

    expect(scene.camera.rotY).toBeCloseTo(expectedRotY, 6);
    expect(scene.camera.rotX).toBeCloseTo(expectedRotX, 6);
    expect(scene.camera.zoom).toBeCloseTo(expectedZoom, 6);
    // Turntable mode never touches the matrix path.
    expect(scene.camera.useMat).toBe(false);
    expect(scene.camera.mat).toBeNull();
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

describe("createGlyphOrbitControls — trackball mode", () => {
  let scene: GlyphSceneHandle;
  const cols = 20, rows = 10, cellAspect = 1;

  beforeEach(() => { scene = makeScene(); });
  afterEach(() => { scene.destroy(); });

  it("single-finger drag rotates camera.mat/useMat, never rotX/rotY", () => {
    const controls = createGlyphOrbitControls(scene, { mode: "trackball" });
    const rotX0 = scene.camera.rotX;
    const rotY0 = scene.camera.rotY;

    pd(scene.host, 100, 100);
    pm(scene.host, 200, 150);
    pu(scene.host);

    expect(scene.camera.useMat).toBe(true);
    expect(scene.camera.mat).not.toBeNull();
    expect(scene.camera.rotX).toBe(rotX0);
    expect(scene.camera.rotY).toBe(rotY0);
    controls.destroy();
  });

  it("entering trackball mode carries the current turntable orientation over (no jump)", () => {
    const controls = createGlyphOrbitControls(scene);
    scene.camera.rotX = 20;
    scene.camera.rotY = 30;
    controls.update({ mode: "trackball" });

    const p: [number, number, number] = [1, 0.5, 0.25];
    const viaMat = scene.camera.project(p, cols, rows, cellAspect);

    // What the same rotX/rotY would give through the Euler path.
    scene.camera.useMat = false;
    const viaEuler = scene.camera.project(p, cols, rows, cellAspect);
    scene.camera.useMat = true;

    expect(viaMat[0]).toBeCloseTo(viaEuler[0], 6);
    expect(viaMat[1]).toBeCloseTo(viaEuler[1], 6);
    controls.destroy();
  });

  it("a two-finger twist rolls in trackball mode but not in turntable mode", () => {
    // Turntable (default): twist must be inert.
    const turntable = createGlyphOrbitControls(scene);
    scene.host.dispatchEvent(new PointerEvent("pointerdown", { clientX: 0, clientY: 0, pointerId: 1, isPrimary: true, bubbles: true }));
    scene.host.dispatchEvent(new PointerEvent("pointerdown", { clientX: 100, clientY: 0, pointerId: 2, isPrimary: false, bubbles: true }));
    scene.host.dispatchEvent(new PointerEvent("pointermove", { clientX: 0, clientY: 100, pointerId: 2, isPrimary: false, bubbles: true }));
    pu(scene.host, 1); pu(scene.host, 2);
    expect(scene.camera.useMat).toBe(false);
    expect(scene.camera.mat).toBeNull();
    turntable.destroy();

    // Trackball: the identical two-finger twist rolls the camera. Read the
    // matrix directly (`mat[2]` is world +Z's contribution to the output's
    // column axis — see `rotateVec3WithMat`) rather than through the full
    // pixel projection, whose zoom/cell-size scaling would shrink a large,
    // unambiguous matrix change to a fraction of a screen cell.
    const trackball = createGlyphOrbitControls(scene, { mode: "trackball" });
    const matBefore = scene.camera.mat;
    expect(matBefore).not.toBeNull();
    expect(matBefore![2]).toBeCloseTo(0, 9); // no roll yet

    scene.host.dispatchEvent(new PointerEvent("pointerdown", { clientX: 0, clientY: 0, pointerId: 1, isPrimary: true, bubbles: true }));
    scene.host.dispatchEvent(new PointerEvent("pointerdown", { clientX: 100, clientY: 0, pointerId: 2, isPrimary: false, bubbles: true }));
    // Rotate the finger pair by 90° about its midpoint: (100,0) → (0,100) relative to pointer 1.
    scene.host.dispatchEvent(new PointerEvent("pointermove", { clientX: 0, clientY: 100, pointerId: 2, isPrimary: false, bubbles: true }));
    pu(scene.host, 1); pu(scene.host, 2);

    expect(scene.camera.useMat).toBe(true);
    const matAfter = scene.camera.mat;
    expect(matAfter).not.toBeNull();
    // A roll turntable can never produce: +Z now has a real column contribution.
    expect(Math.abs(matAfter![2])).toBeGreaterThan(0.5);
    trackball.destroy();
  });

  it("switching from trackball back to turntable disables the matrix path", () => {
    const controls = createGlyphOrbitControls(scene, { mode: "trackball" });
    pd(scene.host, 100, 100);
    pm(scene.host, 200, 150);
    pu(scene.host);
    expect(scene.camera.useMat).toBe(true);

    controls.update({ mode: "turntable" });
    expect(scene.camera.useMat).toBe(false);
    controls.destroy();
  });

  // P1-a (codex gpt-5.6-sol fix round 1): a trackball drag only ever wrote
  // camera.mat — rotX/rotY were left stale, so switching back to turntable
  // (which just did `useMat = false`) snapped the picture to whatever
  // rotX/rotY happened to hold before trackball engaged, discarding every
  // drag performed while in trackball mode.
  it("switching from trackball back to turntable reconstructs rotX/rotY so the picture stays put (depth of reference points is preserved)", () => {
    // pitchRange: null so no clamp can interfere with the invariant below.
    const controls = createGlyphOrbitControls(scene, { mode: "trackball", pitchRange: null });
    pd(scene.host, 100, 100);
    pm(scene.host, 260, 175); // an arbitrary two-axis drag — not a pure twist
    pu(scene.host);
    expect(scene.camera.useMat).toBe(true);

    const refPoints: Array<[number, number, number]> = [
      [1, 0, 0], [0, 1, 0], [0, 0, 1], [1, 1, 1], [-1, 0.5, -0.25],
    ];
    const depthsBefore = refPoints.map((p) => scene.camera.project(p, cols, rows, cellAspect)[2]);

    controls.update({ mode: "turntable" });
    expect(scene.camera.useMat).toBe(false);

    // Dropping roll is an IN-SCREEN-PLANE rotation only: it can never change
    // a point's depth (out[2]), which is exactly what the turntable's own
    // 2-DOF row (row2 of the rotation matrix) is unaffected by any amount
    // of accumulated roll — see createGlyphOrbitControls.ts's
    // `decomposeMatToEuler` comment for the derivation.
    const depthsAfter = refPoints.map((p) => scene.camera.project(p, cols, rows, cellAspect)[2]);
    for (let i = 0; i < refPoints.length; i++) {
      expect(depthsAfter[i]).toBeCloseTo(depthsBefore[i], 6);
    }
    controls.destroy();
  });

  it("switching from trackball back to turntable after a pure twist (roll only) recovers the exact pre-twist rotX/rotY", () => {
    const controls = createGlyphOrbitControls(scene, { mode: "trackball", pitchRange: null });
    const rotX0 = scene.camera.rotX;
    const rotY0 = scene.camera.rotY;

    // A pure two-finger twist composes ONLY a rotation about the output
    // depth axis on top of the entry orientation — no genuine yaw/pitch
    // change — so decomposing back should recover rotX0/rotY0 exactly
    // (mod the usual (rotX,-rotX) same-matrix branch), not merely
    // "some" turntable orientation.
    scene.host.dispatchEvent(new PointerEvent("pointerdown", { clientX: 0, clientY: 0, pointerId: 1, isPrimary: true, bubbles: true }));
    scene.host.dispatchEvent(new PointerEvent("pointerdown", { clientX: 100, clientY: 0, pointerId: 2, isPrimary: false, bubbles: true }));
    scene.host.dispatchEvent(new PointerEvent("pointermove", { clientX: 0, clientY: 100, pointerId: 2, isPrimary: false, bubbles: true }));
    scene.host.dispatchEvent(new PointerEvent("pointerup", { pointerId: 1, isPrimary: true, bubbles: true }));
    scene.host.dispatchEvent(new PointerEvent("pointerup", { pointerId: 2, isPrimary: false, bubbles: true }));
    expect(scene.camera.useMat).toBe(true);

    controls.update({ mode: "turntable" });
    expect(scene.camera.useMat).toBe(false);

    const p: [number, number, number] = [1, 0.5, 0.25];
    const reconstructedDepth = scene.camera.project(p, cols, rows, cellAspect)[2];
    // Depth of a reference point must match what the ORIGINAL rotX0/rotY0
    // would have given directly (twist adds zero net yaw/pitch, all roll).
    scene.camera.rotX = rotX0;
    scene.camera.rotY = rotY0;
    const originalDepth = scene.camera.project(p, cols, rows, cellAspect)[2];
    expect(reconstructedDepth).toBeCloseTo(originalDepth, 5);
    controls.destroy();
  });

  it("switching from trackball back to turntable clamps the reconstructed pitch into pitchRange", () => {
    const controls = createGlyphOrbitControls(scene, { mode: "trackball", pitchRange: [-20, 20] });
    // Drag far enough that the decomposed pitch would exceed 20deg.
    pd(scene.host, 100, 100);
    pm(scene.host, 100, 400);
    pu(scene.host);
    expect(scene.camera.useMat).toBe(true);

    controls.update({ mode: "turntable" });
    expect(scene.camera.useMat).toBe(false);
    expect(scene.camera.rotX).toBeLessThanOrEqual(20);
    expect(scene.camera.rotX).toBeGreaterThanOrEqual(-20);
    controls.destroy();
  });

  // P1 (codex terra fix round 2): at the gimbal singularity (rotX 0 or
  // 180), row 2 of the trackball matrix collapses to [0, 0, ±1] for EVERY
  // rotY — decomposeMatToEuler's general atan2(m6, m7) formula divides 0
  // by 0, snapping rotY to 0 and visibly rotating the picture on any
  // trackball -> turntable switch at these exact orientations.
  it("gimbal lock: turntable (rotX 0, rotY 45) -> trackball with no drag -> turntable returns (0, 45) exactly", () => {
    scene.camera.rotX = 0;
    scene.camera.rotY = 45;
    const controls = createGlyphOrbitControls(scene, { pitchRange: null });
    controls.update({ mode: "trackball" }); // engage with no drag
    expect(scene.camera.useMat).toBe(true);
    controls.update({ mode: "turntable" });
    expect(scene.camera.useMat).toBe(false);
    expect(scene.camera.rotX).toBeCloseTo(0, 9);
    expect(scene.camera.rotY).toBeCloseTo(45, 9);
    controls.destroy();
  });

  it("gimbal lock: the same round trip at rotX 180 returns (180, 45) exactly", () => {
    scene.camera.rotX = 180;
    scene.camera.rotY = 45;
    const controls = createGlyphOrbitControls(scene, { pitchRange: null });
    controls.update({ mode: "trackball" });
    expect(scene.camera.useMat).toBe(true);
    controls.update({ mode: "turntable" });
    expect(scene.camera.useMat).toBe(false);
    expect(scene.camera.rotX).toBeCloseTo(180, 6);
    expect(scene.camera.rotY).toBeCloseTo(45, 6);
    controls.destroy();
  });

  it("gimbal lock: a twist-only trackball roll at rotX 0 -> turntable preserves the exact projected picture", () => {
    scene.camera.rotX = 0;
    scene.camera.rotY = 45;
    const controls = createGlyphOrbitControls(scene, { mode: "trackball", pitchRange: null });

    // Pure twist (roll about the view axis): no drag, just a two-finger
    // rotate — at rotX 0 the view axis IS the world Z axis, so this is
    // exactly the same rotation `rotY` itself is, and dropping "roll" here
    // must fold it back into rotY rather than discard it.
    scene.host.dispatchEvent(new PointerEvent("pointerdown", { clientX: 0, clientY: 0, pointerId: 1, isPrimary: true, bubbles: true }));
    scene.host.dispatchEvent(new PointerEvent("pointerdown", { clientX: 100, clientY: 0, pointerId: 2, isPrimary: false, bubbles: true }));
    scene.host.dispatchEvent(new PointerEvent("pointermove", { clientX: 0, clientY: 100, pointerId: 2, isPrimary: false, bubbles: true }));
    scene.host.dispatchEvent(new PointerEvent("pointerup", { pointerId: 1, isPrimary: true, bubbles: true }));
    scene.host.dispatchEvent(new PointerEvent("pointerup", { pointerId: 2, isPrimary: false, bubbles: true }));
    expect(scene.camera.useMat).toBe(true);

    const refPoints: Array<[number, number, number]> = [
      [1, 0, 0], [0, 1, 0], [0, 0, 1], [1, 1, 1], [-1, 0.5, -0.25],
    ];
    const before = refPoints.map((p) => scene.camera.project(p, cols, rows, cellAspect));

    controls.update({ mode: "turntable" });
    expect(scene.camera.useMat).toBe(false);

    const after = refPoints.map((p) => scene.camera.project(p, cols, rows, cellAspect));
    for (let i = 0; i < refPoints.length; i++) {
      expect(after[i][0]).toBeCloseTo(before[i][0], 6);
      expect(after[i][1]).toBeCloseTo(before[i][1], 6);
      expect(after[i][2]).toBeCloseTo(before[i][2], 6);
    }
    controls.destroy();
  });

  it("no discontinuity sweeping rotX through the gimbal-lock band [-1e-4, 1e-4] with no drag", () => {
    const rotXValues = [-1e-4, -5e-5, -1e-5, 0, 1e-5, 5e-5, 1e-4];
    const p: [number, number, number] = [1, 0.5, 0.25];
    const projected = rotXValues.map((rx) => {
      scene.camera.rotX = rx;
      scene.camera.rotY = 45;
      const controls = createGlyphOrbitControls(scene, { mode: "trackball", pitchRange: null });
      controls.update({ mode: "turntable" }); // decompose immediately, no drag
      const result = scene.camera.project(p, cols, rows, cellAspect);
      controls.destroy();
      return result;
    });
    for (let i = 1; i < projected.length; i++) {
      // A ~5e-5 degree step in rotX should move the projection by a
      // correspondingly tiny amount. The pre-fix bug snapped rotY to 0
      // exactly at rotX 0, which — over these same reference-point
      // deltas — moves the projection by an order of magnitude more than
      // this bound (a rotY jump of 45 degrees' worth).
      expect(Math.abs(projected[i][0] - projected[i - 1][0])).toBeLessThan(0.01);
      expect(Math.abs(projected[i][1] - projected[i - 1][1])).toBeLessThan(0.01);
    }
  });

  // P1 (fix round 3): the general (non-gimbal) branch's principal [0, 180]
  // convention did not round-trip a negative starting rotX. (rotX, rotY)
  // and (-rotX, rotY + 180) share row 2 but are NOT the same rotation
  // (row 0 is negated between them) — decomposeMatToEuler must pick the
  // one whose row 0 actually matches, not the one that happens to need
  // less pitchRange clamping (the pre-fix rule, which under an
  // unrestricted pitchRange always chose the [0, 180] candidate
  // regardless of the true sign of rotX).
  it("sweep: turntable (rotX, rotY) -> trackball (no drag) -> turntable recovers (rotX, rotY) and the projected picture exactly", () => {
    const rotXValues = [-85, -45, -10, -1e-3, 0, 10, 45, 85];
    const rotYValues = [0, 45, 170, -120];
    const refPoints: Array<[number, number, number]> = [
      [1, 0, 0], [0, 1, 0], [0, 0, 1], [1, 1, 1], [-1, 0.5, -0.25],
    ];
    // rotY is only meaningful mod 360 (cos/sin are periodic) — the correct
    // candidate can legitimately land on ry's own +/-360 representative
    // (e.g. -120 recovered as 240) without that being a defect.
    const norm360 = (deg: number) => {
      let d = deg % 360;
      if (d > 180) d -= 360;
      if (d <= -180) d += 360;
      return d;
    };
    for (const rx of rotXValues) {
      for (const ry of rotYValues) {
        scene.camera.rotX = rx;
        scene.camera.rotY = ry;
        const before = refPoints.map((p) => scene.camera.project(p, cols, rows, cellAspect));

        const controls = createGlyphOrbitControls(scene, { mode: "trackball", pitchRange: null });
        controls.update({ mode: "turntable" }); // decompose immediately, no drag

        expect(scene.camera.rotX).toBeCloseTo(rx, 6);
        expect(norm360(scene.camera.rotY)).toBeCloseTo(norm360(ry), 6);

        const after = refPoints.map((p) => scene.camera.project(p, cols, rows, cellAspect));
        for (let i = 0; i < refPoints.length; i++) {
          expect(after[i][0]).toBeCloseTo(before[i][0], 5);
          expect(after[i][1]).toBeCloseTo(before[i][1], 5);
          expect(after[i][2]).toBeCloseTo(before[i][2], 5);
        }
        controls.destroy();
      }
    }
  });

  it("a negative-pitch trackball orientation clamps into pitchRange [0, 90] on switch, and never NaN", () => {
    scene.camera.rotX = -30;
    scene.camera.rotY = 0;
    // pitchRange only applies on the trackball -> turntable switch, so
    // entering trackball here (from this negative turntable orientation)
    // is unclamped, exactly like an unrestricted drag that dipped below
    // the horizon before pitchRange was later re-applied.
    const controls = createGlyphOrbitControls(scene, { mode: "trackball", pitchRange: [0, 90] });
    expect(scene.camera.useMat).toBe(true);

    controls.update({ mode: "turntable" });
    expect(scene.camera.useMat).toBe(false);
    expect(Number.isFinite(scene.camera.rotX)).toBe(true);
    expect(Number.isFinite(scene.camera.rotY)).toBe(true);
    // Documented fallback: the exact reconstruction (rotX -30) lies
    // outside pitchRange, so rotX clamps to the nearest boundary (0)
    // while rotY is held at its own exact, row-0-correct value — never a
    // jump to the OTHER row-2-sharing candidate (rotX 30, rotY 180),
    // which is a different, unclamped-but-wrong picture rather than a
    // clamped version of the true one.
    expect(scene.camera.rotX).toBeCloseTo(0, 9);
    controls.destroy();
  });

  it("random-orientation round trip: trackball -> turntable -> trackball preserves screen-up, only roll is lost", () => {
    // A negative, non-singular starting pitch — exactly the case the
    // pre-fix "needs less clamping" heuristic got wrong under an
    // unrestricted pitchRange (see the sweep test above).
    scene.camera.rotX = -35;
    scene.camera.rotY = 130;
    const controls = createGlyphOrbitControls(scene, { mode: "trackball", pitchRange: null });
    const rotX0 = scene.camera.rotX;
    const rotY0 = scene.camera.rotY;

    // A pure two-finger twist composes ONLY roll on top of the entry
    // orientation (same reasoning as the gimbal-lock twist test above,
    // here at a random non-singular pitch) — so decomposing back must
    // recover rotX0/rotY0 exactly, not merely some row-2-matching
    // turntable orientation.
    scene.host.dispatchEvent(new PointerEvent("pointerdown", { clientX: 0, clientY: 0, pointerId: 1, isPrimary: true, bubbles: true }));
    scene.host.dispatchEvent(new PointerEvent("pointerdown", { clientX: 100, clientY: 0, pointerId: 2, isPrimary: false, bubbles: true }));
    scene.host.dispatchEvent(new PointerEvent("pointermove", { clientX: 30, clientY: 95, pointerId: 2, isPrimary: false, bubbles: true }));
    scene.host.dispatchEvent(new PointerEvent("pointerup", { pointerId: 1, isPrimary: true, bubbles: true }));
    scene.host.dispatchEvent(new PointerEvent("pointerup", { pointerId: 2, isPrimary: false, bubbles: true }));
    expect(scene.camera.useMat).toBe(true);

    const p: [number, number, number] = [1, 0.5, 0.25];
    const up: [number, number, number] = [0, 0, 1];

    controls.update({ mode: "turntable" });
    expect(scene.camera.useMat).toBe(false);
    expect(scene.camera.rotX).toBeCloseTo(rotX0, 5);
    expect(scene.camera.rotY).toBeCloseTo(rotY0, 5);
    const depthAfterFirstSwitch = scene.camera.project(p, cols, rows, cellAspect)[2];
    const upScreenAfterFirstSwitch = scene.camera.project(up, cols, rows, cellAspect);

    // Re-enter trackball with no drag: a pure re-seed from rotX/rotY, so
    // the picture — screen-up included — is UNCHANGED (only the earlier
    // roll was lost, on the first switch; nothing further is lost here).
    controls.update({ mode: "trackball" });
    expect(scene.camera.useMat).toBe(true);
    const depthAfterSecondSwitch = scene.camera.project(p, cols, rows, cellAspect)[2];
    const upScreenAfterSecondSwitch = scene.camera.project(up, cols, rows, cellAspect);

    expect(depthAfterSecondSwitch).toBeCloseTo(depthAfterFirstSwitch, 9);
    expect(upScreenAfterSecondSwitch[0]).toBeCloseTo(upScreenAfterFirstSwitch[0], 9);
    expect(upScreenAfterSecondSwitch[1]).toBeCloseTo(upScreenAfterFirstSwitch[1], 9);
    controls.destroy();
  });
});

describe("createGlyphOrbitControls — trackball auto-rotate (P1-b)", () => {
  let scene: GlyphSceneHandle;
  const cols = 20, rows = 10, cellAspect = 1;

  beforeEach(() => { scene = makeScene(); });
  afterEach(() => { scene.destroy(); });

  it("auto-rotate visibly changes the projected picture in trackball mode", () => {
    const frames: FrameRequestCallback[] = [];
    const spy = vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((fn: FrameRequestCallback) => {
      frames.push(fn);
      return frames.length;
    });

    const controls = createGlyphOrbitControls(scene, { mode: "trackball", animate: { speed: 10 } });
    const before = scene.camera.project([1, 0.5, 0.25], cols, rows, cellAspect);

    // Drive two animation frames manually; each `animTick` re-arms the next
    // one via `requestAnimationFrame`, so pop and invoke the latest each time.
    expect(frames.length).toBeGreaterThan(0);
    frames.pop()!(16.67);
    expect(frames.length).toBeGreaterThan(0);
    frames.pop()!(33.34);

    spy.mockRestore();
    const after = scene.camera.project([1, 0.5, 0.25], cols, rows, cellAspect);
    expect(after[0]).not.toBeCloseTo(before[0], 3);
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
