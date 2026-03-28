import { describe, it, expect } from "vitest";
import { createApp, h } from "vue";
import type { Voxel } from "@layoutit/voxcss-core";
import { VoxCamera } from "../camera/VoxCamera";
import { VoxScene } from "./VoxScene";

function renderScene(
  sceneProps: Record<string, any>,
  cameraProps: Record<string, any> = {}
): HTMLElement {
  const container = document.createElement("div");
  const app = createApp({
    setup() {
      return () =>
        h(VoxCamera, cameraProps, {
          default: () => h(VoxScene, sceneProps),
        });
    },
  });
  app.mount(container);
  return container;
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
      const voxels: Voxel[] = [
        { x: 0, y: 0, z: 0, color: "#ff0000" },
        { x: 25, y: 25, z: 0, color: "#00ff00" },
      ];
      const container = renderScene({ voxels, showFloor: true });
      const floor = container.querySelector(".voxcss-floor-z") as HTMLElement;
      expect(floor).toBeTruthy();
      const floorGrid = floor.style.getPropertyValue("--voxcss-floor-grid");
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
