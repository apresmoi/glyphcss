/**
 * PolyCamera (Vue) — feature tests for the camera wrapper component.
 * Mirrors the deleted voxcss VoxCamera.test.ts pattern + the React
 * PolyCamera.behavior.test.tsx style.
 */
import { describe, it, expect } from "vitest";
import { createApp, h } from "vue";
import type { VNodeChild } from "vue";
import { PolyCamera } from "./PolyCamera";

function renderCamera(
  cameraProps: Record<string, unknown> = {},
  children?: VNodeChild
): HTMLElement {
  const container = document.createElement("div");
  const app = createApp({
    setup() {
      return () =>
        h(PolyCamera, cameraProps, {
          default: () => children ?? h("div"),
        });
    },
  });
  app.mount(container);
  return container;
}

describe("PolyCamera (Vue)", () => {
  describe("renders camera wrapper", () => {
    it("has the polycss-camera class", () => {
      const container = renderCamera();
      expect(container.querySelector(".polycss-camera")).toBeTruthy();
    });
  });

  describe("perspective", () => {
    it("applies default perspective of 8000px when perspective is not set", () => {
      const container = renderCamera();
      const camera = container.querySelector(".polycss-camera") as HTMLElement;
      expect(camera.style.perspective).toBe("8000px");
    });

    it("applies a custom numeric perspective value", () => {
      const container = renderCamera({ perspective: 3000 });
      const camera = container.querySelector(".polycss-camera") as HTMLElement;
      expect(camera.style.perspective).toBe("3000px");
    });

  });

  describe("children", () => {
    it("renders children inside the camera wrapper", () => {
      const container = renderCamera({}, h("span", { class: "inner-child" }, "Hello"));
      const child = container.querySelector(".polycss-camera .inner-child");
      expect(child).toBeTruthy();
      expect(child?.textContent).toBe("Hello");
    });

    it("renders multiple children", () => {
      const container = renderCamera({}, [
        h("div", { class: "a" }),
        h("div", { class: "b" }),
      ]);
      expect(container.querySelector(".a")).toBeTruthy();
      expect(container.querySelector(".b")).toBeTruthy();
    });
  });

  describe("custom class", () => {
    it("appends custom class alongside polycss-camera", () => {
      const container = renderCamera({ class: "my-custom-class" });
      const camera = container.querySelector(".polycss-camera");
      expect(camera?.classList.contains("my-custom-class")).toBe(true);
      expect(camera?.classList.contains("polycss-camera")).toBe(true);
    });
  });
});
