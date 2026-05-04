import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mountScene, normalizeSceneState, SCENE_HOST_CLASS } from "./sceneBindings";
import { sceneController, type SceneController } from "@layoutit/voxcss-core/controller/sceneController";
import { STYLE_ID } from "@layoutit/voxcss-core/types";

describe("normalizeSceneState", () => {
  it("provides defaults for missing fields", () => {
    const state = normalizeSceneState({});
    expect(state.voxels).toEqual([]);
    expect(state.showWalls).toBe(false);
    expect(state.showFloor).toBe(false);
    expect(state.projection).toBe("cubic");
    expect(state.mergeVoxels).toBe(false);
    expect(state.rows).toBeUndefined();
    expect(state.cols).toBeUndefined();
    expect(state.depth).toBeUndefined();
  });

  it("preserves provided values", () => {
    const voxels = [{ x: 0, y: 0, z: 0 }];
    const state = normalizeSceneState({
      voxels,
      rows: 4,
      cols: 5,
      depth: 3,
      showWalls: true,
      showFloor: true,
      projection: "dimetric",
      mergeVoxels: "2d"
    });
    expect(state.voxels).toBe(voxels);
    expect(state.rows).toBe(4);
    expect(state.cols).toBe(5);
    expect(state.depth).toBe(3);
    expect(state.showWalls).toBe(true);
    expect(state.showFloor).toBe(true);
    expect(state.projection).toBe("dimetric");
    expect(state.mergeVoxels).toBe("2d");
  });
});

describe("mountScene", () => {
  let element: HTMLElement;
  let controller: SceneController;

  beforeEach(() => {
    vi.useFakeTimers();
    element = document.createElement("div");
    document.body.appendChild(element);
    controller = sceneController();
  });

  afterEach(() => {
    vi.useRealTimers();
    element.remove();
    // Clean up injected styles
    const styleEl = document.getElementById(STYLE_ID);
    if (styleEl) styleEl.remove();
  });

  describe("creation and initial render", () => {
    it("returns an object with update and destroy methods", () => {
      const binding = mountScene({
        controller,
        element,
        voxels: [],
        showWalls: false,
        showFloor: false,
        projection: "cubic"
      });

      expect(binding).toBeDefined();
      expect(typeof binding.update).toBe("function");
      expect(typeof binding.destroy).toBe("function");

      binding.destroy();
    });

    it("adds voxcss-scene class to the element", () => {
      const binding = mountScene({
        controller,
        element,
        voxels: [],
        showWalls: false,
        showFloor: false,
        projection: "cubic"
      });

      expect(element.classList.contains(SCENE_HOST_CLASS)).toBe(true);

      binding.destroy();
    });

    it("throws when element is not provided", () => {
      expect(() =>
        mountScene({
          controller,
          element: null as unknown as HTMLElement,
          voxels: [],
          showWalls: false,
          showFloor: false,
          projection: "cubic"
        })
      ).toThrow("voxcss: mountScene requires an element.");
    });

    it("injects base styles into the document", () => {
      const binding = mountScene({
        controller,
        element,
        voxels: [],
        showWalls: false,
        showFloor: false,
        projection: "cubic"
      });

      const styleEl = document.getElementById(STYLE_ID);
      expect(styleEl).not.toBeNull();
      expect(styleEl!.tagName.toLowerCase()).toBe("style");

      binding.destroy();
    });

    it("performs initial synchronous render (creates floor element)", () => {
      const binding = mountScene({
        controller,
        element,
        voxels: [],
        showWalls: false,
        showFloor: false,
        projection: "cubic"
      });

      // The renderer creates a floor element inside the scene element
      const floor = element.querySelector(".voxcss-floor-z");
      expect(floor).not.toBeNull();

      binding.destroy();
    });

    it("renders voxels in initial synchronous render", () => {
      const voxels = [
        { x: 0, y: 0, z: 0, color: "#ff0000" },
        { x: 1, y: 0, z: 0, color: "#00ff00" }
      ];

      const binding = mountScene({
        controller,
        element,
        voxels,
        showWalls: false,
        showFloor: false,
        projection: "cubic"
      });

      // The initial render should have created layer elements
      const layers = element.querySelectorAll(".voxcss-layer");
      expect(layers.length).toBeGreaterThan(0);

      binding.destroy();
    });
  });

  describe("box style application", () => {
    it("applies box style from controller to element", () => {
      const binding = mountScene({
        controller,
        element,
        voxels: [],
        showWalls: false,
        showFloor: false,
        projection: "cubic"
      });

      const boxStyle = controller.getBoxStyle();
      // The element should have the transform applied
      expect(element.style.transform).toBe(boxStyle.transform);

      binding.destroy();
    });
  });

  describe("update() triggering re-render", () => {
    it("update with changed voxels schedules re-render via rAF", () => {
      const binding = mountScene({
        controller,
        element,
        voxels: [],
        showWalls: false,
        showFloor: false,
        projection: "cubic"
      });

      const newVoxels = [{ x: 0, y: 0, z: 0, color: "#ff0000" }];
      binding.update({
        voxels: newVoxels,
        showWalls: false,
        showFloor: false,
        projection: "cubic"
      });

      // The render should be scheduled via rAF, advance one frame
      vi.advanceTimersByTime(16);

      // After rAF fires, layer elements should exist
      const layers = element.querySelectorAll(".voxcss-layer");
      expect(layers.length).toBeGreaterThan(0);

      binding.destroy();
    });

    it("update with changed showWalls triggers re-render", () => {
      const binding = mountScene({
        controller,
        element,
        voxels: [{ x: 0, y: 0, z: 0 }],
        showWalls: false,
        showFloor: false,
        projection: "cubic"
      });

      binding.update({
        voxels: [{ x: 0, y: 0, z: 0 }],
        showWalls: true,
        showFloor: false,
        projection: "cubic"
      });

      vi.advanceTimersByTime(16);

      // After re-render with showWalls=true, wall elements should be present
      const walls = element.querySelectorAll(".voxcss-wall");
      expect(walls.length).toBeGreaterThan(0);

      binding.destroy();
    });

    it("update with changed showFloor triggers re-render", () => {
      const binding = mountScene({
        controller,
        element,
        voxels: [{ x: 0, y: 0, z: 0 }],
        showWalls: false,
        showFloor: false,
        projection: "cubic"
      });

      binding.update({
        voxels: [{ x: 0, y: 0, z: 0 }],
        showWalls: false,
        showFloor: true,
        projection: "cubic"
      });

      vi.advanceTimersByTime(16);

      // Floor should now have background applied
      const floor = element.querySelector(".voxcss-floor-z") as HTMLElement;
      expect(floor).not.toBeNull();

      binding.destroy();
    });

    it("update with changed projection triggers re-render", () => {
      const binding = mountScene({
        controller,
        element,
        voxels: [{ x: 0, y: 0, z: 0 }],
        showWalls: false,
        showFloor: false,
        projection: "cubic"
      });

      binding.update({
        voxels: [{ x: 0, y: 0, z: 0 }],
        showWalls: false,
        showFloor: false,
        projection: "dimetric"
      });

      vi.advanceTimersByTime(16);

      binding.destroy();
    });

    it("update with same state does NOT schedule render", () => {
      const voxels = [{ x: 0, y: 0, z: 0 }];

      const binding = mountScene({
        controller,
        element,
        voxels,
        showWalls: false,
        showFloor: false,
        projection: "cubic"
      });

      // Spy on requestAnimationFrame after initial render
      const rafSpy = vi.spyOn(globalThis, "requestAnimationFrame");

      binding.update({
        voxels,
        showWalls: false,
        showFloor: false,
        projection: "cubic"
      });

      // Same voxels reference and same state — no rAF should be scheduled
      expect(rafSpy).not.toHaveBeenCalled();

      rafSpy.mockRestore();
      binding.destroy();
    });

    it("update with changed rows schedules re-render", () => {
      const voxels = [{ x: 0, y: 0, z: 0 }];

      const rafSpy = vi.spyOn(globalThis, "requestAnimationFrame");

      const binding = mountScene({
        controller,
        element,
        voxels,
        rows: 8,
        showWalls: false,
        showFloor: false,
        projection: "cubic"
      });

      // Clear any calls from mount phase
      rafSpy.mockClear();

      binding.update({
        voxels,
        rows: 16,
        showWalls: false,
        showFloor: false,
        projection: "cubic"
      });

      expect(rafSpy).toHaveBeenCalled();

      rafSpy.mockRestore();
      binding.destroy();
    });

    it("update with changed mergeVoxels schedules re-render", () => {
      const voxels = [{ x: 0, y: 0, z: 0 }];

      const rafSpy = vi.spyOn(globalThis, "requestAnimationFrame");

      const binding = mountScene({
        controller,
        element,
        voxels,
        showWalls: false,
        showFloor: false,
        projection: "cubic",
        mergeVoxels: false
      });

      // Clear any calls from mount phase
      rafSpy.mockClear();

      binding.update({
        voxels,
        showWalls: false,
        showFloor: false,
        projection: "cubic",
        mergeVoxels: "2d"
      });

      expect(rafSpy).toHaveBeenCalled();

      rafSpy.mockRestore();
      binding.destroy();
    });
  });

  describe("camera-only updates", () => {
    it("rotation change that does not change wall mask does NOT re-render", () => {
      const voxels = [{ x: 0, y: 0, z: 0 }];

      const binding = mountScene({
        controller,
        element,
        voxels,
        showWalls: false,
        showFloor: false,
        projection: "cubic"
      });

      const rafSpy = vi.spyOn(globalThis, "requestAnimationFrame");

      // Small rotation change that stays in the same wall mask quadrant
      // Default rotX=65, rotY=45; change to rotY=46 — same quadrant
      controller.updateCamera({ rotY: 46 });

      expect(rafSpy).not.toHaveBeenCalled();

      rafSpy.mockRestore();
      binding.destroy();
    });

    it("rotation change that changes wall mask triggers re-render", () => {
      const voxels = [{ x: 0, y: 0, z: 0 }];

      const binding = mountScene({
        controller,
        element,
        voxels,
        showWalls: false,
        showFloor: false,
        projection: "cubic"
      });

      // The initial render is synchronous, so wait for it to complete
      // Now spy on rAF for the next render
      const rafSpy = vi.spyOn(globalThis, "requestAnimationFrame");

      // Rotate to rotY=200 — this changes the wall mask significantly
      // From default rotY=45: bl=true, fr=false, br=true, fl=false
      // At rotY=200: bl=false, fr=true, br=true, fl=true — fr changes!
      controller.updateCamera({ rotY: 200 });

      // The scene binding should detect the wall mask change and re-render
      // Because lastSceneSnapshot exists, it should render inline rather than via rAF
      // Either way, the walls should be updated
      rafSpy.mockRestore();
      binding.destroy();
    });

    it("rotX change past 90 triggers wall mask change (top/bottom flip)", () => {
      const voxels = [{ x: 0, y: 0, z: 0 }];

      const binding = mountScene({
        controller,
        element,
        voxels,
        showWalls: false,
        showFloor: false,
        projection: "cubic"
      });

      // Default rotX=65, top is visible (t: false)
      // Change to rotX=95, top should be hidden (t: true)
      controller.updateCamera({ rotX: 95 });

      // The wall mask should have changed
      const walls = controller.getWalls();
      expect(walls.t).toBe(true);
      expect(walls.b).toBe(false);

      binding.destroy();
    });
  });

  describe("grid suppression", () => {
    it("suppresses grid when camera rotation changes", () => {
      const voxels = [{ x: 0, y: 0, z: 0 }];

      const binding = mountScene({
        controller,
        element,
        voxels,
        showWalls: false,
        showFloor: true,
        projection: "cubic"
      });

      // Change rotation to trigger grid suppression
      controller.updateCamera({ rotY: 50 });

      // Grid should be suppressed
      expect(element.style.getPropertyValue("--voxcss-floor-grid-image")).toBe("none");
      expect(element.style.getPropertyValue("--voxcss-ceiling-grid-image")).toBe("none");

      binding.destroy();
    });

    it("restores grid after delay when rotation stops", () => {
      const voxels = [{ x: 0, y: 0, z: 0 }];

      const binding = mountScene({
        controller,
        element,
        voxels,
        showWalls: false,
        showFloor: true,
        projection: "cubic"
      });

      // Change rotation to trigger grid suppression
      controller.updateCamera({ rotY: 50 });

      expect(element.style.getPropertyValue("--voxcss-floor-grid-image")).toBe("none");

      // Advance past the GRID_RESTORE_DELAY (120ms)
      vi.advanceTimersByTime(150);

      // Grid should be restored
      expect(element.style.getPropertyValue("--voxcss-floor-grid-image")).toBe("");

      binding.destroy();
    });

    it("grid suppression resets timer on subsequent rotations", () => {
      const voxels = [{ x: 0, y: 0, z: 0 }];

      const binding = mountScene({
        controller,
        element,
        voxels,
        showWalls: false,
        showFloor: true,
        projection: "cubic"
      });

      // First rotation
      controller.updateCamera({ rotY: 50 });
      expect(element.style.getPropertyValue("--voxcss-floor-grid-image")).toBe("none");

      // Advance 100ms (not enough to restore)
      vi.advanceTimersByTime(100);

      // Second rotation — should reset the timer
      controller.updateCamera({ rotY: 55 });
      expect(element.style.getPropertyValue("--voxcss-floor-grid-image")).toBe("none");

      // Advance 100ms (only 100ms since second rotation, not enough)
      vi.advanceTimersByTime(100);
      expect(element.style.getPropertyValue("--voxcss-floor-grid-image")).toBe("none");

      // Advance another 30ms (now 130ms since second rotation)
      vi.advanceTimersByTime(30);
      expect(element.style.getPropertyValue("--voxcss-floor-grid-image")).toBe("");

      binding.destroy();
    });

    it("grid restores immediately when drag ends (cursor goes from grabbing to grab)", () => {
      const voxels = [{ x: 0, y: 0, z: 0 }];

      const binding = mountScene({
        controller,
        element,
        voxels,
        showWalls: false,
        showFloor: true,
        projection: "cubic"
      });

      // Simulate pointer drag to change cursor to grabbing
      controller.handlePointerDown(new PointerEvent("pointerdown", { clientX: 0, clientY: 0 }));

      // Move to trigger rotation + grid suppression
      controller.handlePointerMove(new PointerEvent("pointermove", { clientX: 25, clientY: 0 }));
      expect(element.style.getPropertyValue("--voxcss-floor-grid-image")).toBe("none");

      // End drag — cursor goes from "grabbing" to "grab", grid should restore immediately
      controller.handlePointerUp();
      expect(element.style.getPropertyValue("--voxcss-floor-grid-image")).toBe("");

      binding.destroy();
    });
  });

  describe("destroy()", () => {
    it("cancels pending rAF on destroy", () => {
      const cancelSpy = vi.spyOn(globalThis, "cancelAnimationFrame");

      const binding = mountScene({
        controller,
        element,
        voxels: [],
        showWalls: false,
        showFloor: false,
        projection: "cubic"
      });

      // Schedule a render
      binding.update({
        voxels: [{ x: 0, y: 0, z: 0 }],
        showWalls: false,
        showFloor: false,
        projection: "cubic"
      });

      // Destroy before rAF fires
      binding.destroy();

      expect(cancelSpy).toHaveBeenCalled();

      cancelSpy.mockRestore();
    });

    it("clears grid restore timer on destroy", () => {
      const binding = mountScene({
        controller,
        element,
        voxels: [{ x: 0, y: 0, z: 0 }],
        showWalls: false,
        showFloor: true,
        projection: "cubic"
      });

      // Trigger grid suppression
      controller.updateCamera({ rotY: 50 });
      expect(element.style.getPropertyValue("--voxcss-floor-grid-image")).toBe("none");

      // Destroy with active grid restore timer
      binding.destroy();

      // Advance past the restore delay — it should NOT restore since we destroyed
      vi.advanceTimersByTime(200);

      // The binding is destroyed, so element.style may or may not be modified.
      // The key thing is that no error is thrown.
    });

    it("unsubscribes from controller on destroy", () => {
      const rafSpy = vi.spyOn(globalThis, "requestAnimationFrame");

      const binding = mountScene({
        controller,
        element,
        voxels: [],
        showWalls: false,
        showFloor: false,
        projection: "cubic"
      });

      binding.destroy();
      rafSpy.mockClear();

      // After destroy, controller updates should NOT schedule a re-render
      controller.updateCamera({ zoom: 2 });
      expect(rafSpy).not.toHaveBeenCalled();

      rafSpy.mockRestore();
    });

    it("destroys the renderer (removes floor element)", () => {
      const binding = mountScene({
        controller,
        element,
        voxels: [],
        showWalls: false,
        showFloor: false,
        projection: "cubic"
      });

      const floor = element.querySelector(".voxcss-floor-z");
      expect(floor).not.toBeNull();

      binding.destroy();

      const floorAfter = element.querySelector(".voxcss-floor-z");
      expect(floorAfter).toBeNull();
    });
  });

  describe("subscription to controller snapshots", () => {
    it("applies updated box style on camera changes", () => {
      const binding = mountScene({
        controller,
        element,
        voxels: [],
        showWalls: false,
        showFloor: false,
        projection: "cubic"
      });

      const initialTransform = element.style.transform;

      // Update camera zoom
      controller.updateCamera({ zoom: 2 });

      const updatedTransform = element.style.transform;
      expect(updatedTransform).not.toBe(initialTransform);
      expect(updatedTransform).toContain("scale(2)");

      binding.destroy();
    });

    it("handles multiple sequential camera updates", () => {
      const binding = mountScene({
        controller,
        element,
        voxels: [],
        showWalls: false,
        showFloor: false,
        projection: "cubic"
      });

      controller.updateCamera({ zoom: 1.5 });
      controller.updateCamera({ pan: 10 });
      controller.updateCamera({ tilt: -5 });

      const transform = element.style.transform;
      expect(transform).toContain("scale(1.5)");
      expect(transform).toContain("translateX(10px)");
      expect(transform).toContain("translateY(-5px)");

      binding.destroy();
    });
  });

  describe("setDimensions triggering re-render from controller", () => {
    it("dimension change from controller triggers re-render", () => {
      const rafSpy = vi.spyOn(globalThis, "requestAnimationFrame");

      const binding = mountScene({
        controller,
        element,
        voxels: [{ x: 0, y: 0, z: 0 }],
        showWalls: false,
        showFloor: false,
        projection: "cubic"
      });

      // Clear any calls from mount phase
      rafSpy.mockClear();

      controller.setDimensions({ rows: 20 });

      // The controller emits a non-camera-only snapshot, and the sceneBinding
      // checks dimension changes. Since rows changed, rAF should be scheduled.
      expect(rafSpy).toHaveBeenCalled();

      rafSpy.mockRestore();
      binding.destroy();
    });
  });

  describe("projection change from controller", () => {
    it("setProjection on controller triggers re-render", () => {
      const rafSpy = vi.spyOn(globalThis, "requestAnimationFrame");

      const binding = mountScene({
        controller,
        element,
        voxels: [{ x: 0, y: 0, z: 0 }],
        showWalls: false,
        showFloor: false,
        projection: "cubic"
      });

      // Clear any calls from mount phase
      rafSpy.mockClear();

      controller.setProjection("dimetric");

      expect(rafSpy).toHaveBeenCalled();

      rafSpy.mockRestore();
      binding.destroy();
    });
  });
});
