import { describe, it, expect } from "vitest";
import {
  createIsometricCamera,
  normalizeInvertMultiplier,
  DEFAULT_CAMERA_STATE,
} from "./camera";

describe("DEFAULT_CAMERA_STATE", () => {
  it("has expected default values", () => {
    expect(DEFAULT_CAMERA_STATE.zoom).toBe(0.65);
    expect(DEFAULT_CAMERA_STATE.target).toEqual([0, 0, 0]);
    expect(DEFAULT_CAMERA_STATE.rotX).toBe(65);
    expect(DEFAULT_CAMERA_STATE.rotY).toBe(45);
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
      expect(camera.state.target).toEqual([0, 0, 0]);
      expect(camera.state.rotX).toBe(DEFAULT_CAMERA_STATE.rotX);
      expect(camera.state.rotY).toBe(DEFAULT_CAMERA_STATE.rotY);
    });

    it("accepts partial overrides", () => {
      const camera = createIsometricCamera({ zoom: 1.5, rotX: 30 });
      expect(camera.state.zoom).toBe(1.5);
      expect(camera.state.rotX).toBe(30);
      expect(camera.state.target).toEqual([0, 0, 0]);
      expect(camera.state.rotY).toBe(DEFAULT_CAMERA_STATE.rotY);
    });

    it("accepts target override", () => {
      const camera = createIsometricCamera({ target: [1, 2, 3] });
      expect(camera.state.target).toEqual([1, 2, 3]);
    });

    it("accepts full overrides", () => {
      const camera = createIsometricCamera({
        zoom: 2,
        target: [10, 20, 5],
        rotX: 30,
        rotY: 90,
      });
      expect(camera.state.zoom).toBe(2);
      expect(camera.state.target).toEqual([10, 20, 5]);
      expect(camera.state.rotX).toBe(30);
      expect(camera.state.rotY).toBe(90);
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
      camera.update({ rotX: 45, rotY: 90, target: [5, 3, 0] });
      expect(camera.state.rotX).toBe(45);
      expect(camera.state.rotY).toBe(90);
      expect(camera.state.target).toEqual([5, 3, 0]);
    });

    it("updates target", () => {
      const camera = createIsometricCamera();
      camera.update({ target: [1, 2, 0] });
      expect(camera.state.target).toEqual([1, 2, 0]);
    });

    it("quantizes values to 4 decimal places", () => {
      const camera = createIsometricCamera();
      camera.update({ zoom: 1.23456 });
      expect(camera.state.zoom).toBe(1.2346);
    });

    it("quantizes target components", () => {
      const camera = createIsometricCamera();
      camera.update({ target: [1.23456, 2.56789, 0.11111] });
      expect(camera.state.target).toEqual([1.23, 2.57, 0.11]);
    });

    it("does not change state when called with empty object", () => {
      const camera = createIsometricCamera();
      const beforeTarget = [...camera.state.target];
      const beforeRotX = camera.state.rotX;
      camera.update({});
      expect(camera.state.target).toEqual(beforeTarget);
      expect(camera.state.rotX).toBe(beforeRotX);
    });

    it("initializes distance to 0 by default", () => {
      const camera = createIsometricCamera();
      expect(camera.state.distance).toBe(0);
    });

    it("accepts initial distance", () => {
      const camera = createIsometricCamera({ distance: 500 });
      expect(camera.state.distance).toBe(500);
    });

    it("updates distance", () => {
      const camera = createIsometricCamera();
      camera.update({ distance: 300 });
      expect(camera.state.distance).toBe(300);
    });

    it("quantizes distance to 2 decimal places", () => {
      const camera = createIsometricCamera();
      camera.update({ distance: 123.456789 });
      expect(camera.state.distance).toBe(123.46);
    });
  });

  describe("getStyle", () => {
    it("produces a transform string with scale, rotateX, rotate, translate3d", () => {
      const camera = createIsometricCamera();
      const style = camera.getStyle();
      expect(style.transform).toContain("scale(");
      expect(style.transform).toContain("rotateX(");
      expect(style.transform).toContain("rotate(");
      expect(style.transform).toContain("translate3d(");
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

    it("translate3d is zero when target is [0,0,0]", () => {
      const camera = createIsometricCamera({ target: [0, 0, 0] });
      const style = camera.getStyle();
      expect(style.transform).toContain("translate3d(0px, 0px, 0px)");
    });

    it("translate3d reflects target in CSS coords (world[1]→CSS X, world[0]→CSS Y, world[2]→CSS Z)", () => {
      // world target [2, 3, 1]: cssX = 3*50=150, cssY = 2*50=100, cssZ = 1*50=50
      const camera = createIsometricCamera({ target: [2, 3, 1] });
      const style = camera.getStyle();
      expect(style.transform).toContain("translate3d(-150px, -100px, -50px)");
    });

    it("translate3d order: scale → rotateX → rotate → translate3d", () => {
      const camera = createIsometricCamera();
      const style = camera.getStyle();
      const scaleIdx = style.transform.indexOf("scale(");
      const rotateXIdx = style.transform.indexOf("rotateX(");
      const rotateIdx = style.transform.indexOf("rotate(", rotateXIdx + 1);
      const translateIdx = style.transform.indexOf("translate3d(");
      expect(scaleIdx).toBeLessThan(rotateXIdx);
      expect(rotateXIdx).toBeLessThan(rotateIdx);
      expect(rotateIdx).toBeLessThan(translateIdx);
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

    it("does not include translateZ when distance is 0", () => {
      const camera = createIsometricCamera({ distance: 0 });
      const style = camera.getStyle();
      expect(style.transform).not.toContain("translateZ(");
    });

    it("prepends translateZ when distance is non-zero", () => {
      const camera = createIsometricCamera({ distance: 200 });
      const style = camera.getStyle();
      expect(style.transform).toContain("translateZ(-200px)");
    });

    it("translateZ is outermost (before scale) when distance is set", () => {
      const camera = createIsometricCamera({ distance: 100 });
      const style = camera.getStyle();
      const translateZIdx = style.transform.indexOf("translateZ(");
      const scaleIdx = style.transform.indexOf("scale(");
      expect(translateZIdx).toBeLessThan(scaleIdx);
    });
  });
});
