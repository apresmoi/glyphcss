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

  it("applies orientation class based on rotation (wedge: rot=90 → south)", () => {
    // Wedges use the standard rotation→orientation mapping.
    const voxel: Voxel = { x: 0, y: 0, z: 0, shape: "wedge", rot: 90 };
    const context = makeContext([voxel]);
    const container = renderToDiv(<VoxShape voxel={voxel} context={context} />);

    const inner = container.querySelector(".voxcss-wedge");
    expect(inner?.classList.contains("voxcss-south")).toBe(true);
  });

  it("ramps remap orientation: rot=90 → east + voxcss-ramp-x (axis swap)", () => {
    // Ramps with rot=90/270 use internal X-ramp class with remapped orientation
    // so the parent rotation only encodes drop direction (forward = 0° / reverse = 180°).
    const voxel: Voxel = { x: 0, y: 0, z: 0, shape: "ramp", rot: 90 };
    const context = makeContext([voxel]);
    const container = renderToDiv(<VoxShape voxel={voxel} context={context} />);

    const inner = container.querySelector(".voxcss-ramp");
    expect(inner?.classList.contains("voxcss-east")).toBe(true);
    expect(inner?.classList.contains("voxcss-ramp-x")).toBe(true);
  });

  it("ramps remap orientation: rot=270 → west + voxcss-ramp-x", () => {
    const voxel: Voxel = { x: 0, y: 0, z: 0, shape: "ramp", rot: 270 };
    const context = makeContext([voxel]);
    const container = renderToDiv(<VoxShape voxel={voxel} context={context} />);

    const inner = container.querySelector(".voxcss-ramp");
    expect(inner?.classList.contains("voxcss-west")).toBe(true);
    expect(inner?.classList.contains("voxcss-ramp-x")).toBe(true);
  });

  it("ramps with rot=0/180 keep their orientation + voxcss-ramp-y", () => {
    const v0: Voxel = { x: 0, y: 0, z: 0, shape: "ramp", rot: 0 };
    const ctx0 = makeContext([v0]);
    const c0 = renderToDiv(<VoxShape voxel={v0} context={ctx0} />);
    const inner0 = c0.querySelector(".voxcss-ramp");
    expect(inner0?.classList.contains("voxcss-east")).toBe(true);
    expect(inner0?.classList.contains("voxcss-ramp-y")).toBe(true);

    const v180: Voxel = { x: 0, y: 0, z: 0, shape: "ramp", rot: 180 };
    const ctx180 = makeContext([v180]);
    const c180 = renderToDiv(<VoxShape voxel={v180} context={ctx180} />);
    const inner180 = c180.querySelector(".voxcss-ramp");
    expect(inner180?.classList.contains("voxcss-west")).toBe(true);
    expect(inner180?.classList.contains("voxcss-ramp-y")).toBe(true);
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

  it("z2 ramp sets dynamic angle via --voxcss-ramp-angle CSS variable", () => {
    // spanZ=2, spanY=1, layerElevation=50 → effectiveElevation=100
    // slopeParams(1, 50, 100): angle = atan(100/50)*180/PI ≈ 63.435deg
    const voxel: Voxel = { x: 0, y: 0, z: 0, z2: 2, shape: "ramp", color: "#ff0000" };
    const context = makeContext([voxel]);
    const container = renderToDiv(<VoxShape voxel={voxel} context={context} />);

    const rampEl = container.querySelector(".voxcss-ramp") as HTMLElement;
    expect(rampEl).toBeTruthy();
    const angle = rampEl.style.getPropertyValue("--voxcss-ramp-angle");
    expect(angle).toBeTruthy();
    // angle should be something like "63.435deg" (not the default 45deg)
    expect(angle).toContain("deg");
    expect(parseFloat(angle)).toBeGreaterThan(60);
  });

  it("z2 ramp renders as a single element (not multiple)", () => {
    const voxel: Voxel = { x: 0, y: 0, z: 0, z2: 3, shape: "ramp", color: "#ff0000" };
    const context = makeContext([voxel]);
    const container = renderToDiv(<VoxShape voxel={voxel} context={context} />);

    // Should produce exactly one .voxcss-ramp element
    const ramps = container.querySelectorAll(".voxcss-ramp");
    expect(ramps.length).toBe(1);
  });
});
