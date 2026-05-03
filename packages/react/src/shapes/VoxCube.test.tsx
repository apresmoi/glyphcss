import { describe, it, expect } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import type { GridContext, Voxel } from "@layoutit/voxcss-core";
import { buildSceneContext } from "@layoutit/voxcss-core";
import { VoxCube } from "./VoxCube";

function makeContext(voxels: Voxel[]): GridContext {
  return buildSceneContext({ grid: voxels }).context;
}

function renderToDiv(element: React.ReactElement): HTMLElement {
  const container = document.createElement("div");
  const root = createRoot(container);
  act(() => root.render(element));
  return container;
}

describe("VoxCube", () => {
  it("renders visible faces for an isolated voxel", () => {
    const voxel: Voxel = { x: 0, y: 0, z: 0, color: "#ff0000" };
    const context = makeContext([voxel]);
    const container = renderToDiv(<VoxCube voxel={voxel} context={context} />);

    const cube = container.querySelector(".voxcss-cube");
    expect(cube).toBeTruthy();

    const faces = container.querySelectorAll(".voxcss-cube-face");
    expect(faces.length).toBeGreaterThan(0);
    // Default walls hide b, bl, br — so we expect t, fr, fl
    expect(faces.length).toBe(3);

    const faceClasses = Array.from(faces).map((f) => f.className);
    expect(faceClasses).toContain("voxcss-cube-face voxcss-cube-face--t");
    expect(faceClasses).toContain("voxcss-cube-face voxcss-cube-face--fr");
    expect(faceClasses).toContain("voxcss-cube-face voxcss-cube-face--fl");
  });

  it("renders nothing when all faces are occluded", () => {
    // Surrounded voxel in a 3x3x3 cube
    const voxels: Voxel[] = [];
    for (let x = 0; x < 3; x++)
      for (let y = 0; y < 3; y++)
        for (let z = 0; z < 3; z++) voxels.push({ x, y, z });
    const context = makeContext(voxels);
    const center = voxels.find((v) => v.x === 1 && v.y === 1 && v.z === 1)!;
    const container = renderToDiv(<VoxCube voxel={center} context={context} />);

    const faces = container.querySelectorAll(".voxcss-cube-face");
    expect(faces.length).toBe(0);
  });

  it("applies face colors from voxel.color", () => {
    const voxel: Voxel = { x: 0, y: 0, z: 0, color: "#ff0000" };
    const context = makeContext([voxel]);
    const container = renderToDiv(<VoxCube voxel={voxel} context={context} />);

    const topFace = container.querySelector(".voxcss-cube-face--t") as HTMLElement;
    expect(topFace).toBeTruthy();
    // Top face has 0 delta, so color should be #ff0000
    expect(topFace.style.backgroundColor).toBe("rgb(255, 0, 0)");
  });

  it("sets grid-area for positioning", () => {
    const voxel: Voxel = { x: 2, y: 3, z: 0 };
    const context = makeContext([voxel]);
    const container = renderToDiv(<VoxCube voxel={voxel} context={context} />);

    // The outermost rendered div has the grid-area
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper).toBeTruthy();
    expect(wrapper.style.gridArea).toBe("2 / 3 / 3 / 4");
  });

  it("sets side offset custom properties for area voxels", () => {
    const voxel: Voxel = { x: 0, y: 0, z: 0, x2: 2, y2: 3 };
    const context = makeContext([voxel]);
    const container = renderToDiv(<VoxCube voxel={voxel} context={context} />);

    const cube = container.querySelector(".voxcss-cube") as HTMLElement;
    expect(cube).toBeTruthy();
    expect(cube.style.getPropertyValue("--voxcss-side-offset-x")).toBe("50px"); // 2 * 25
    expect(cube.style.getPropertyValue("--voxcss-side-offset-y")).toBe("75px"); // 3 * 25
    expect(cube.style.getPropertyValue("--voxcss-fr-offset")).toBe("150px"); // 3 * 50
  });

  it("z2 cube renders as a single element (not multiple)", () => {
    const voxel: Voxel = { x: 0, y: 0, z: 0, z2: 3, color: "#336699" };
    const context = makeContext([voxel]);
    const container = renderToDiv(<VoxCube voxel={voxel} context={context} />);

    // Should produce exactly one .voxcss-cube element (not 3 stacked cubes)
    const cubes = container.querySelectorAll(".voxcss-cube");
    expect(cubes.length).toBe(1);
  });

  it("z2 cube applies --voxcss-layer-elevation override when spanZ > 1", () => {
    const voxel: Voxel = { x: 0, y: 0, z: 0, z2: 3, color: "#336699" };
    const context = makeContext([voxel]);
    const container = renderToDiv(<VoxCube voxel={voxel} context={context} />);

    const cube = container.querySelector(".voxcss-cube") as HTMLElement;
    expect(cube).toBeTruthy();
    // spanZ=3, layerElevation=50px → override = 3*50 = 150px
    expect(cube.style.getPropertyValue("--voxcss-layer-elevation")).toBe("150px");
  });

  it("cube without z2 (spanZ=1) does not set --voxcss-layer-elevation", () => {
    const voxel: Voxel = { x: 0, y: 0, z: 0, color: "#336699" };
    const context = makeContext([voxel]);
    const container = renderToDiv(<VoxCube voxel={voxel} context={context} />);

    const cube = container.querySelector(".voxcss-cube") as HTMLElement;
    expect(cube).toBeTruthy();
    expect(cube.style.getPropertyValue("--voxcss-layer-elevation")).toBe("");
  });
});
