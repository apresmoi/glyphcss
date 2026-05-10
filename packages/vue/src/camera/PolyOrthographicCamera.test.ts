import { describe, it, expect } from "vitest";
import { createApp, h } from "vue";
import type { VNodeChild } from "vue";
import { PolyOrthographicCamera } from "./PolyOrthographicCamera";

function renderCamera(
  cameraProps: Record<string, unknown> = {},
  children?: VNodeChild
): HTMLElement {
  const container = document.createElement("div");
  const app = createApp({
    setup() {
      return () =>
        h(PolyOrthographicCamera, cameraProps, {
          default: () => children ?? h("div"),
        });
    },
  });
  app.mount(container);
  return container;
}

describe("PolyOrthographicCamera (Vue)", () => {
  it("renders with polycss-camera class", () => {
    const container = renderCamera();
    expect(container.querySelector(".polycss-camera")).toBeTruthy();
  });

  it("sets perspective to none", () => {
    const container = renderCamera();
    const camera = container.querySelector(".polycss-camera") as HTMLElement;
    expect(camera.style.perspective).toBe("none");
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
