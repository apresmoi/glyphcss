import { describe, it, expect } from "vitest";
import {
  createIsometricCamera,
  normalizeInvertMultiplier,
  DEFAULT_CAMERA_STATE,
} from "./camera";

describe("DEFAULT_CAMERA_STATE", () => {
  it("has expected default values", () => {
    expect(DEFAULT_CAMERA_STATE.zoom).toBe(0.65);
    expect(DEFAULT_CAMERA_STATE.pan).toBe(0);
    expect(DEFAULT_CAMERA_STATE.tilt).toBe(0);
    expect(DEFAULT_CAMERA_STATE.rotX).toBe(65);
    expect(DEFAULT_CAMERA_STATE.rotY).toBe(45);
    expect(DEFAULT_CAMERA_STATE.depthOffset).toBe(20);
  });
});

describe("normalizeInvertMultiplier", () => {
  it("returns -1 for true", () => {
    expect(normalizeInvertMultiplier(true)).toBe(-1);
  });

  it("returns 1 for false", () => {
    expect(normalizeInvertMultiplier(false)).toBe(1);
  });

  it("returns undefined for undefined", () => {
    expect(normalizeInvertMultiplier(undefined)).toBeUndefined();
  });

  it("returns 1 for positive number", () => {
    expect(normalizeInvertMultiplier(5)).toBe(1);
  });

  it("returns -1 for negative number", () => {
    expect(normalizeInvertMultiplier(-3)).toBe(-1);
  });

  it("returns undefined for 0", () => {
    expect(normalizeInvertMultiplier(0)).toBeUndefined();
  });
});

describe("createIsometricCamera", () => {
  describe("initial state", () => {
    it("uses default values when no overrides given", () => {
      const camera = createIsometricCamera();
      expect(camera.state.zoom).toBe(DEFAULT_CAMERA_STATE.zoom);
      expect(camera.state.pan).toBe(DEFAULT_CAMERA_STATE.pan);
      expect(camera.state.tilt).toBe(DEFAULT_CAMERA_STATE.tilt);
      expect(camera.state.rotX).toBe(DEFAULT_CAMERA_STATE.rotX);
      expect(camera.state.rotY).toBe(DEFAULT_CAMERA_STATE.rotY);
      expect(camera.state.depthOffset).toBe(DEFAULT_CAMERA_STATE.depthOffset);
    });

    it("accepts partial overrides", () => {
      const camera = createIsometricCamera({ zoom: 1.5, rotX: 30 });
      expect(camera.state.zoom).toBe(1.5);
      expect(camera.state.rotX).toBe(30);
      expect(camera.state.pan).toBe(DEFAULT_CAMERA_STATE.pan);
      expect(camera.state.rotY).toBe(DEFAULT_CAMERA_STATE.rotY);
    });

    it("accepts full overrides", () => {
      const camera = createIsometricCamera({
        zoom: 2,
        pan: 10,
        tilt: 20,
        rotX: 30,
        rotY: 90,
        depthOffset: 50,
      });
      expect(camera.state.zoom).toBe(2);
      expect(camera.state.pan).toBe(10);
      expect(camera.state.tilt).toBe(20);
      expect(camera.state.rotX).toBe(30);
      expect(camera.state.rotY).toBe(90);
      expect(camera.state.depthOffset).toBe(50);
    });
  });

  describe("update", () => {
    it("updates a single field", () => {
      const camera = createIsometricCamera();
      camera.update({ zoom: 2.0 });
      expect(camera.state.zoom).toBe(2.0);
      // Other fields unchanged
      expect(camera.state.rotX).toBe(DEFAULT_CAMERA_STATE.rotX);
    });

    it("updates multiple fields at once", () => {
      const camera = createIsometricCamera();
      camera.update({ rotX: 45, rotY: 90, pan: 100 });
      expect(camera.state.rotX).toBe(45);
      expect(camera.state.rotY).toBe(90);
      expect(camera.state.pan).toBe(100);
    });

    it("quantizes values to 2 decimal places", () => {
      const camera = createIsometricCamera();
      camera.update({ zoom: 1.23456 });
      expect(camera.state.zoom).toBe(1.23);
    });

    it("does not change state when called with empty object", () => {
      const camera = createIsometricCamera();
      const before = { ...camera.state };
      camera.update({});
      expect(camera.state).toEqual(before);
    });
  });

  describe("getStyle", () => {
    it("produces a transform string with scale, translateY, translateX, rotateX, rotate", () => {
      const camera = createIsometricCamera();
      const style = camera.getStyle();
      expect(style.transform).toContain("scale(");
      expect(style.transform).toContain("rotateX(");
      expect(style.transform).toContain("rotate(");
      expect(style.transform).toContain("translateY(");
      expect(style.transform).toContain("translateX(");
    });

    it("includes zoom value in scale transform", () => {
      const camera = createIsometricCamera({ zoom: 1.5 });
      const style = camera.getStyle();
      expect(style.transform).toContain("scale(1.5)");
    });

    it("includes rotation values", () => {
      const camera = createIsometricCamera({ rotX: 65, rotY: 45 });
      const style = camera.getStyle();
      expect(style.transform).toContain("rotateX(65deg)");
      expect(style.transform).toContain("rotate(45deg)");
    });

    it("includes pan and tilt in translate transforms", () => {
      const camera = createIsometricCamera({ pan: 50, tilt: 30 });
      const style = camera.getStyle();
      expect(style.transform).toContain("translateX(50px)");
      expect(style.transform).toContain("translateY(30px)");
    });

    it("computes width and height from rows, cols, and tileSize (50px)", () => {
      const camera = createIsometricCamera();
      const style = camera.getStyle({ rows: 10, cols: 8 });
      expect(style.width).toBe("400px"); // 8 * 50
      expect(style.height).toBe("500px"); // 10 * 50
    });

    it("returns 0px dimensions when rows/cols not provided", () => {
      const camera = createIsometricCamera();
      const style = camera.getStyle();
      expect(style.width).toBe("0px");
      expect(style.height).toBe("0px");
    });

    it("computes depth offset from depth and depthOffset state", () => {
      const camera = createIsometricCamera({ depthOffset: 20 });
      const style = camera.getStyle({ depth: 5 });
      // depthOffset = 5 * 20 * 1 = 100
      expect(style.transform).toContain("translateY(100px)");
    });

    it("halves depth offset in dimetric mode", () => {
      const camera = createIsometricCamera({ depthOffset: 20 });
      const style = camera.getStyle({ depth: 5, dimetric: true });
      // depthOffset = 5 * 20 * 0.5 = 50
      expect(style.transform).toContain("translateY(50px)");
    });
  });
});
