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

describe("VoxScene behavior", () => {
  describe("scene dimensions", () => {
    it("sets CSS custom properties for grid rows and cols based on voxel extents", () => {
      const voxels: Voxel[] = [
        { x: 0, y: 0, z: 0 },
        { x: 5, y: 7, z: 0 },
      ];
      const container = renderScene({ voxels });
      const scene = container.querySelector(".voxcss-scene") as HTMLElement;
      expect(scene).toBeTruthy();
      expect(scene.style.getPropertyValue("--voxcss-rows")).toBe("6");
      expect(scene.style.getPropertyValue("--voxcss-cols")).toBe("8");
    });

    it("computes dimensions for single voxel at origin", () => {
      const voxels: Voxel[] = [{ x: 0, y: 0, z: 0 }];
      const container = renderScene({ voxels });
      const scene = container.querySelector(".voxcss-scene") as HTMLElement;
      expect(scene.style.getPropertyValue("--voxcss-rows")).toBe("1");
      expect(scene.style.getPropertyValue("--voxcss-cols")).toBe("1");
    });
  });

  describe("layers", () => {
    it("creates a layer element for each z-level that has voxels", () => {
      const voxels: Voxel[] = [
        { x: 0, y: 0, z: 0, color: "#ff0000" },
        { x: 0, y: 0, z: 1, color: "#00ff00" },
        { x: 0, y: 0, z: 2, color: "#0000ff" },
      ];
      const container = renderScene({ voxels });
      const layers = container.querySelectorAll(".voxcss-layer");
      expect(layers.length).toBe(3);
    });

    it("creates a single layer when all voxels are on the same z-level", () => {
      const voxels: Voxel[] = [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
        { x: 0, y: 1, z: 0 },
      ];
      const container = renderScene({ voxels });
      const layers = container.querySelectorAll(".voxcss-layer");
      expect(layers.length).toBe(1);
    });
  });

  describe("floor visibility", () => {
    it("shows floor when showFloor is true", () => {
      const voxels: Voxel[] = [{ x: 0, y: 0, z: 0 }];
      const container = renderScene({ voxels, showFloor: true });
      const floor = container.querySelector(".voxcss-floor-z") as HTMLElement;
      expect(floor).toBeTruthy();
      // When floor is visible, background should NOT be 'none'
      expect(floor.style.background).not.toContain("none");
    });

    it("hides floor background when showFloor is false", () => {
      const voxels: Voxel[] = [{ x: 0, y: 0, z: 0 }];
      const container = renderScene({ voxels, showFloor: false });
      const floor = container.querySelector(".voxcss-floor-z") as HTMLElement;
      expect(floor).toBeTruthy();
      expect(floor.style.background).toContain("none");
    });
  });

  describe("walls visibility", () => {
    it("renders wall elements when showWalls is true", () => {
      const voxels: Voxel[] = [{ x: 0, y: 0, z: 0 }];
      const container = renderScene({ voxels, showWalls: true });
      const walls = container.querySelectorAll(".voxcss-wall");
      expect(walls.length).toBeGreaterThan(0);
    });

    it("does not render wall elements when showWalls is false", () => {
      const voxels: Voxel[] = [{ x: 0, y: 0, z: 0 }];
      const container = renderScene({ voxels, showWalls: false });
      const walls = container.querySelectorAll(".voxcss-wall");
      expect(walls.length).toBe(0);
    });
  });

  describe("ceiling", () => {
    it("shows ceiling when showFloor is true and camera rotX > 90 (wall mask t is true)", () => {
      // At rotX > 90 the top wall mask bit is set, triggering the ceiling
      const voxels: Voxel[] = [{ x: 0, y: 0, z: 0 }];
      const container = renderScene({ voxels, showFloor: true }, { rotX: 95 });
      const ceiling = container.querySelector(".voxcss-ceiling");
      expect(ceiling).toBeTruthy();
    });

    it("does not show ceiling when rotX is less than 90", () => {
      const voxels: Voxel[] = [{ x: 0, y: 0, z: 0 }];
      const container = renderScene({ voxels, showFloor: true }, { rotX: 65 });
      const ceiling = container.querySelector(".voxcss-ceiling");
      expect(ceiling).toBeNull();
    });

    it("does not show ceiling when showFloor is false even if rotX > 90", () => {
      const voxels: Voxel[] = [{ x: 0, y: 0, z: 0 }];
      const container = renderScene({ voxels, showFloor: false }, { rotX: 95 });
      const ceiling = container.querySelector(".voxcss-ceiling");
      expect(ceiling).toBeNull();
    });
  });

  describe("dimetric projection", () => {
    it("applies the dimetric projection class to the scene", () => {
      const voxels: Voxel[] = [{ x: 0, y: 0, z: 0 }];
      const container = renderScene({ voxels, projection: "dimetric" });
      const scene = container.querySelector(".voxcss-scene");
      expect(scene?.classList.contains("voxcss-projection--dimetric")).toBe(true);
    });

    it("does not apply dimetric class for cubic projection", () => {
      const voxels: Voxel[] = [{ x: 0, y: 0, z: 0 }];
      const container = renderScene({ voxels, projection: "cubic" });
      const scene = container.querySelector(".voxcss-scene");
      expect(scene?.classList.contains("voxcss-projection--dimetric")).toBe(false);
    });
  });

  describe("voxels render in correct grid positions", () => {
    it("positions cubes using grid-area based on voxel x,y coordinates", () => {
      const voxels: Voxel[] = [
        { x: 2, y: 3, z: 0, color: "#ff0000" },
      ];
      const container = renderScene({ voxels });
      const cube = container.querySelector(".voxcss-cube") as HTMLElement;
      expect(cube).toBeTruthy();
      expect(cube.style.gridArea).toBe("2 / 3 / 3 / 4");
    });

    it("renders multiple cubes each with their own grid position", () => {
      const voxels: Voxel[] = [
        { x: 0, y: 0, z: 0, color: "#ff0000" },
        { x: 1, y: 2, z: 0, color: "#00ff00" },
      ];
      const container = renderScene({ voxels });
      const cubes = container.querySelectorAll(".voxcss-cube");
      expect(cubes.length).toBe(2);
    });
  });
});
