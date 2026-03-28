import { describe, it, expect } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import type { GridContext, Voxel } from "@layoutit/voxcss-core";
import { buildSceneContext } from "@layoutit/voxcss-core";
import { VoxShape } from "./VoxShape";

function makeContext(voxels: Voxel[]): GridContext {
  return buildSceneContext({ grid: voxels }).context;
}

function renderToDiv(element: React.ReactElement): HTMLElement {
  const container = document.createElement("div");
  const root = createRoot(container);
  act(() => root.render(element));
  return container;
}

describe("VoxShape", () => {
  it("renders a ramp shape", () => {
    const voxel: Voxel = { x: 0, y: 0, z: 0, shape: "ramp", color: "#ff0000" };
    const context = makeContext([voxel]);
    const container = renderToDiv(<VoxShape voxel={voxel} context={context} />);

    const ramp = container.querySelector(".voxcss-ramp");
    expect(ramp).toBeTruthy();

    const slope = container.querySelector(".voxcss-ramp-slope");
    expect(slope).toBeTruthy();
  });

  it("renders a wedge shape with SVG slopes", () => {
    const voxel: Voxel = { x: 0, y: 0, z: 0, shape: "wedge", color: "#00ff00" };
    const context = makeContext([voxel]);
    const container = renderToDiv(<VoxShape voxel={voxel} context={context} />);

    const wedge = container.querySelector(".voxcss-wedge");
    expect(wedge).toBeTruthy();

    const svgs = container.querySelectorAll("svg");
    expect(svgs.length).toBe(2); // primary + secondary slopes

    const paths = container.querySelectorAll("path");
    expect(paths.length).toBe(2);
  });

  it("renders a spike shape with SVG slopes", () => {
    const voxel: Voxel = { x: 0, y: 0, z: 0, shape: "spike", color: "#0000ff" };
    const context = makeContext([voxel]);
    const container = renderToDiv(<VoxShape voxel={voxel} context={context} />);

    const spike = container.querySelector(".voxcss-spike");
    expect(spike).toBeTruthy();

    const svgs = container.querySelectorAll("svg");
    expect(svgs.length).toBe(2);
  });

  it("applies orientation class based on rotation", () => {
    const voxel: Voxel = { x: 0, y: 0, z: 0, shape: "ramp", rot: 90 };
    const context = makeContext([voxel]);
    const container = renderToDiv(<VoxShape voxel={voxel} context={context} />);

    const inner = container.querySelector(".voxcss-ramp");
    expect(inner?.classList.contains("voxcss-south")).toBe(true);
  });

  it("returns null for cube shapes", () => {
    const voxel: Voxel = { x: 0, y: 0, z: 0, shape: "cube" };
    const context = makeContext([voxel]);
    const container = renderToDiv(<VoxShape voxel={voxel} context={context} />);

    expect(container.innerHTML).toBe("");
  });

  it("hides shape when covered by voxel above", () => {
    const ramp: Voxel = { x: 0, y: 0, z: 0, shape: "ramp", color: "#ff0000" };
    const above: Voxel = { x: 0, y: 0, z: 1, color: "#00ff00" };
    const context = makeContext([ramp, above]);
    const container = renderToDiv(<VoxShape voxel={ramp} context={context} />);

    // Shape should not render when covered
    const rampEl = container.querySelector(".voxcss-ramp");
    expect(rampEl).toBeNull();
  });

  it("renders bottom face when not occluded and walls.b is hidden", () => {
    // Default walls have b: true (hidden), so bottom should not render
    const voxel: Voxel = { x: 0, y: 0, z: 0, shape: "ramp", color: "#ff0000" };
    const context = makeContext([voxel]);
    const container = renderToDiv(<VoxShape voxel={voxel} context={context} />);

    const bottom = container.querySelector(".voxcss-ramp-bottom");
    // Default walls.b = true means bottom is back-face culled
    expect(bottom).toBeNull();
  });
});
