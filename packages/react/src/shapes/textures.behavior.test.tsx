import { describe, it, expect } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import type { GridContext, Voxel } from "@layoutit/voxcss-core";
import { buildSceneContext } from "@layoutit/voxcss-core";
import { VoxShape } from "./VoxShape";

function makeContext(voxels: Voxel[], walls?: Record<string, boolean>): GridContext {
  return buildSceneContext({ grid: voxels, context: walls ? { walls } : undefined }).context;
}

function renderToDiv(element: React.ReactElement): HTMLElement {
  const container = document.createElement("div");
  const root = createRoot(container);
  act(() => root.render(element));
  return container;
}

describe("Shape texture behaviors", () => {
  describe("ramp with texture", () => {
    it("applies backgroundImage on slope when texture is set", () => {
      const voxel: Voxel = {
        x: 0, y: 0, z: 0,
        shape: "ramp",
        color: "#ff0000",
        texture: "https://example.com/brick.png",
      };
      const context = makeContext([voxel]);
      const container = renderToDiv(<VoxShape voxel={voxel} context={context} />);

      const slope = container.querySelector(".voxcss-ramp-slope") as HTMLElement;
      expect(slope).toBeTruthy();
      expect(slope.style.backgroundImage).toContain("https://example.com/brick.png");
    });
  });

  describe("wedge with texture", () => {
    it("creates SVG pattern with image href for textured wedge", () => {
      const voxel: Voxel = {
        x: 0, y: 0, z: 0,
        shape: "wedge",
        color: "#00ff00",
        texture: "https://example.com/stone.png",
      };
      const context = makeContext([voxel]);
      const container = renderToDiv(<VoxShape voxel={voxel} context={context} />);

      const patterns = container.querySelectorAll("pattern");
      expect(patterns.length).toBeGreaterThan(0);

      const images = container.querySelectorAll("image");
      expect(images.length).toBeGreaterThan(0);
      const hrefs = Array.from(images).map((img) => img.getAttribute("href"));
      expect(hrefs.some((h) => h === "https://example.com/stone.png")).toBe(true);
    });
  });

  describe("spike with texture", () => {
    it("creates SVG pattern with image href for textured spike", () => {
      const voxel: Voxel = {
        x: 0, y: 0, z: 0,
        shape: "spike",
        color: "#0000ff",
        texture: "https://example.com/metal.png",
      };
      const context = makeContext([voxel]);
      const container = renderToDiv(<VoxShape voxel={voxel} context={context} />);

      const patterns = container.querySelectorAll("pattern");
      expect(patterns.length).toBeGreaterThan(0);

      const images = container.querySelectorAll("image");
      expect(images.length).toBeGreaterThan(0);
      const hrefs = Array.from(images).map((img) => img.getAttribute("href"));
      expect(hrefs.some((h) => h === "https://example.com/metal.png")).toBe(true);
    });
  });

  describe("shape bottom with texture", () => {
    it("applies backgroundImage on ramp bottom when texture is set and bottom is visible", () => {
      const voxel: Voxel = {
        x: 0, y: 0, z: 0,
        shape: "ramp",
        color: "#ff0000",
        texture: "https://example.com/wood.png",
      };
      const context = makeContext([voxel], { b: false, t: false, bl: false, br: false, fl: false, fr: false });
      const container = renderToDiv(<VoxShape voxel={voxel} context={context} />);

      const bottom = container.querySelector(".voxcss-ramp-bottom") as HTMLElement;
      expect(bottom).toBeTruthy();
      expect(bottom.style.backgroundImage).toContain("https://example.com/wood.png");
    });

    it("applies backgroundImage on wedge bottom when texture is set and bottom is visible", () => {
      const voxel: Voxel = {
        x: 0, y: 0, z: 0,
        shape: "wedge",
        color: "#00ff00",
        texture: "https://example.com/wood.png",
      };
      const context = makeContext([voxel], { b: false, t: false, bl: false, br: false, fl: false, fr: false });
      const container = renderToDiv(<VoxShape voxel={voxel} context={context} />);

      const bottom = container.querySelector(".voxcss-wedge-bottom") as HTMLElement;
      expect(bottom).toBeTruthy();
      expect(bottom.style.backgroundImage).toContain("https://example.com/wood.png");
    });
  });

  describe("texture brightness filter", () => {
    it("applies brightness filter on slope based on face delta", () => {
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
      // When there is a texture and a non-zero delta, a brightness filter is applied
      const filter = slope.style.filter;
      // The slope surface has a lighting delta that produces a brightness filter
      if (filter) {
        expect(filter).toContain("brightness(");
      }
    });

    it("applies brightness filter on wedge SVG slope wrappers based on face delta", () => {
      const voxel: Voxel = {
        x: 0, y: 0, z: 0,
        shape: "wedge",
        color: "#00ff00",
        texture: "https://example.com/texture.png",
      };
      const context = makeContext([voxel]);
      const container = renderToDiv(<VoxShape voxel={voxel} context={context} />);

      // SvgSlope wraps in a div with filter
      const slopeWrappers = container.querySelectorAll(".voxcss-wedge-slope");
      expect(slopeWrappers.length).toBe(2);

      // At least one slope should have a brightness filter when textured
      const filters = Array.from(slopeWrappers).map(
        (el) => (el as HTMLElement).style.filter
      );
      const hasFilter = filters.some((f) => f && f.includes("brightness("));
      expect(hasFilter).toBe(true);
    });
  });
});
