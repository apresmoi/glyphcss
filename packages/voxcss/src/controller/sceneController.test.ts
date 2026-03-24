import { describe, it, expect, vi } from "vitest";
import { sceneController } from "./sceneController";
import type { ControllerSnapshot, SceneController } from "./sceneController";
import type { SceneState } from "./sceneController";

function makeSceneState(overrides: Partial<SceneState> = {}): SceneState {
  return {
    voxels: [],
    showWalls: false,
    showFloor: false,
    projection: "cubic",
    mergeVoxels: false,
    ...overrides,
  };
}

function makePointerEvent(overrides: Partial<PointerEvent> = {}): PointerEvent {
  return {
    clientX: 0,
    clientY: 0,
    ...overrides,
  } as PointerEvent;
}

describe("sceneController", () => {
  describe("creation", () => {
    it("creates with default options", () => {
      const ctrl = sceneController();
      expect(ctrl).toBeDefined();
      expect(ctrl.getCameraState).toBeDefined();
      expect(ctrl.subscribeSnapshot).toBeDefined();
    });

    it("accepts custom camera options", () => {
      const ctrl = sceneController({ camera: { zoom: 2.0, rotX: 30 } });
      const state = ctrl.getCameraState();
      expect(state.zoom).toBe(2.0);
      expect(state.rotX).toBe(30);
    });

    it("accepts custom dimensions", () => {
      const ctrl = sceneController({ dimensions: { rows: 32, cols: 24 } });
      const dims = ctrl.getDimensions();
      expect(dims.rows).toBeGreaterThanOrEqual(32);
      expect(dims.cols).toBeGreaterThanOrEqual(24);
    });

    it("accepts projection option", () => {
      const ctrl = sceneController({ projection: "dimetric" });
      expect(ctrl.getProjection()).toBe("dimetric");
    });
  });

  describe("subscribeSnapshot", () => {
    it("calls listener immediately with current snapshot on subscribe", () => {
      const ctrl = sceneController();
      const listener = vi.fn();
      ctrl.subscribeSnapshot(listener);
      expect(listener).toHaveBeenCalledTimes(1);
      const snap: ControllerSnapshot = listener.mock.calls[0][0];
      expect(snap.style).toBeDefined();
      expect(snap.walls).toBeDefined();
      expect(snap.camera).toBeDefined();
      expect(snap.cursor).toBe("grab");
    });

    it("returns an unsubscribe function", () => {
      const ctrl = sceneController();
      const listener = vi.fn();
      const unsub = ctrl.subscribeSnapshot(listener);
      expect(typeof unsub).toBe("function");
      listener.mockClear();

      // Trigger an update
      ctrl.updateCamera({ zoom: 1.0 });

      // Listener should have been called
      expect(listener).toHaveBeenCalled();
      listener.mockClear();

      // Unsubscribe
      unsub();

      // Further updates should not reach the listener
      ctrl.updateCamera({ zoom: 1.5 });
      expect(listener).not.toHaveBeenCalled();
    });

    it("supports multiple listeners", () => {
      const ctrl = sceneController();
      const listener1 = vi.fn();
      const listener2 = vi.fn();
      ctrl.subscribeSnapshot(listener1);
      ctrl.subscribeSnapshot(listener2);
      listener1.mockClear();
      listener2.mockClear();

      ctrl.updateCamera({ zoom: 1.0 });
      expect(listener1).toHaveBeenCalled();
      expect(listener2).toHaveBeenCalled();
    });
  });

  describe("cameraOnly flag", () => {
    it("camera update emits snapshot with cameraOnly=true", () => {
      const ctrl = sceneController();
      const listener = vi.fn();
      ctrl.subscribeSnapshot(listener);
      listener.mockClear();

      ctrl.updateCamera({ zoom: 1.2 });
      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener.mock.calls[0][0].cameraOnly).toBe(true);
    });

    it("rotation camera update emits cameraOnly=true", () => {
      const ctrl = sceneController();
      const listener = vi.fn();
      ctrl.subscribeSnapshot(listener);
      listener.mockClear();

      ctrl.updateCamera({ rotX: 45, rotY: 90 });
      expect(listener).toHaveBeenCalled();
      expect(listener.mock.calls[0][0].cameraOnly).toBe(true);
    });

    it("applySceneState emits snapshot with cameraOnly=false", () => {
      const ctrl = sceneController();
      const listener = vi.fn();
      ctrl.subscribeSnapshot(listener);
      listener.mockClear();

      ctrl.applySceneState(makeSceneState({ voxels: [{ x: 0, y: 0, z: 0 }] }));
      expect(listener).toHaveBeenCalled();
      expect(listener.mock.calls[0][0].cameraOnly).toBe(false);
    });
  });

  describe("projection switch", () => {
    it("setProjection changes projection mode", () => {
      const ctrl = sceneController();
      expect(ctrl.getProjection()).toBe("cubic");

      ctrl.setProjection("dimetric");
      expect(ctrl.getProjection()).toBe("dimetric");
    });

    it("setProjection emits snapshot with cameraOnly=false", () => {
      const ctrl = sceneController();
      const listener = vi.fn();
      ctrl.subscribeSnapshot(listener);
      listener.mockClear();

      ctrl.setProjection("dimetric");
      expect(listener).toHaveBeenCalled();
      expect(listener.mock.calls[0][0].cameraOnly).toBe(false);
    });

    it("setProjection does nothing when already in that mode", () => {
      const ctrl = sceneController();
      const listener = vi.fn();
      ctrl.subscribeSnapshot(listener);
      listener.mockClear();

      ctrl.setProjection("cubic"); // already cubic
      expect(listener).not.toHaveBeenCalled();
    });

    it("defaults to cubic for invalid projection", () => {
      const ctrl = sceneController();
      ctrl.setProjection("dimetric");
      expect(ctrl.getProjection()).toBe("dimetric");

      // @ts-expect-error testing invalid input
      ctrl.setProjection("invalid");
      expect(ctrl.getProjection()).toBe("cubic");
    });
  });

  describe("pointer drag sequence", () => {
    it("handlePointerDown sets cursor to grabbing", () => {
      const ctrl = sceneController();
      const listener = vi.fn();
      ctrl.subscribeSnapshot(listener);
      listener.mockClear();

      ctrl.handlePointerDown(makePointerEvent({ clientX: 100, clientY: 100 }));
      expect(listener).toHaveBeenCalled();
      expect(listener.mock.calls[0][0].cursor).toBe("grabbing");
    });

    it("handlePointerMove updates camera rotation", () => {
      const ctrl = sceneController({ camera: { rotX: 65, rotY: 45 } });
      ctrl.handlePointerDown(makePointerEvent({ clientX: 100, clientY: 100 }));

      const initialState = ctrl.getCameraState();
      ctrl.handlePointerMove(makePointerEvent({ clientX: 110, clientY: 105 }));

      const newState = ctrl.getCameraState();
      // rotY should have changed (horizontal drag)
      expect(newState.rotY).not.toBe(initialState.rotY);
      // rotX should have changed (vertical drag)
      expect(newState.rotX).not.toBe(initialState.rotX);
    });

    it("handlePointerMove does nothing when not dragging", () => {
      const ctrl = sceneController({ camera: { rotX: 65, rotY: 45 } });
      const listener = vi.fn();
      ctrl.subscribeSnapshot(listener);
      listener.mockClear();

      ctrl.handlePointerMove(makePointerEvent({ clientX: 110, clientY: 105 }));
      expect(listener).not.toHaveBeenCalled();
    });

    it("handlePointerUp restores cursor to grab", () => {
      const ctrl = sceneController();
      ctrl.handlePointerDown(makePointerEvent({ clientX: 100, clientY: 100 }));

      const listener = vi.fn();
      ctrl.subscribeSnapshot(listener);
      listener.mockClear();

      ctrl.handlePointerUp();
      expect(listener).toHaveBeenCalled();
      expect(listener.mock.calls[0][0].cursor).toBe("grab");
    });

    it("handlePointerUp does nothing when not dragging", () => {
      const ctrl = sceneController();
      const listener = vi.fn();
      ctrl.subscribeSnapshot(listener);
      listener.mockClear();

      ctrl.handlePointerUp();
      expect(listener).not.toHaveBeenCalled();
    });

    it("rotX is clamped between 0 and 100 during drag", () => {
      const ctrl = sceneController({ camera: { rotX: 5 } });
      ctrl.handlePointerDown(makePointerEvent({ clientX: 100, clientY: 100 }));

      // Large upward drag (positive dY) should clamp rotX to 0
      ctrl.handlePointerMove(makePointerEvent({ clientX: 100, clientY: 1000 }));
      const state1 = ctrl.getCameraState();
      expect(state1.rotX).toBeGreaterThanOrEqual(0);
      expect(state1.rotX).toBeLessThanOrEqual(100);
    });

    it("rotY wraps around 0-360 during drag", () => {
      const ctrl = sceneController({ camera: { rotY: 10 } });
      ctrl.handlePointerDown(makePointerEvent({ clientX: 100, clientY: 100 }));

      // Large rightward drag should wrap rotY
      ctrl.handlePointerMove(makePointerEvent({ clientX: 200, clientY: 100 }));
      const state = ctrl.getCameraState();
      expect(state.rotY).toBeGreaterThanOrEqual(0);
      expect(state.rotY).toBeLessThan(360);
    });
  });

  describe("applySceneState", () => {
    it("returns scene snapshot with layers and context", () => {
      const ctrl = sceneController();
      const result = ctrl.applySceneState(
        makeSceneState({ voxels: [{ x: 0, y: 0, z: 0 }] })
      );
      expect(result.layers).toBeDefined();
      expect(result.context).toBeDefined();
    });

    it("returns renderer metadata with mode", () => {
      const ctrl = sceneController();
      const result = ctrl.applySceneState(makeSceneState());
      expect(result.renderer).toBeDefined();
      expect(result.renderer!.mode).toBe("cubes");
    });

    it("returns slice-renderer mode when mergeVoxels=3d", () => {
      const ctrl = sceneController();
      const result = ctrl.applySceneState(
        makeSceneState({ mergeVoxels: "3d" })
      );
      expect(result.renderer!.mode).toBe("slice-renderer");
    });

    it("layers reflect voxel data", () => {
      const ctrl = sceneController();
      const voxels = [
        { x: 0, y: 0, z: 0, color: "red" },
        { x: 0, y: 0, z: 1, color: "blue" },
      ];
      const result = ctrl.applySceneState(makeSceneState({ voxels }));
      expect(result.layers.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("updateCamera", () => {
    it("updates camera state", () => {
      const ctrl = sceneController();
      ctrl.updateCamera({ zoom: 2.5 });
      expect(ctrl.getCameraState().zoom).toBe(2.5);
    });

    it("rotation update refreshes wall mask", () => {
      const ctrl = sceneController({ camera: { rotY: 45 } });
      const wallsBefore = ctrl.getWalls();

      ctrl.updateCamera({ rotY: 200 });
      const wallsAfter = ctrl.getWalls();

      // rotY 45 -> 200 crosses quadrant boundary, walls should change
      expect(wallsAfter.fr).not.toBe(wallsBefore.fr);
    });
  });

  describe("setDimensions", () => {
    it("updates grid dimensions", () => {
      const ctrl = sceneController();
      ctrl.setDimensions({ rows: 50, cols: 40, depth: 20 });
      const dims = ctrl.getDimensions();
      expect(dims.rows).toBeGreaterThanOrEqual(50);
      expect(dims.cols).toBeGreaterThanOrEqual(40);
      expect(dims.depth).toBeGreaterThanOrEqual(20);
    });

    it("emits snapshot with cameraOnly=false", () => {
      const ctrl = sceneController();
      const listener = vi.fn();
      ctrl.subscribeSnapshot(listener);
      listener.mockClear();

      ctrl.setDimensions({ rows: 50 });
      expect(listener).toHaveBeenCalled();
      expect(listener.mock.calls[0][0].cameraOnly).toBe(false);
    });
  });

  describe("setPointerInvert", () => {
    it("inverts drag direction when set to -1", () => {
      const ctrl = sceneController({ camera: { rotY: 180 } });
      ctrl.setPointerInvert(-1);

      ctrl.handlePointerDown(makePointerEvent({ clientX: 100, clientY: 100 }));
      ctrl.handlePointerMove(makePointerEvent({ clientX: 110, clientY: 100 }));
      const invertedRotY = ctrl.getCameraState().rotY;

      const ctrl2 = sceneController({ camera: { rotY: 180 } });
      ctrl2.setPointerInvert(1);
      ctrl2.handlePointerDown(makePointerEvent({ clientX: 100, clientY: 100 }));
      ctrl2.handlePointerMove(makePointerEvent({ clientX: 110, clientY: 100 }));
      const normalRotY = ctrl2.getCameraState().rotY;

      // They should move in opposite directions
      const invertedDelta = invertedRotY - 180;
      const normalDelta = normalRotY - 180;
      // One should be positive and the other negative (or zero vs non-zero)
      expect(Math.sign(invertedDelta)).not.toBe(Math.sign(normalDelta));
    });
  });

  describe("getBoxStyle", () => {
    it("returns an object with transform property", () => {
      const ctrl = sceneController();
      const style = ctrl.getBoxStyle();
      expect(style.transform).toBeDefined();
      expect(style.transform).toContain("scale(");
    });
  });
});
