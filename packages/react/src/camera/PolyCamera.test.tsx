import { describe, it, expect } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { PolyCamera } from "./PolyCamera";

function renderToDiv(element: React.ReactElement): HTMLElement {
  const container = document.createElement("div");
  const root = createRoot(container);
  act(() => root.render(element));
  return container;
}

// PolyCamera is an alias for PolyPerspectiveCamera — these tests confirm
// the alias renders identically.
describe("PolyCamera (alias for PolyPerspectiveCamera)", () => {
  it("renders with polycss-camera class", () => {
    const container = renderToDiv(
      <PolyCamera>
        <div data-testid="child">content</div>
      </PolyCamera>
    );

    const camera = container.querySelector(".polycss-camera");
    expect(camera).toBeTruthy();
  });

  it("renders children", () => {
    const container = renderToDiv(
      <PolyCamera>
        <div className="test-child">hello</div>
      </PolyCamera>
    );

    const child = container.querySelector(".test-child");
    expect(child).toBeTruthy();
    expect(child?.textContent).toBe("hello");
  });

  it("applies custom perspective", () => {
    const container = renderToDiv(
      <PolyCamera perspective={5000}>
        <div />
      </PolyCamera>
    );

    const camera = container.querySelector(".polycss-camera") as HTMLElement;
    expect(camera.style.perspective).toBe("5000px");
  });

  it("applies default perspective of 8000px", () => {
    const container = renderToDiv(
      <PolyCamera>
        <div />
      </PolyCamera>
    );

    const camera = container.querySelector(".polycss-camera") as HTMLElement;
    expect(camera.style.perspective).toBe("8000px");
  });

  it("applies custom className", () => {
    const container = renderToDiv(
      <PolyCamera className="my-scene">
        <div />
      </PolyCamera>
    );

    const camera = container.querySelector(".polycss-camera");
    expect(camera?.classList.contains("my-scene")).toBe(true);
  });
});
