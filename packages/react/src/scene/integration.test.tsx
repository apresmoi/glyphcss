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

function renderScene(
  sceneProps: React.ComponentProps<typeof VoxScene>,
  cameraProps: React.ComponentProps<typeof VoxCamera> = {}
): HTMLElement {
  return renderToDiv(
    <VoxCamera {...cameraProps}>
      <VoxScene {...sceneProps} />
    </VoxCamera>
  );
}

describe("Scene integration", () => {
  describe("mixed scene with multiple shape types", () => {
    it("renders cubes, ramp, wedge, and spike together in the same scene", () => {
      const voxels: Voxel[] = [
        { x: 0, y: 0, z: 0, color: "#ff0000" },
        { x: 1, y: 0, z: 0, color: "#00ff00" },
        { x: 2, y: 0, z: 0, shape: "ramp", color: "#0000ff", rot: 0 },
        { x: 3, y: 0, z: 0, shape: "wedge", color: "#ffff00", rot: 90 },
        { x: 4, y: 0, z: 0, shape: "spike", color: "#ff00ff", rot: 180 },
      ];
      const container = renderScene({ voxels });

      const cubes = container.querySelectorAll(".voxcss-cube");
      expect(cubes.length).toBe(2);

      const ramp = container.querySelector(".voxcss-ramp");
      expect(ramp).toBeTruthy();

      const wedge = container.querySelector(".voxcss-wedge");
      expect(wedge).toBeTruthy();

      const spike = container.querySelector(".voxcss-spike");
      expect(spike).toBeTruthy();
    });

    it("places all shape types in the correct single layer", () => {
      const voxels: Voxel[] = [
        { x: 0, y: 0, z: 0, color: "#ff0000" },
        { x: 1, y: 0, z: 0, shape: "ramp", color: "#0000ff" },
        { x: 2, y: 0, z: 0, shape: "wedge", color: "#00ff00" },
      ];
      const container = renderScene({ voxels });

      const layers = container.querySelectorAll(".voxcss-layer");
      expect(layers.length).toBe(1);
    });
  });

  describe("updating voxels changes the rendered scene", () => {
    it("re-renders with new voxels when props change", () => {
      const container = document.createElement("div");
      const root = createRoot(container);

      const voxels1: Voxel[] = [
        { x: 0, y: 0, z: 0, color: "#ff0000" },
      ];

      act(() =>
        root.render(
          <VoxCamera>
            <VoxScene voxels={voxels1} />
          </VoxCamera>
        )
      );

      let cubes = container.querySelectorAll(".voxcss-cube");
      expect(cubes.length).toBe(1);

      const voxels2: Voxel[] = [
        { x: 0, y: 0, z: 0, color: "#ff0000" },
        { x: 1, y: 0, z: 0, color: "#00ff00" },
        { x: 2, y: 0, z: 0, color: "#0000ff" },
      ];

      act(() =>
        root.render(
          <VoxCamera>
            <VoxScene voxels={voxels2} />
          </VoxCamera>
        )
      );

      cubes = container.querySelectorAll(".voxcss-cube");
      expect(cubes.length).toBe(3);
    });

    it("removes shapes when voxels are reduced", () => {
      const container = document.createElement("div");
      const root = createRoot(container);

      const voxels1: Voxel[] = [
        { x: 0, y: 0, z: 0, color: "#ff0000" },
        { x: 1, y: 0, z: 0, shape: "ramp", color: "#0000ff" },
      ];

      act(() =>
        root.render(
          <VoxCamera>
            <VoxScene voxels={voxels1} />
          </VoxCamera>
        )
      );

      expect(container.querySelector(".voxcss-ramp")).toBeTruthy();

      const voxels2: Voxel[] = [
        { x: 0, y: 0, z: 0, color: "#ff0000" },
      ];

      act(() =>
        root.render(
          <VoxCamera>
            <VoxScene voxels={voxels2} />
          </VoxCamera>
        )
      );

      expect(container.querySelector(".voxcss-ramp")).toBeNull();
    });
  });

  describe("wall mask changes show/hide appropriate faces", () => {
    it("shows back-left and back-right walls with default camera angle", () => {
      const voxels: Voxel[] = [{ x: 0, y: 0, z: 0 }];
      // Default rotX=65, rotY=45 should show bl and br walls
      const container = renderScene({ voxels, showWalls: true });

      const walls = container.querySelectorAll(".voxcss-wall");
      const wallClasses = Array.from(walls).map((w) => w.className);
      expect(wallClasses.some((c) => c.includes("backLeft"))).toBe(true);
      expect(wallClasses.some((c) => c.includes("backRight"))).toBe(true);
    });

    it("changes visible walls when camera rotY changes past a quadrant boundary", () => {
      const container = document.createElement("div");
      const root = createRoot(container);

      // At rotY=45, default shows bl + br
      act(() =>
        root.render(
          <VoxCamera rotY={45}>
            <VoxScene voxels={[{ x: 0, y: 0, z: 0 }]} showWalls />
          </VoxCamera>
        )
      );

      const wallsBefore = container.querySelectorAll(".voxcss-wall");
      const beforeClasses = Array.from(wallsBefore).map((w) => w.className);

      // At rotY=135, should show different walls (br + fr)
      act(() =>
        root.render(
          <VoxCamera rotY={135}>
            <VoxScene voxels={[{ x: 0, y: 0, z: 0 }]} showWalls />
          </VoxCamera>
        )
      );

      const wallsAfter = container.querySelectorAll(".voxcss-wall");
      const afterClasses = Array.from(wallsAfter).map((w) => w.className);

      // The set of visible walls should differ between the two angles
      expect(afterClasses).not.toEqual(beforeClasses);
    });

    it("cube face visibility changes with camera rotation", () => {
      const container = document.createElement("div");
      const root = createRoot(container);

      // At default angle (65, 45), visible faces are t, fr, fl
      act(() =>
        root.render(
          <VoxCamera rotX={65} rotY={45}>
            <VoxScene voxels={[{ x: 0, y: 0, z: 0, color: "#ff0000" }]} />
          </VoxCamera>
        )
      );

      const facesBefore = Array.from(
        container.querySelectorAll(".voxcss-cube-face")
      ).map((f) => f.className);

      // At rotY=225, the visible faces should be different
      act(() =>
        root.render(
          <VoxCamera rotX={65} rotY={225}>
            <VoxScene voxels={[{ x: 0, y: 0, z: 0, color: "#ff0000" }]} />
          </VoxCamera>
        )
      );

      const facesAfter = Array.from(
        container.querySelectorAll(".voxcss-cube-face")
      ).map((f) => f.className);

      // Different rotation should yield different visible faces
      expect(facesAfter).not.toEqual(facesBefore);
    });
  });
});
