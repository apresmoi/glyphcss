import { describe, it, expect } from "vitest";
import { createApp, h, ref, nextTick } from "vue";
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
    it("re-renders with new voxels when props change", async () => {
      const voxelData = ref<Voxel[]>([
        { x: 0, y: 0, z: 0, color: "#ff0000" },
      ]);
      const container = document.createElement("div");
      const app = createApp({
        setup() {
          return () =>
            h(VoxCamera, {}, {
              default: () => h(VoxScene, { voxels: voxelData.value }),
            });
        },
      });
      app.mount(container);

      let cubes = container.querySelectorAll(".voxcss-cube");
      expect(cubes.length).toBe(1);

      voxelData.value = [
        { x: 0, y: 0, z: 0, color: "#ff0000" },
        { x: 1, y: 0, z: 0, color: "#00ff00" },
        { x: 2, y: 0, z: 0, color: "#0000ff" },
      ];
      await nextTick();

      cubes = container.querySelectorAll(".voxcss-cube");
      expect(cubes.length).toBe(3);
    });

    it("removes shapes when voxels are reduced", async () => {
      const voxelData = ref<Voxel[]>([
        { x: 0, y: 0, z: 0, color: "#ff0000" },
        { x: 1, y: 0, z: 0, shape: "ramp", color: "#0000ff" },
      ]);
      const container = document.createElement("div");
      const app = createApp({
        setup() {
          return () =>
            h(VoxCamera, {}, {
              default: () => h(VoxScene, { voxels: voxelData.value }),
            });
        },
      });
      app.mount(container);

      expect(container.querySelector(".voxcss-ramp")).toBeTruthy();

      voxelData.value = [
        { x: 0, y: 0, z: 0, color: "#ff0000" },
      ];
      await nextTick();

      expect(container.querySelector(".voxcss-ramp")).toBeNull();
    });
  });

  describe("wall mask changes show/hide appropriate faces", () => {
    it("shows back-left and back-right walls with default camera angle", () => {
      const voxels: Voxel[] = [{ x: 0, y: 0, z: 0 }];
      const container = renderScene({ voxels, showWalls: true });

      const walls = container.querySelectorAll(".voxcss-wall");
      const wallClasses = Array.from(walls).map((w) => w.className);
      expect(wallClasses.some((c) => c.includes("backLeft"))).toBe(true);
      expect(wallClasses.some((c) => c.includes("backRight"))).toBe(true);
    });

    it("changes visible walls when camera rotY changes past a quadrant boundary", async () => {
      const rotY = ref(45);
      const container = document.createElement("div");
      const app = createApp({
        setup() {
          return () =>
            h(VoxCamera, { rotY: rotY.value }, {
              default: () => h(VoxScene, { voxels: [{ x: 0, y: 0, z: 0 }], showWalls: true }),
            });
        },
      });
      app.mount(container);

      const wallsBefore = container.querySelectorAll(".voxcss-wall");
      const beforeClasses = Array.from(wallsBefore).map((w) => w.className);

      rotY.value = 135;
      await nextTick();

      const wallsAfter = container.querySelectorAll(".voxcss-wall");
      const afterClasses = Array.from(wallsAfter).map((w) => w.className);

      expect(afterClasses).not.toEqual(beforeClasses);
    });

    it("cube face visibility changes with camera rotation", async () => {
      const rotY = ref(45);
      const container = document.createElement("div");
      const app = createApp({
        setup() {
          return () =>
            h(VoxCamera, { rotX: 65, rotY: rotY.value }, {
              default: () =>
                h(VoxScene, { voxels: [{ x: 0, y: 0, z: 0, color: "#ff0000" }] }),
            });
        },
      });
      app.mount(container);

      const facesBefore = Array.from(
        container.querySelectorAll(".voxcss-cube-face")
      ).map((f) => f.className);

      rotY.value = 225;
      await nextTick();

      const facesAfter = Array.from(
        container.querySelectorAll(".voxcss-cube-face")
      ).map((f) => f.className);

      expect(facesAfter).not.toEqual(facesBefore);
    });
  });
});
