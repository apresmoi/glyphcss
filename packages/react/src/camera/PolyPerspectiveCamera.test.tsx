import { describe, it, expect } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { PolyPerspectiveCamera } from "./PolyPerspectiveCamera";

function renderToDiv(element: React.ReactElement): HTMLElement {
  const container = document.createElement("div");
  const root = createRoot(container);
  act(() => root.render(element));
  return container;
}

describe("PolyPerspectiveCamera", () => {
  it("renders with polycss-camera class", () => {
    const container = renderToDiv(
      <PolyPerspectiveCamera>
        <div />
      </PolyPerspectiveCamera>
    );
    expect(container.querySelector(".polycss-camera")).toBeTruthy();
  });

  it("applies default perspective of 8000px", () => {
    const container = renderToDiv(
      <PolyPerspectiveCamera>
        <div />
      </PolyPerspectiveCamera>
    );
    const camera = container.querySelector(".polycss-camera") as HTMLElement;
    expect(camera.style.perspective).toBe("8000px");
  });

  it("applies a custom numeric perspective value", () => {
    const container = renderToDiv(
      <PolyPerspectiveCamera perspective={3000}>
        <div />
      </PolyPerspectiveCamera>
    );
    const camera = container.querySelector(".polycss-camera") as HTMLElement;
    expect(camera.style.perspective).toBe("3000px");
  });

  it("renders children", () => {
    const container = renderToDiv(
      <PolyPerspectiveCamera>
        <span className="child">hi</span>
      </PolyPerspectiveCamera>
    );
    expect(container.querySelector(".child")).toBeTruthy();
  });

  it("appends custom className", () => {
    const container = renderToDiv(
      <PolyPerspectiveCamera className="my-class">
        <div />
      </PolyPerspectiveCamera>
    );
    const camera = container.querySelector(".polycss-camera");
    expect(camera?.classList.contains("my-class")).toBe(true);
  });
});
