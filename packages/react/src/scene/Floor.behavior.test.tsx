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

describe("Floor behavior", () => {
  describe("floor custom properties when visible", () => {
    it("has --voxcss-floor-base custom property when showFloor is true", () => {
      const voxels: Voxel[] = [{ x: 0, y: 0, z: 0, color: "#ff0000" }];
      const container = renderScene({ voxels, showFloor: true });
      const floor = container.querySelector(".voxcss-floor-z") as HTMLElement;
      expect(floor).toBeTruthy();
      const floorBase = floor.style.getPropertyValue("--voxcss-floor-base");
      expect(floorBase).toBeTruthy();
      expect(floorBase).not.toBe("");
    });

    it("has --voxcss-grid-x and --voxcss-grid-y CSS custom properties when visible", () => {
      const voxels: Voxel[] = [{ x: 0, y: 0, z: 0, color: "#ff0000" }];
      const container = renderScene({ voxels, showFloor: true });
      const floor = container.querySelector(".voxcss-floor-z") as HTMLElement;
      expect(floor).toBeTruthy();
      const gridX = floor.style.getPropertyValue("--voxcss-grid-x");
      const gridY = floor.style.getPropertyValue("--voxcss-grid-y");
      expect(gridX).toContain("px");
      expect(gridY).toContain("px");
    });
  });

  describe("floor background when not visible", () => {
    it("has background:none when showFloor is false", () => {
      const voxels: Voxel[] = [{ x: 0, y: 0, z: 0, color: "#ff0000" }];
      const container = renderScene({ voxels, showFloor: false });
      const floor = container.querySelector(".voxcss-floor-z") as HTMLElement;
      expect(floor).toBeTruthy();
      expect(floor.style.background).toContain("none");
    });
  });

  describe("large grids suppress floor grid sprite", () => {
    it("does not set --voxcss-floor-grid for grids larger than 20x20", () => {
      // Create a grid with voxels spanning > 20 in both axes
      const voxels: Voxel[] = [
        { x: 0, y: 0, z: 0, color: "#ff0000" },
        { x: 25, y: 25, z: 0, color: "#00ff00" },
      ];
      const container = renderScene({ voxels, showFloor: true });
      const floor = container.querySelector(".voxcss-floor-z") as HTMLElement;
      expect(floor).toBeTruthy();
      const floorGrid = floor.style.getPropertyValue("--voxcss-floor-grid");
      // When grid exceeds threshold, grid sprite should be empty/unset
      expect(floorGrid).toBe("");
    });

    it("sets --voxcss-floor-grid for small grids", () => {
      const voxels: Voxel[] = [
        { x: 0, y: 0, z: 0, color: "#ff0000" },
        { x: 3, y: 3, z: 0, color: "#00ff00" },
      ];
      const container = renderScene({ voxels, showFloor: true });
      const floor = container.querySelector(".voxcss-floor-z") as HTMLElement;
      expect(floor).toBeTruthy();
      const floorGrid = floor.style.getPropertyValue("--voxcss-floor-grid");
      expect(floorGrid).toContain("url(");
    });
  });
});
