import { describe, it, expect } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import type { Voxel } from "@layoutit/voxcss-core";
import { VoxCamera } from "../camera/VoxCamera";
import { VoxScene } from "./VoxScene";

function renderToDiv(element: React.ReactElement): HTMLElement {
  const container = document.createElement("div");
  const root = createRoot(container);
  act(() => root.render(element));
  return container;
}

describe("VoxScene", () => {
  it("renders layers for each z-level", () => {
    const voxels: Voxel[] = [
      { x: 0, y: 0, z: 0, color: "#ff0000" },
      { x: 0, y: 0, z: 1, color: "#00ff00" },
      { x: 0, y: 0, z: 2, color: "#0000ff" },
    ];
    const container = renderToDiv(
      <VoxCamera>
        <VoxScene voxels={voxels} />
      </VoxCamera>
    );

    const layers = container.querySelectorAll(".voxcss-layer");
    expect(layers.length).toBe(3);
  });

  it("renders floor when showFloor is true", () => {
    const voxels: Voxel[] = [{ x: 0, y: 0, z: 0 }];
    const container = renderToDiv(
      <VoxCamera>
        <VoxScene voxels={voxels} showFloor />
      </VoxCamera>
    );

    const floor = container.querySelector(".voxcss-floor-z");
    expect(floor).toBeTruthy();
  });

  it("hides floor background when showFloor is false", () => {
    const voxels: Voxel[] = [{ x: 0, y: 0, z: 0 }];
    const container = renderToDiv(
      <VoxCamera>
        <VoxScene voxels={voxels} showFloor={false} />
      </VoxCamera>
    );

    const floor = container.querySelector(".voxcss-floor-z") as HTMLElement;
    expect(floor).toBeTruthy();
    expect(floor.style.background).toContain("none");
  });

  it("renders walls when showWalls is true", () => {
    const voxels: Voxel[] = [{ x: 0, y: 0, z: 0 }];
    const container = renderToDiv(
      <VoxCamera>
        <VoxScene voxels={voxels} showWalls />
      </VoxCamera>
    );

    const walls = container.querySelectorAll(".voxcss-wall");
    // Default walls mask: bl=true, br=true → 2 visible walls
    expect(walls.length).toBeGreaterThan(0);
  });

  it("applies dimetric projection class", () => {
    const voxels: Voxel[] = [{ x: 0, y: 0, z: 0 }];
    const container = renderToDiv(
      <VoxCamera>
        <VoxScene voxels={voxels} projection="dimetric" />
      </VoxCamera>
    );

    const scene = container.querySelector(".voxcss-scene");
    expect(scene?.classList.contains("voxcss-projection--dimetric")).toBe(true);
  });

  it("sets CSS custom properties for grid dimensions", () => {
    const voxels: Voxel[] = [
      { x: 0, y: 0, z: 0 },
      { x: 3, y: 4, z: 0 },
    ];
    const container = renderToDiv(
      <VoxCamera>
        <VoxScene voxels={voxels} />
      </VoxCamera>
    );

    const scene = container.querySelector(".voxcss-scene") as HTMLElement;
    expect(scene).toBeTruthy();
    // Dimensions inferred from voxels: rows = 4, cols = 5
    expect(scene.style.getPropertyValue("--voxcss-rows")).toBe("4");
    expect(scene.style.getPropertyValue("--voxcss-cols")).toBe("5");
  });

  it("renders cube voxels inside layers", () => {
    const voxels: Voxel[] = [
      { x: 0, y: 0, z: 0, color: "#ff0000" },
      { x: 1, y: 0, z: 0, color: "#00ff00" },
    ];
    const container = renderToDiv(
      <VoxCamera>
        <VoxScene voxels={voxels} />
      </VoxCamera>
    );

    const cubes = container.querySelectorAll(".voxcss-cube");
    expect(cubes.length).toBe(2);
  });
});
