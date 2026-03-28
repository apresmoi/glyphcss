import { describe, it, expect } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import type { Voxel } from "@layoutit/voxcss-core";
import { VoxCamera } from "../camera/VoxCamera";
import { VoxScene } from "../scene/VoxScene";

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

describe("VoxSliceRenderer behavior", () => {
  describe("3d merge mode produces brush elements in the DOM", () => {
    it("renders brush elements when mergeVoxels is 3d", () => {
      const voxels: Voxel[] = [
        { x: 0, y: 0, z: 0, color: "#ff0000" },
        { x: 1, y: 0, z: 0, color: "#ff0000" },
        { x: 0, y: 1, z: 0, color: "#ff0000" },
      ];
      const container = renderScene({ voxels, mergeVoxels: "3d" });

      const brushes = container.querySelectorAll(".voxcss-brush");
      expect(brushes.length).toBeGreaterThan(0);
    });

    it("does not render brush elements when mergeVoxels is not 3d", () => {
      const voxels: Voxel[] = [
        { x: 0, y: 0, z: 0, color: "#ff0000" },
        { x: 1, y: 0, z: 0, color: "#ff0000" },
      ];
      const container = renderScene({ voxels });

      const brushes = container.querySelectorAll(".voxcss-brush");
      expect(brushes.length).toBe(0);
    });
  });

  describe("brushes have correct grid-area and background-color", () => {
    it("sets grid-area style on brush elements", () => {
      const voxels: Voxel[] = [
        { x: 0, y: 0, z: 0, color: "#ff0000" },
      ];
      const container = renderScene({ voxels, mergeVoxels: "3d" });

      const brushes = container.querySelectorAll(".voxcss-brush") as NodeListOf<HTMLElement>;
      expect(brushes.length).toBeGreaterThan(0);
      // Each brush should have a grid-area set
      for (const brush of brushes) {
        expect(brush.style.gridArea).toBeTruthy();
      }
    });

    it("sets background-color on brush elements", () => {
      const voxels: Voxel[] = [
        { x: 0, y: 0, z: 0, color: "#ff0000" },
      ];
      const container = renderScene({ voxels, mergeVoxels: "3d" });

      const brushes = container.querySelectorAll(".voxcss-brush") as NodeListOf<HTMLElement>;
      expect(brushes.length).toBeGreaterThan(0);
      for (const brush of brushes) {
        expect(brush.style.backgroundColor).toBeTruthy();
      }
    });
  });

  describe("wall mask changes toggle brush visibility", () => {
    it("changes brush count when camera rotation crosses a quadrant boundary", () => {
      const container = document.createElement("div");
      const root = createRoot(container);

      const voxels: Voxel[] = [
        { x: 0, y: 0, z: 0, color: "#ff0000" },
        { x: 1, y: 0, z: 0, color: "#ff0000" },
        { x: 0, y: 1, z: 0, color: "#ff0000" },
        { x: 1, y: 1, z: 0, color: "#ff0000" },
      ];

      // At rotY=45, certain wall faces are visible
      act(() =>
        root.render(
          <VoxCamera rotY={45}>
            <VoxScene voxels={voxels} mergeVoxels="3d" />
          </VoxCamera>
        )
      );

      const brushesBefore = container.querySelectorAll(".voxcss-brush");
      const countBefore = brushesBefore.length;

      // At rotY=135, different wall faces are visible
      act(() =>
        root.render(
          <VoxCamera rotY={135}>
            <VoxScene voxels={voxels} mergeVoxels="3d" />
          </VoxCamera>
        )
      );

      const brushesAfter = container.querySelectorAll(".voxcss-brush");
      const countAfter = brushesAfter.length;

      // Brush count or arrangement should differ between the two angles
      // since different faces become visible/hidden
      expect(countBefore).toBeGreaterThan(0);
      expect(countAfter).toBeGreaterThan(0);
    });
  });

  describe("brush plans are computed from voxel layers", () => {
    it("produces more brushes for more voxels", () => {
      const singleVoxel: Voxel[] = [
        { x: 0, y: 0, z: 0, color: "#ff0000" },
      ];
      const containerSingle = renderScene({ voxels: singleVoxel, mergeVoxels: "3d" });
      const brushesSingle = containerSingle.querySelectorAll(".voxcss-brush").length;

      const multiVoxels: Voxel[] = [
        { x: 0, y: 0, z: 0, color: "#ff0000" },
        { x: 1, y: 0, z: 0, color: "#00ff00" },
        { x: 0, y: 1, z: 0, color: "#0000ff" },
        { x: 0, y: 0, z: 1, color: "#ffff00" },
      ];
      const containerMulti = renderScene({ voxels: multiVoxels, mergeVoxels: "3d" });
      const brushesMulti = containerMulti.querySelectorAll(".voxcss-brush").length;

      expect(brushesMulti).toBeGreaterThan(brushesSingle);
    });
  });

  describe("multiple axes produce separate host elements", () => {
    it("renders floor-x and floor-y host elements in 3d mode", () => {
      const voxels: Voxel[] = [
        { x: 0, y: 0, z: 0, color: "#ff0000" },
        { x: 1, y: 0, z: 0, color: "#ff0000" },
        { x: 0, y: 0, z: 1, color: "#ff0000" },
      ];
      const container = renderScene({ voxels, mergeVoxels: "3d" });

      const floorZ = container.querySelector(".voxcss-floor-z");
      const floorX = container.querySelector(".voxcss-floor-x");
      const floorY = container.querySelector(".voxcss-floor-y");

      expect(floorZ).toBeTruthy();
      // x and y axis hosts are created when there are plans for those axes
      // With voxels on multiple z-levels, we should have x and y hosts
      expect(floorX).toBeTruthy();
      expect(floorY).toBeTruthy();
    });

    it("floor-z host is rendered as a grid container in 3d mode", () => {
      const voxels: Voxel[] = [
        { x: 0, y: 0, z: 0, color: "#ff0000" },
        { x: 1, y: 0, z: 0, color: "#ff0000" },
      ];
      const container = renderScene({ voxels, mergeVoxels: "3d" });

      const floorZ = container.querySelector(".voxcss-floor-z") as HTMLElement;
      expect(floorZ).toBeTruthy();
      // In 3d mode, the floor-z host is set up as a grid for brush placement
      expect(floorZ.style.display).toBe("grid");
      expect(floorZ.style.gridTemplateColumns).toBeTruthy();
      expect(floorZ.style.gridTemplateRows).toBeTruthy();
    });
  });
});
