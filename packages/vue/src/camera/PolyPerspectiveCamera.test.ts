import { describe, it, expect } from "vitest";
import { createApp, h } from "vue";
import type { VNodeChild } from "vue";
import { PolyPerspectiveCamera } from "./PolyPerspectiveCamera";

function renderCamera(
  cameraProps: Record<string, unknown> = {},
  children?: VNodeChild
): HTMLElement {
  const container = document.createElement("div");
  const app = createApp({
    setup() {
      return () =>
        h(PolyPerspectiveCamera, cameraProps, {
          default: () => children ?? h("div"),
        });
    },
  });
  app.mount(container);
  return container;
}

describe("PolyPerspectiveCamera (Vue)", () => {
  it("renders with polycss-camera class", () => {
    const container = renderCamera();
    expect(container.querySelector(".polycss-camera")).toBeTruthy();
  });

  it("applies default perspective of 8000px", () => {
    const container = renderCamera();
    const camera = container.querySelector(".polycss-camera") as HTMLElement;
    expect(camera.style.perspective).toBe("8000px");
  });

  it("applies a custom numeric perspective value", () => {
    const container = renderCamera({ perspective: 3000 });
    const camera = container.querySelector(".polycss-camera") as HTMLElement;
    expect(camera.style.perspective).toBe("3000px");
  });

  it("renders children", () => {
    const container = renderCamera({}, h("span", { class: "child" }, "hi"));
    expect(container.querySelector(".child")).toBeTruthy();
  });

  it("appends custom class", () => {
    const container = renderCamera({ class: "my-class" });
    const camera = container.querySelector(".polycss-camera");
    expect(camera?.classList.contains("my-class")).toBe(true);
    expect(camera?.classList.contains("polycss-camera")).toBe(true);
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
