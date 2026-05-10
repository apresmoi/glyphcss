import { describe, it, expect } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { PolyOrthographicCamera } from "./PolyOrthographicCamera";

function renderToDiv(element: React.ReactElement): HTMLElement {
  const container = document.createElement("div");
  const root = createRoot(container);
  act(() => root.render(element));
  return container;
}

describe("PolyOrthographicCamera", () => {
  it("renders with polycss-camera class", () => {
    const container = renderToDiv(
      <PolyOrthographicCamera>
        <div />
      </PolyOrthographicCamera>
    );
    expect(container.querySelector(".polycss-camera")).toBeTruthy();
  });

  it("sets perspective to none", () => {
    const container = renderToDiv(
      <PolyOrthographicCamera>
        <div />
      </PolyOrthographicCamera>
    );
    const camera = container.querySelector(".polycss-camera") as HTMLElement;
    expect(camera.style.perspective).toBe("none");
  });

  it("renders children", () => {
    const container = renderToDiv(
      <PolyOrthographicCamera>
        <span className="child">hi</span>
      </PolyOrthographicCamera>
    );
    expect(container.querySelector(".child")).toBeTruthy();
  });

  it("appends custom className", () => {
    const container = renderToDiv(
      <PolyOrthographicCamera className="my-class">
        <div />
      </PolyOrthographicCamera>
    );
    const camera = container.querySelector(".polycss-camera");
    expect(camera?.classList.contains("my-class")).toBe(true);
  });

  it("renders multiple children", () => {
    const container = renderToDiv(
      <PolyOrthographicCamera>
        <div className="a" />
        <div className="b" />
      </PolyOrthographicCamera>
    );
    expect(container.querySelector(".a")).toBeTruthy();
    expect(container.querySelector(".b")).toBeTruthy();
  });
});
