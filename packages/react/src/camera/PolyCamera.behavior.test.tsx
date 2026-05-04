import { describe, it, expect } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { PolyCamera as VoxCamera } from "./PolyCamera";

function renderToDiv(element: React.ReactElement): HTMLElement {
  const container = document.createElement("div");
  const root = createRoot(container);
  act(() => root.render(element));
  return container;
}

describe("PolyCamera behavior", () => {
  describe("renders camera wrapper", () => {
    it("has the polycss-camera class", () => {
      const container = renderToDiv(
        <VoxCamera>
          <div />
        </VoxCamera>
      );
      expect(container.querySelector(".polycss-camera")).toBeTruthy();
    });
  });

  describe("perspective", () => {
    it("applies default perspective of 8000px when no perspective prop given", () => {
      const container = renderToDiv(
        <VoxCamera>
          <div />
        </VoxCamera>
      );
      const camera = container.querySelector(".polycss-camera") as HTMLElement;
      expect(camera.style.perspective).toBe("8000px");
    });

    it("applies a custom numeric perspective value", () => {
      const container = renderToDiv(
        <VoxCamera perspective={3000}>
          <div />
        </VoxCamera>
      );
      const camera = container.querySelector(".polycss-camera") as HTMLElement;
      expect(camera.style.perspective).toBe("3000px");
    });

    it("sets perspective to none when false", () => {
      const container = renderToDiv(
        <VoxCamera perspective={false}>
          <div />
        </VoxCamera>
      );
      const camera = container.querySelector(".polycss-camera") as HTMLElement;
      expect(camera.style.perspective).toBe("none");
    });
  });

  describe("interactive mode", () => {
    it("sets cursor to grab when interactive", () => {
      const container = renderToDiv(
        <VoxCamera interactive>
          <div />
        </VoxCamera>
      );
      const camera = container.querySelector(".polycss-camera") as HTMLElement;
      expect(camera.style.cursor).toBe("grab");
    });

    it("sets touch-action to none when interactive", () => {
      const container = renderToDiv(
        <VoxCamera interactive>
          <div />
        </VoxCamera>
      );
      const camera = container.querySelector(".polycss-camera") as HTMLElement;
      expect(camera.style.touchAction).toBe("none");
    });

    it("does not set cursor or touch-action when not interactive", () => {
      const container = renderToDiv(
        <VoxCamera>
          <div />
        </VoxCamera>
      );
      const camera = container.querySelector(".polycss-camera") as HTMLElement;
      expect(camera.style.cursor).toBe("");
      expect(camera.style.touchAction).toBe("");
    });
  });

  describe("children", () => {
    it("renders children inside the camera wrapper", () => {
      const container = renderToDiv(
        <VoxCamera>
          <span className="inner-child">Hello</span>
        </VoxCamera>
      );
      const child = container.querySelector(".polycss-camera .inner-child");
      expect(child).toBeTruthy();
      expect(child?.textContent).toBe("Hello");
    });

    it("renders multiple children", () => {
      const container = renderToDiv(
        <VoxCamera>
          <div className="a" />
          <div className="b" />
        </VoxCamera>
      );
      expect(container.querySelector(".a")).toBeTruthy();
      expect(container.querySelector(".b")).toBeTruthy();
    });
  });

  describe("custom className", () => {
    it("appends custom className alongside polycss-camera", () => {
      const container = renderToDiv(
        <VoxCamera className="my-custom-class">
          <div />
        </VoxCamera>
      );
      const camera = container.querySelector(".polycss-camera");
      expect(camera?.classList.contains("my-custom-class")).toBe(true);
      expect(camera?.classList.contains("polycss-camera")).toBe(true);
    });
  });
});
