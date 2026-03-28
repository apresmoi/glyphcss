import { describe, it, expect } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import type { GridContext, Voxel } from "@layoutit/voxcss-core";
import { buildSceneContext } from "@layoutit/voxcss-core";
import { VoxShape } from "./VoxShape";
import { VoxCube } from "./VoxCube";

function makeContext(voxels: Voxel[], walls?: Record<string, boolean>): GridContext {
  return buildSceneContext({ grid: voxels, context: walls ? { walls } : undefined }).context;
}

function renderToDiv(element: React.ReactElement): HTMLElement {
  const container = document.createElement("div");
  const root = createRoot(container);
  act(() => root.render(element));
  return container;
}

describe("Shape behaviors", () => {
  describe("ramp", () => {
    it("renders with a slope element", () => {
      const voxel: Voxel = { x: 0, y: 0, z: 0, shape: "ramp", color: "#ff0000" };
      const context = makeContext([voxel]);
      const container = renderToDiv(<VoxShape voxel={voxel} context={context} />);

      expect(container.querySelector(".voxcss-ramp")).toBeTruthy();
      expect(container.querySelector(".voxcss-ramp-slope")).toBeTruthy();
    });
  });

  describe("wedge", () => {
    it("renders with two SVG slope elements", () => {
      const voxel: Voxel = { x: 0, y: 0, z: 0, shape: "wedge", color: "#00ff00" };
      const context = makeContext([voxel]);
      const container = renderToDiv(<VoxShape voxel={voxel} context={context} />);

      expect(container.querySelector(".voxcss-wedge")).toBeTruthy();
      const svgs = container.querySelectorAll("svg");
      expect(svgs.length).toBe(2);
      const paths = container.querySelectorAll("path");
      expect(paths.length).toBe(2);
    });
  });

  describe("spike", () => {
    it("renders with two SVG slope elements", () => {
      const voxel: Voxel = { x: 0, y: 0, z: 0, shape: "spike", color: "#0000ff" };
      const context = makeContext([voxel]);
      const container = renderToDiv(<VoxShape voxel={voxel} context={context} />);

      expect(container.querySelector(".voxcss-spike")).toBeTruthy();
      const svgs = container.querySelectorAll("svg");
      expect(svgs.length).toBe(2);
    });
  });

  describe("rotation orientations", () => {
    const shapes: Array<{ shape: "ramp" | "wedge" | "spike"; className: string }> = [
      { shape: "ramp", className: "voxcss-ramp" },
      { shape: "wedge", className: "voxcss-wedge" },
      { shape: "spike", className: "voxcss-spike" },
    ];

    const orientationCases: Array<{ rot: number; expected: string }> = [
      { rot: 0, expected: "voxcss-east" },
      { rot: 90, expected: "voxcss-south" },
      { rot: 180, expected: "voxcss-west" },
      { rot: 270, expected: "voxcss-north" },
    ];

    for (const { shape, className } of shapes) {
      for (const { rot, expected } of orientationCases) {
        it(`${shape} at rot=${rot} has orientation class ${expected}`, () => {
          const voxel: Voxel = { x: 0, y: 0, z: 0, shape, rot, color: "#aabbcc" };
          const context = makeContext([voxel]);
          const container = renderToDiv(<VoxShape voxel={voxel} context={context} />);

          const shapeEl = container.querySelector(`.${className}`);
          expect(shapeEl).toBeTruthy();
          expect(shapeEl?.classList.contains(expected)).toBe(true);
        });
      }
    }
  });

  describe("covered shape", () => {
    it("returns null when a voxel exists directly above the shape", () => {
      const ramp: Voxel = { x: 0, y: 0, z: 0, shape: "ramp", color: "#ff0000" };
      const above: Voxel = { x: 0, y: 0, z: 1, color: "#00ff00" };
      const context = makeContext([ramp, above]);
      const container = renderToDiv(<VoxShape voxel={ramp} context={context} />);

      expect(container.querySelector(".voxcss-ramp")).toBeNull();
    });

    it("renders when there is no voxel above", () => {
      const ramp: Voxel = { x: 0, y: 0, z: 0, shape: "ramp", color: "#ff0000" };
      const context = makeContext([ramp]);
      const container = renderToDiv(<VoxShape voxel={ramp} context={context} />);

      expect(container.querySelector(".voxcss-ramp")).toBeTruthy();
    });
  });

  describe("bottom face rendering", () => {
    it("renders bottom face when not occluded and walls.b is false", () => {
      const voxel: Voxel = { x: 0, y: 0, z: 0, shape: "ramp", color: "#ff0000" };
      // Explicitly set walls.b to false so bottom is visible
      const context = makeContext([voxel], { b: false, t: false, bl: false, br: false, fl: false, fr: false });
      const container = renderToDiv(<VoxShape voxel={voxel} context={context} />);

      const bottom = container.querySelector(".voxcss-ramp-bottom");
      expect(bottom).toBeTruthy();
    });

    it("hides bottom face when walls.b is true (back-face culled)", () => {
      const voxel: Voxel = { x: 0, y: 0, z: 0, shape: "ramp", color: "#ff0000" };
      const context = makeContext([voxel], { b: true });
      const container = renderToDiv(<VoxShape voxel={voxel} context={context} />);

      const bottom = container.querySelector(".voxcss-ramp-bottom");
      expect(bottom).toBeNull();
    });

    it("hides bottom face when the voxel below occludes it", () => {
      const ramp: Voxel = { x: 0, y: 0, z: 1, shape: "ramp", color: "#ff0000" };
      const below: Voxel = { x: 0, y: 0, z: 0, color: "#00ff00" };
      const context = makeContext([ramp, below], { b: false, t: false, bl: false, br: false, fl: false, fr: false });
      const container = renderToDiv(<VoxShape voxel={ramp} context={context} />);

      const bottom = container.querySelector(".voxcss-ramp-bottom");
      expect(bottom).toBeNull();
    });
  });

  describe("textured shape", () => {
    it("applies backgroundImage when voxel has a texture URL", () => {
      const voxel: Voxel = {
        x: 0, y: 0, z: 0,
        shape: "ramp",
        color: "#ff0000",
        texture: "https://example.com/texture.png",
      };
      const context = makeContext([voxel]);
      const container = renderToDiv(<VoxShape voxel={voxel} context={context} />);

      const slope = container.querySelector(".voxcss-ramp-slope") as HTMLElement;
      expect(slope).toBeTruthy();
      expect(slope.style.backgroundImage).toContain("https://example.com/texture.png");
    });

    it("does not apply backgroundImage when no texture is set", () => {
      const voxel: Voxel = { x: 0, y: 0, z: 0, shape: "ramp", color: "#ff0000" };
      const context = makeContext([voxel]);
      const container = renderToDiv(<VoxShape voxel={voxel} context={context} />);

      const slope = container.querySelector(".voxcss-ramp-slope") as HTMLElement;
      expect(slope).toBeTruthy();
      expect(slope.style.backgroundImage).toBe("");
    });
  });

  describe("shape colors from lighting", () => {
    it("applies computed slope color to ramp slope element", () => {
      const voxel: Voxel = { x: 0, y: 0, z: 0, shape: "ramp", color: "#ff0000" };
      const context = makeContext([voxel]);
      const container = renderToDiv(<VoxShape voxel={voxel} context={context} />);

      const slope = container.querySelector(".voxcss-ramp-slope") as HTMLElement;
      expect(slope).toBeTruthy();
      // The slope should have a backgroundColor derived from lighting
      expect(slope.style.backgroundColor).toBeTruthy();
    });

    it("applies fill colors to wedge SVG paths", () => {
      const voxel: Voxel = { x: 0, y: 0, z: 0, shape: "wedge", color: "#00ff00" };
      const context = makeContext([voxel]);
      const container = renderToDiv(<VoxShape voxel={voxel} context={context} />);

      const paths = container.querySelectorAll("path");
      expect(paths.length).toBe(2);
      // Each path should have a fill derived from the voxel color
      for (const path of paths) {
        expect(path.getAttribute("fill")).toBeTruthy();
      }
    });
  });

  describe("cube faces", () => {
    it("renders only visible faces for an isolated cube", () => {
      const voxel: Voxel = { x: 0, y: 0, z: 0, color: "#ff0000" };
      const context = makeContext([voxel]);
      const container = renderToDiv(<VoxCube voxel={voxel} context={context} />);

      const faces = container.querySelectorAll(".voxcss-cube-face");
      // Default wall mask hides b, bl, br — expect top, front-right, front-left
      expect(faces.length).toBe(3);
    });

    it("renders no faces when cube is fully surrounded", () => {
      const voxels: Voxel[] = [];
      for (let x = 0; x < 3; x++)
        for (let y = 0; y < 3; y++)
          for (let z = 0; z < 3; z++)
            voxels.push({ x, y, z });
      const context = makeContext(voxels);
      const center = voxels.find((v) => v.x === 1 && v.y === 1 && v.z === 1)!;
      const container = renderToDiv(<VoxCube voxel={center} context={context} />);

      const faces = container.querySelectorAll(".voxcss-cube-face");
      expect(faces.length).toBe(0);
    });

    it("applies correct background color based on face lighting", () => {
      const voxel: Voxel = { x: 0, y: 0, z: 0, color: "#ff0000" };
      const context = makeContext([voxel]);
      const container = renderToDiv(<VoxCube voxel={voxel} context={context} />);

      const topFace = container.querySelector(".voxcss-cube-face--t") as HTMLElement;
      expect(topFace).toBeTruthy();
      // Top face has 0 delta, so it keeps the original red
      expect(topFace.style.backgroundColor).toBe("rgb(255, 0, 0)");
    });

    it("has distinct face class names for each visible face", () => {
      const voxel: Voxel = { x: 0, y: 0, z: 0, color: "#ff0000" };
      const context = makeContext([voxel]);
      const container = renderToDiv(<VoxCube voxel={voxel} context={context} />);

      const faces = container.querySelectorAll(".voxcss-cube-face");
      const classNames = Array.from(faces).map((f) => f.className);
      expect(classNames).toContain("voxcss-cube-face voxcss-cube-face--t");
      expect(classNames).toContain("voxcss-cube-face voxcss-cube-face--fr");
      expect(classNames).toContain("voxcss-cube-face voxcss-cube-face--fl");
    });
  });
});
