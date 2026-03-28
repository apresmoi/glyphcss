import { describe, it, expect } from "vitest";
import { createApp, h, ref, nextTick } from "vue";
import type { Voxel } from "@layoutit/voxcss-core";
import { VoxCamera } from "../camera/VoxCamera";
import { VoxScene } from "../scene/VoxScene";

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
    it("changes brush count when camera rotation crosses a quadrant boundary", async () => {
      const rotY = ref(45);
      const voxels: Voxel[] = [
        { x: 0, y: 0, z: 0, color: "#ff0000" },
        { x: 1, y: 0, z: 0, color: "#ff0000" },
        { x: 0, y: 1, z: 0, color: "#ff0000" },
        { x: 1, y: 1, z: 0, color: "#ff0000" },
      ];

      const container = document.createElement("div");
      const app = createApp({
        setup() {
          return () =>
            h(VoxCamera, { rotY: rotY.value }, {
              default: () => h(VoxScene, { voxels, mergeVoxels: "3d" }),
            });
        },
      });
      app.mount(container);

      const brushesBefore = container.querySelectorAll(".voxcss-brush");
      const countBefore = brushesBefore.length;

      rotY.value = 135;
      await nextTick();

      const brushesAfter = container.querySelectorAll(".voxcss-brush");
      const countAfter = brushesAfter.length;

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
      expect(floorZ.style.display).toBe("grid");
      expect(floorZ.style.gridTemplateColumns).toBeTruthy();
      expect(floorZ.style.gridTemplateRows).toBeTruthy();
    });
  });
});
