/**
 * Tests for createPolyPerspectiveCamera and createPolyOrthographicCamera.
 *
 * Covers: default state, initial options, perspective style, update() method,
 * and getStyle() transform output.
 */
import { describe, expect, it } from "vitest";
import {
  createPolyPerspectiveCamera,
  createPolyOrthographicCamera,
} from "./createPolyCamera";

describe("createPolyPerspectiveCamera", () => {
  it("has type 'perspective'", () => {
    const cam = createPolyPerspectiveCamera();
    expect(cam.type).toBe("perspective");
  });

  it("returns default perspectiveStyle of '8000px'", () => {
    const cam = createPolyPerspectiveCamera();
    expect(cam.perspectiveStyle).toBe("8000px");
  });

  it("accepts a custom perspective value", () => {
    const cam = createPolyPerspectiveCamera({ perspective: 600 });
    expect(cam.perspectiveStyle).toBe("600px");
  });

  it("initializes with default camera state", () => {
    const cam = createPolyPerspectiveCamera();
    expect(cam.state.rotX).toBe(65);
    expect(cam.state.rotY).toBe(45);
    expect(cam.state.zoom).toBeCloseTo(0.65, 4);
    expect(cam.state.distance).toBe(0);
    expect(cam.state.target).toEqual([0, 0, 0]);
  });

  it("initializes with provided options", () => {
    const cam = createPolyPerspectiveCamera({ zoom: 2, rotX: 30, rotY: 90 });
    expect(cam.state.zoom).toBe(2);
    expect(cam.state.rotX).toBe(30);
    expect(cam.state.rotY).toBe(90);
  });

  it("update() mutates state", () => {
    const cam = createPolyPerspectiveCamera({ zoom: 1 });
    cam.update({ zoom: 2, rotY: 90 });
    expect(cam.state.zoom).toBe(2);
    expect(cam.state.rotY).toBe(90);
  });

  it("getStyle() returns a transform string", () => {
    const cam = createPolyPerspectiveCamera({ zoom: 1, rotX: 0, rotY: 0 });
    const style = cam.getStyle();
    expect(typeof style.transform).toBe("string");
    expect(style.transform).toContain("scale(1)");
  });

  it("state is live — read after update reflects new value", () => {
    const cam = createPolyPerspectiveCamera();
    const before = cam.state.rotY;
    cam.update({ rotY: before + 10 });
    expect(cam.state.rotY).toBeCloseTo(before + 10, 4);
  });
});

describe("createPolyOrthographicCamera", () => {
  it("has type 'orthographic'", () => {
    const cam = createPolyOrthographicCamera();
    expect(cam.type).toBe("orthographic");
  });

  it("returns perspectiveStyle 'none'", () => {
    const cam = createPolyOrthographicCamera();
    expect(cam.perspectiveStyle).toBe("none");
  });

  it("initializes with default camera state", () => {
    const cam = createPolyOrthographicCamera();
    expect(cam.state.rotX).toBe(65);
    expect(cam.state.rotY).toBe(45);
    expect(cam.state.zoom).toBeCloseTo(0.65, 4);
    expect(cam.state.distance).toBe(0);
  });

  it("initializes with provided options", () => {
    const cam = createPolyOrthographicCamera({ zoom: 3, rotX: 10 });
    expect(cam.state.zoom).toBe(3);
    expect(cam.state.rotX).toBe(10);
  });

  it("update() mutates state", () => {
    const cam = createPolyOrthographicCamera();
    cam.update({ zoom: 4 });
    expect(cam.state.zoom).toBe(4);
  });

  it("getStyle() returns a transform string without perspective", () => {
    const cam = createPolyOrthographicCamera({ zoom: 1, rotX: 0, rotY: 0 });
    const style = cam.getStyle();
    expect(typeof style.transform).toBe("string");
    expect(style.transform).toContain("scale(1)");
  });
});
