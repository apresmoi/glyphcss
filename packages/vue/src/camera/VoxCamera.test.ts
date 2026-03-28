import { describe, it, expect } from "vitest";
import { createApp, h } from "vue";
import { VoxCamera } from "./VoxCamera";

function renderToDiv(cameraProps: Record<string, any> = {}, children?: any[]): HTMLElement {
  const container = document.createElement("div");
  const app = createApp({
    setup() {
      return () => h(VoxCamera, cameraProps, {
        default: () => children ?? [h("div")],
      });
    },
  });
  app.mount(container);
  return container;
}

describe("VoxCamera behavior", () => {
  describe("renders camera wrapper", () => {
    it("has the voxcss-camera class", () => {
      const container = renderToDiv();
      expect(container.querySelector(".voxcss-camera")).toBeTruthy();
    });
  });

  describe("perspective", () => {
    it("applies default perspective of 8000px when perspective is not set", () => {
      const container = renderToDiv({});
      const camera = container.querySelector(".voxcss-camera") as HTMLElement;
      expect(camera.style.perspective).toBe("8000px");
    });

    it("applies a custom numeric perspective value", () => {
      const container = renderToDiv({ perspective: 3000 });
      const camera = container.querySelector(".voxcss-camera") as HTMLElement;
      expect(camera.style.perspective).toBe("3000px");
    });

    it("sets perspective to none when false", () => {
      const container = renderToDiv({ perspective: false });
      const camera = container.querySelector(".voxcss-camera") as HTMLElement;
      expect(camera.style.perspective).toBe("none");
    });
  });

  describe("interactive mode", () => {
    it("sets cursor to grab when interactive", () => {
      const container = renderToDiv({ interactive: true });
      const camera = container.querySelector(".voxcss-camera") as HTMLElement;
      expect(camera.style.cursor).toBe("grab");
    });

    it("sets touch-action to none when interactive", () => {
      const container = renderToDiv({ interactive: true });
      const camera = container.querySelector(".voxcss-camera") as HTMLElement;
      expect(camera.style.touchAction).toBe("none");
    });

    it("does not set cursor or touch-action when not interactive", () => {
      const container = renderToDiv();
      const camera = container.querySelector(".voxcss-camera") as HTMLElement;
      expect(camera.style.cursor).toBe("");
      expect(camera.style.touchAction).toBe("");
    });
  });

  describe("children", () => {
    it("renders children inside the camera wrapper", () => {
      const container = renderToDiv({}, [h("span", { class: "inner-child" }, "Hello")]);
      const child = container.querySelector(".voxcss-camera .inner-child");
      expect(child).toBeTruthy();
      expect(child?.textContent).toBe("Hello");
    });

    it("renders multiple children", () => {
      const container = renderToDiv({}, [
        h("div", { class: "a" }),
        h("div", { class: "b" }),
      ]);
      expect(container.querySelector(".a")).toBeTruthy();
      expect(container.querySelector(".b")).toBeTruthy();
    });
  });

  describe("custom className", () => {
    it("appends custom className alongside voxcss-camera", () => {
      const container = renderToDiv({ class: "my-custom-class" });
      const camera = container.querySelector(".voxcss-camera");
      expect(camera?.classList.contains("my-custom-class")).toBe(true);
      expect(camera?.classList.contains("voxcss-camera")).toBe(true);
    });
  });
});
