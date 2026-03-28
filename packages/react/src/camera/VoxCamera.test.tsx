import { describe, it, expect } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { VoxCamera } from "./VoxCamera";

function renderToDiv(element: React.ReactElement): HTMLElement {
  const container = document.createElement("div");
  const root = createRoot(container);
  act(() => root.render(element));
  return container;
}

describe("VoxCamera", () => {
  it("renders with voxcss-camera class", () => {
    const container = renderToDiv(
      <VoxCamera>
        <div data-testid="child">content</div>
      </VoxCamera>
    );

    const camera = container.querySelector(".voxcss-camera");
    expect(camera).toBeTruthy();
  });

  it("renders children", () => {
    const container = renderToDiv(
      <VoxCamera>
        <div className="test-child">hello</div>
      </VoxCamera>
    );

    const child = container.querySelector(".test-child");
    expect(child).toBeTruthy();
    expect(child?.textContent).toBe("hello");
  });

  it("applies custom perspective", () => {
    const container = renderToDiv(
      <VoxCamera perspective={5000}>
        <div />
      </VoxCamera>
    );

    const camera = container.querySelector(".voxcss-camera") as HTMLElement;
    expect(camera.style.perspective).toBe("5000px");
  });

  it("applies perspective none when false", () => {
    const container = renderToDiv(
      <VoxCamera perspective={false}>
        <div />
      </VoxCamera>
    );

    const camera = container.querySelector(".voxcss-camera") as HTMLElement;
    expect(camera.style.perspective).toBe("none");
  });

  it("sets interactive cursor", () => {
    const container = renderToDiv(
      <VoxCamera interactive>
        <div />
      </VoxCamera>
    );

    const camera = container.querySelector(".voxcss-camera") as HTMLElement;
    expect(camera.style.cursor).toBe("grab");
  });

  it("applies custom className", () => {
    const container = renderToDiv(
      <VoxCamera className="my-scene">
        <div />
      </VoxCamera>
    );

    const camera = container.querySelector(".voxcss-camera");
    expect(camera?.classList.contains("my-scene")).toBe(true);
  });

  it("applies touch-action none when interactive", () => {
    const container = renderToDiv(
      <VoxCamera interactive>
        <div />
      </VoxCamera>
    );

    const camera = container.querySelector(".voxcss-camera") as HTMLElement;
    expect(camera.style.touchAction).toBe("none");
  });
});
