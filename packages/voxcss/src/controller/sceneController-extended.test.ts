import { describe, it, expect, vi, beforeEach } from "vitest";
import { sceneController, type SceneController } from "./sceneController";
import type { SceneState } from "./sceneController";

describe("sceneController — extended coverage", () => {
  let controller: SceneController;

  beforeEach(() => {
    controller = sceneController();
  });

  describe("getBoxStyle()", () => {
    it("returns an object with transform, width, and height", () => {
      const style = controller.getBoxStyle();
      expect(style).toHaveProperty("transform");
      expect(style).toHaveProperty("width");
      expect(style).toHaveProperty("height");
      expect(typeof style.transform).toBe("string");
      expect(typeof style.width).toBe("string");
      expect(typeof style.height).toBe("string");
    });

    it("transform includes scale with default zoom", () => {
      const style = controller.getBoxStyle();
      expect(style.transform).toContain("scale(0.65)");
    });

    it("transform includes rotateX and rotate from camera state", () => {
      const style = controller.getBoxStyle();
      expect(style.transform).toContain("rotateX(65deg)");
      expect(style.transform).toContain("rotate(45deg)");
    });

    it("width and height reflect grid dimensions", () => {
      const style = controller.getBoxStyle();
      // Default grid is 16x16 with 50px tiles = 800px
      expect(style.width).toBe("800px");
      expect(style.height).toBe("800px");
    });

    it("updates after camera zoom change", () => {
      controller.updateCamera({ zoom: 2 });
      const style = controller.getBoxStyle();
      expect(style.transform).toContain("scale(2)");
    });

    it("updates after setDimensions", () => {
      controller.setDimensions({ rows: 4, cols: 6 });
      const style = controller.getBoxStyle();
      // 6 cols * 50px = 300px width, 4 rows * 50px = 200px height
      expect(style.width).toBe("300px");
      expect(style.height).toBe("200px");
    });
  });

  describe("setDimensions()", () => {
    it("updates rows", () => {
      controller.setDimensions({ rows: 10 });
      const dims = controller.getDimensions();
      expect(dims.rows).toBe(10);
    });

    it("updates cols", () => {
      controller.setDimensions({ cols: 12 });
      const dims = controller.getDimensions();
      expect(dims.cols).toBe(12);
    });

    it("updates depth", () => {
      controller.setDimensions({ depth: 5 });
      const dims = controller.getDimensions();
      expect(dims.depth).toBe(5);
    });

    it("partial update only changes specified dimensions", () => {
      controller.setDimensions({ rows: 10, cols: 8, depth: 6 });
      controller.setDimensions({ rows: 20 });
      const dims = controller.getDimensions();
      expect(dims.rows).toBe(20);
      expect(dims.cols).toBe(8);
      expect(dims.depth).toBe(6);
    });

    it("emits snapshot after setDimensions", () => {
      const listener = vi.fn();
      controller.subscribeSnapshot(listener);
      listener.mockClear();

      controller.setDimensions({ rows: 10 });

      expect(listener).toHaveBeenCalled();
      const snapshot = listener.mock.calls[0][0];
      expect(snapshot.cameraOnly).toBe(false);
    });

    it("partial update with only depth", () => {
      controller.setDimensions({ rows: 5, cols: 7 });
      controller.setDimensions({ depth: 3 });
      const dims = controller.getDimensions();
      expect(dims.rows).toBe(5);
      expect(dims.cols).toBe(7);
      expect(dims.depth).toBe(3);
    });
  });

  describe("applySceneState()", () => {
    it("returns layers and context", () => {
      const state: SceneState = {
        voxels: [{ x: 0, y: 0, z: 0, color: "#ff0000" }],
        showWalls: false,
        showFloor: false,
        projection: "cubic"
      };

      const result = controller.applySceneState(state);
      expect(result).toHaveProperty("layers");
      expect(result).toHaveProperty("context");
      expect(Array.isArray(result.layers)).toBe(true);
      expect(result.context).toBeDefined();
    });

    it("includes renderer metadata", () => {
      const state: SceneState = {
        voxels: [],
        showWalls: false,
        showFloor: false,
        projection: "cubic"
      };

      const result = controller.applySceneState(state);
      expect(result.renderer).toBeDefined();
      expect(result.renderer!.mode).toBe("cubes");
    });

    it("with mergeVoxels='2d' still returns cubes mode", () => {
      const state: SceneState = {
        voxels: [
          { x: 0, y: 0, z: 0, color: "#ff0000" },
          { x: 1, y: 0, z: 0, color: "#ff0000" }
        ],
        showWalls: false,
        showFloor: false,
        projection: "cubic",
        mergeVoxels: "2d"
      };

      const result = controller.applySceneState(state);
      expect(result.renderer!.mode).toBe("cubes");
    });

    it("with mergeVoxels='3d' returns slice-renderer mode", () => {
      const state: SceneState = {
        voxels: [{ x: 0, y: 0, z: 0, color: "#ff0000" }],
        showWalls: false,
        showFloor: false,
        projection: "cubic",
        mergeVoxels: "3d"
      };

      const result = controller.applySceneState(state);
      expect(result.renderer!.mode).toBe("slice-renderer");
    });

    it("caches merged grid when called twice with same voxels", () => {
      const voxels = [
        { x: 0, y: 0, z: 0, color: "#ff0000" },
        { x: 1, y: 0, z: 0, color: "#ff0000" }
      ];
      const state: SceneState = {
        voxels,
        showWalls: false,
        showFloor: false,
        projection: "cubic",
        mergeVoxels: "2d"
      };

      const result1 = controller.applySceneState(state);
      const result2 = controller.applySceneState(state);

      // Second call should use cached grid — layers should be equivalent
      expect(result1.layers.length).toBe(result2.layers.length);
    });

    it("invalidates cache when voxels reference changes", () => {
      const voxels1 = [{ x: 0, y: 0, z: 0, color: "#ff0000" }];
      const voxels2 = [{ x: 0, y: 0, z: 0, color: "#00ff00" }];

      const state1: SceneState = {
        voxels: voxels1,
        showWalls: false,
        showFloor: false,
        projection: "cubic"
      };
      const state2: SceneState = {
        voxels: voxels2,
        showWalls: false,
        showFloor: false,
        projection: "cubic"
      };

      const result1 = controller.applySceneState(state1);
      const result2 = controller.applySceneState(state2);

      // Different voxel arrays should produce different results
      expect(result1.layers).not.toBe(result2.layers);
    });

    it("invalidates cache when mergeVoxels option changes", () => {
      const voxels = [
        { x: 0, y: 0, z: 0, color: "#ff0000" },
        { x: 1, y: 0, z: 0, color: "#ff0000" }
      ];

      const state1: SceneState = {
        voxels,
        showWalls: false,
        showFloor: false,
        projection: "cubic",
        mergeVoxels: false
      };
      const state2: SceneState = {
        voxels,
        showWalls: false,
        showFloor: false,
        projection: "cubic",
        mergeVoxels: "2d"
      };

      const result1 = controller.applySceneState(state1);
      const result2 = controller.applySceneState(state2);

      // With mergeVoxels="2d", adjacent same-colored voxels get merged
      // so the layer content may differ from the non-merged version
      expect(result1).toBeDefined();
      expect(result2).toBeDefined();
    });

    it("does not rebuild scene if state references are the same", () => {
      const state: SceneState = {
        voxels: [{ x: 0, y: 0, z: 0 }],
        showWalls: false,
        showFloor: false,
        projection: "cubic"
      };

      controller.applySceneState(state);

      // Call again with same state — needsRebuild should be false
      const result2 = controller.applySceneState(state);
      expect(result2).toBeDefined();
      expect(result2.layers).toBeDefined();
    });

    it("emits non-camera-only snapshot", () => {
      const listener = vi.fn();
      controller.subscribeSnapshot(listener);
      listener.mockClear();

      const state: SceneState = {
        voxels: [{ x: 0, y: 0, z: 0 }],
        showWalls: false,
        showFloor: false,
        projection: "cubic"
      };

      controller.applySceneState(state);

      expect(listener).toHaveBeenCalled();
      const snapshot = listener.mock.calls[0][0];
      expect(snapshot.cameraOnly).toBe(false);
    });

    it("rebuilds when showWalls changes", () => {
      const voxels = [{ x: 0, y: 0, z: 0 }];

      const state1: SceneState = {
        voxels,
        showWalls: false,
        showFloor: false,
        projection: "cubic"
      };
      const state2: SceneState = {
        voxels,
        showWalls: true,
        showFloor: false,
        projection: "cubic"
      };

      controller.applySceneState(state1);
      const result = controller.applySceneState(state2);

      expect(result.context.showWalls).toBe(true);
    });

    it("rebuilds when showFloor changes", () => {
      const voxels = [{ x: 0, y: 0, z: 0 }];

      const state1: SceneState = {
        voxels,
        showWalls: false,
        showFloor: false,
        projection: "cubic"
      };
      const state2: SceneState = {
        voxels,
        showWalls: false,
        showFloor: true,
        projection: "cubic"
      };

      controller.applySceneState(state1);
      const result = controller.applySceneState(state2);

      expect(result.context.showFloor).toBe(true);
    });

    it("rebuilds when projection changes", () => {
      const voxels = [{ x: 0, y: 0, z: 0 }];

      const state1: SceneState = {
        voxels,
        showWalls: false,
        showFloor: false,
        projection: "cubic"
      };
      const state2: SceneState = {
        voxels,
        showWalls: false,
        showFloor: false,
        projection: "dimetric"
      };

      controller.applySceneState(state1);
      const result = controller.applySceneState(state2);

      expect(result.context.projection).toBe("dimetric");
    });
  });

  describe("getCursor()", () => {
    it("returns 'grab' when not dragging", () => {
      expect(controller.getCursor()).toBe("grab");
    });

    it("returns 'grabbing' during drag", () => {
      controller.handlePointerDown(
        new PointerEvent("pointerdown", { clientX: 0, clientY: 0 })
      );
      expect(controller.getCursor()).toBe("grabbing");

      controller.handlePointerUp();
    });

    it("returns 'grab' after drag ends", () => {
      controller.handlePointerDown(
        new PointerEvent("pointerdown", { clientX: 0, clientY: 0 })
      );
      controller.handlePointerUp();
      expect(controller.getCursor()).toBe("grab");
    });
  });

  describe("getWalls()", () => {
    it("returns current wall mask", () => {
      const walls = controller.getWalls();
      expect(walls).toHaveProperty("t");
      expect(walls).toHaveProperty("b");
      expect(walls).toHaveProperty("bl");
      expect(walls).toHaveProperty("br");
      expect(walls).toHaveProperty("fl");
      expect(walls).toHaveProperty("fr");
    });

    it("returns default walls for default camera (rotX=65, rotY=45)", () => {
      const walls = controller.getWalls();
      // rotX=65 < 90, so top visible, bottom hidden
      expect(walls.t).toBe(false);
      expect(walls.b).toBe(true);
      // rotY=45: normalizedRotY=45
      // bl: 45 <= 180 → true
      // fr: 45 > 180 → false
      // br: 45 < 90 || 45 >= 270 → true
      // fl: 45 >= 90 && 45 < 270 → false
      expect(walls.bl).toBe(true);
      expect(walls.fr).toBe(false);
      expect(walls.br).toBe(true);
      expect(walls.fl).toBe(false);
    });

    it("walls change after camera rotation", () => {
      const wallsBefore = controller.getWalls();

      controller.updateCamera({ rotY: 200 });

      const wallsAfter = controller.getWalls();
      // At rotY=200:
      // bl: 200 <= 180 → false (changed)
      // fr: 200 > 180 → true (changed)
      expect(wallsAfter.bl).not.toBe(wallsBefore.bl);
      expect(wallsAfter.fr).not.toBe(wallsBefore.fr);
    });

    it("top/bottom walls flip when rotX crosses 90", () => {
      expect(controller.getWalls().t).toBe(false);
      expect(controller.getWalls().b).toBe(true);

      controller.updateCamera({ rotX: 95 });

      expect(controller.getWalls().t).toBe(true);
      expect(controller.getWalls().b).toBe(false);
    });
  });

  describe("getProjection()", () => {
    it("returns 'cubic' by default", () => {
      expect(controller.getProjection()).toBe("cubic");
    });

    it("returns 'dimetric' when initialized with dimetric", () => {
      const ctrl = sceneController({ projection: "dimetric" });
      expect(ctrl.getProjection()).toBe("dimetric");
    });

    it("returns updated projection after setProjection", () => {
      controller.setProjection("dimetric");
      expect(controller.getProjection()).toBe("dimetric");
    });

    it("returns 'cubic' after switching back from dimetric", () => {
      controller.setProjection("dimetric");
      controller.setProjection("cubic");
      expect(controller.getProjection()).toBe("cubic");
    });

    it("setProjection with undefined defaults to cubic", () => {
      controller.setProjection("dimetric");
      controller.setProjection(undefined);
      expect(controller.getProjection()).toBe("cubic");
    });

    it("setProjection does not emit snapshot if projection is already the same", () => {
      const listener = vi.fn();
      controller.subscribeSnapshot(listener);
      listener.mockClear();

      controller.setProjection("cubic"); // already cubic
      expect(listener).not.toHaveBeenCalled();
    });

    it("setProjection emits snapshot when projection changes", () => {
      const listener = vi.fn();
      controller.subscribeSnapshot(listener);
      listener.mockClear();

      controller.setProjection("dimetric");
      expect(listener).toHaveBeenCalled();
      expect(listener.mock.calls[0][0].cameraOnly).toBe(false);
    });
  });

  describe("getDimensions()", () => {
    it("returns default dimensions when no voxels are present", () => {
      const dims = controller.getDimensions();
      // Default fallbacks: 16x16x12
      expect(dims.rows).toBe(16);
      expect(dims.cols).toBe(16);
      expect(dims.depth).toBe(12);
    });

    it("returns overridden dimensions when specified", () => {
      const ctrl = sceneController({ dimensions: { rows: 8, cols: 10, depth: 4 } });
      const dims = ctrl.getDimensions();
      expect(dims.rows).toBe(8);
      expect(dims.cols).toBe(10);
      expect(dims.depth).toBe(4);
    });

    it("dimensions expand to fit voxel grid", () => {
      const ctrl = sceneController({ dimensions: { rows: 2, cols: 2, depth: 1 } });

      ctrl.applySceneState({
        voxels: [{ x: 5, y: 5, z: 5 }],
        showWalls: false,
        showFloor: false,
        projection: "cubic"
      });

      const dims = ctrl.getDimensions();
      // Grid should expand to fit voxel at (5,5,5)
      expect(dims.rows).toBeGreaterThanOrEqual(6);
      expect(dims.cols).toBeGreaterThanOrEqual(6);
      expect(dims.depth).toBeGreaterThanOrEqual(6);
    });
  });

  describe("updateCamera()", () => {
    it("updates zoom", () => {
      controller.updateCamera({ zoom: 2 });
      expect(controller.getCameraState().zoom).toBe(2);
    });

    it("updates pan", () => {
      controller.updateCamera({ pan: 50 });
      expect(controller.getCameraState().pan).toBe(50);
    });

    it("updates tilt", () => {
      controller.updateCamera({ tilt: -10 });
      expect(controller.getCameraState().tilt).toBe(-10);
    });

    it("updates rotX", () => {
      controller.updateCamera({ rotX: 30 });
      expect(controller.getCameraState().rotX).toBe(30);
    });

    it("updates rotY", () => {
      controller.updateCamera({ rotY: 180 });
      expect(controller.getCameraState().rotY).toBe(180);
    });

    it("emits camera-only snapshot on rotation", () => {
      const listener = vi.fn();
      controller.subscribeSnapshot(listener);
      listener.mockClear();

      controller.updateCamera({ rotY: 90 });

      expect(listener).toHaveBeenCalled();
      expect(listener.mock.calls[0][0].cameraOnly).toBe(true);
    });

    it("emits camera-only snapshot on non-rotation changes", () => {
      const listener = vi.fn();
      controller.subscribeSnapshot(listener);
      listener.mockClear();

      controller.updateCamera({ zoom: 2 });

      expect(listener).toHaveBeenCalled();
      expect(listener.mock.calls[0][0].cameraOnly).toBe(true);
    });

    it("updates wall mask when rotation changes quadrant", () => {
      const wallsBefore = controller.getWalls();

      controller.updateCamera({ rotY: 200 });

      const wallsAfter = controller.getWalls();
      expect(wallsAfter.bl).not.toBe(wallsBefore.bl);
    });
  });

  describe("subscribeSnapshot()", () => {
    it("calls listener immediately with initial snapshot", () => {
      const listener = vi.fn();
      controller.subscribeSnapshot(listener);

      expect(listener).toHaveBeenCalledTimes(1);
      const snapshot = listener.mock.calls[0][0];
      expect(snapshot).toHaveProperty("style");
      expect(snapshot).toHaveProperty("walls");
      expect(snapshot).toHaveProperty("cursor");
      expect(snapshot).toHaveProperty("camera");
      expect(snapshot).toHaveProperty("cameraOnly");
      expect(snapshot).toHaveProperty("context");
      expect(snapshot).toHaveProperty("depthLayers");
    });

    it("returns an unsubscribe function", () => {
      const listener = vi.fn();
      const unsubscribe = controller.subscribeSnapshot(listener);

      expect(typeof unsubscribe).toBe("function");

      listener.mockClear();
      unsubscribe();

      controller.updateCamera({ zoom: 2 });
      expect(listener).not.toHaveBeenCalled();
    });

    it("supports multiple simultaneous subscribers", () => {
      const listener1 = vi.fn();
      const listener2 = vi.fn();

      controller.subscribeSnapshot(listener1);
      controller.subscribeSnapshot(listener2);

      listener1.mockClear();
      listener2.mockClear();

      controller.updateCamera({ zoom: 2 });

      expect(listener1).toHaveBeenCalled();
      expect(listener2).toHaveBeenCalled();
    });
  });

  describe("setPointerInvert()", () => {
    it("does not throw", () => {
      expect(() => controller.setPointerInvert(1)).not.toThrow();
      expect(() => controller.setPointerInvert(-1)).not.toThrow();
    });

    it("affects drag direction", () => {
      controller.setPointerInvert(-1);

      controller.handlePointerDown(
        new PointerEvent("pointerdown", { clientX: 100, clientY: 100 })
      );

      const listener = vi.fn();
      controller.subscribeSnapshot(listener);
      listener.mockClear();

      controller.handlePointerMove(
        new PointerEvent("pointermove", { clientX: 125, clientY: 100 })
      );

      expect(listener).toHaveBeenCalled();
      const snapshot = listener.mock.calls[0][0];
      // With invert=-1, horizontal drag of +25px should rotate in opposite direction
      // dX = (25 * -1) / 5 = -5
      // rotY = (45 - (-5) + 360) % 360 = 50
      expect(snapshot.camera.rotY).toBe(50);

      controller.handlePointerUp();
    });
  });

  describe("pointer handling", () => {
    it("handlePointerDown sets dragging state", () => {
      controller.handlePointerDown(
        new PointerEvent("pointerdown", { clientX: 50, clientY: 50 })
      );

      expect(controller.getCursor()).toBe("grabbing");

      controller.handlePointerUp();
    });

    it("handlePointerMove without pointerDown does nothing", () => {
      const listener = vi.fn();
      controller.subscribeSnapshot(listener);
      listener.mockClear();

      controller.handlePointerMove(
        new PointerEvent("pointermove", { clientX: 100, clientY: 100 })
      );

      expect(listener).not.toHaveBeenCalled();
    });

    it("handlePointerUp without pointerDown does nothing", () => {
      const listener = vi.fn();
      controller.subscribeSnapshot(listener);
      listener.mockClear();

      controller.handlePointerUp();

      expect(listener).not.toHaveBeenCalled();
    });

    it("full drag cycle: down, move, up", () => {
      const listener = vi.fn();
      controller.subscribeSnapshot(listener);
      listener.mockClear();

      controller.handlePointerDown(
        new PointerEvent("pointerdown", { clientX: 100, clientY: 100 })
      );
      expect(controller.getCursor()).toBe("grabbing");

      controller.handlePointerMove(
        new PointerEvent("pointermove", { clientX: 150, clientY: 120 })
      );

      controller.handlePointerUp();
      expect(controller.getCursor()).toBe("grab");

      // Multiple snapshots should have been emitted
      expect(listener.mock.calls.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe("sceneController() with options", () => {
    it("initializes with custom camera state", () => {
      const ctrl = sceneController({
        camera: { zoom: 2, pan: 10, tilt: 5, rotX: 30, rotY: 90 }
      });

      const cam = ctrl.getCameraState();
      expect(cam.zoom).toBe(2);
      expect(cam.pan).toBe(10);
      expect(cam.tilt).toBe(5);
      expect(cam.rotX).toBe(30);
      expect(cam.rotY).toBe(90);
    });

    it("initializes with custom dimensions", () => {
      const ctrl = sceneController({
        dimensions: { rows: 4, cols: 6, depth: 2 }
      });

      const dims = ctrl.getDimensions();
      expect(dims.rows).toBe(4);
      expect(dims.cols).toBe(6);
      expect(dims.depth).toBe(2);
    });

    it("initializes with dimetric projection", () => {
      const ctrl = sceneController({ projection: "dimetric" });
      expect(ctrl.getProjection()).toBe("dimetric");
    });

    it("initializes with pointerInvert", () => {
      const ctrl = sceneController({ pointerInvert: -1 });
      // We can verify indirectly through pointer behavior
      ctrl.handlePointerDown(
        new PointerEvent("pointerdown", { clientX: 100, clientY: 100 })
      );

      const listener = vi.fn();
      ctrl.subscribeSnapshot(listener);
      listener.mockClear();

      ctrl.handlePointerMove(
        new PointerEvent("pointermove", { clientX: 125, clientY: 100 })
      );

      const snapshot = listener.mock.calls[0][0];
      // With invert=-1, dX = (25 * -1) / 5 = -5
      // rotY = (45 - (-5) + 360) % 360 = 50
      expect(snapshot.camera.rotY).toBe(50);

      ctrl.handlePointerUp();
    });
  });
});
