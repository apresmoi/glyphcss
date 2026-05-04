import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mountScene, normalizeSceneState } from "./sceneBindings";
import { sceneController, type SceneController } from "@layoutit/voxcss-core/controller/sceneController";
import { STYLE_ID } from "@layoutit/voxcss-core/types";

describe("scene hook props (Phase 1e)", () => {
  let element: HTMLElement;
  let controller: SceneController;

  beforeEach(() => {
    vi.useFakeTimers();
    element = document.createElement("div");
    document.body.appendChild(element);
    controller = sceneController();
  });

  afterEach(() => {
    vi.useRealTimers();
    element.remove();
    const styleEl = document.getElementById(STYLE_ID);
    if (styleEl) styleEl.remove();
  });

  describe("normalizeSceneState", () => {
    it("passes lighting through when provided", () => {
      const lighting = vi.fn(() => ({ backgroundColor: "rgb(255, 0, 0)" }));
      const state = normalizeSceneState({ lighting });
      expect(state.lighting).toBe(lighting);
    });

    it("passes resolveTexture through when provided", () => {
      const resolveTexture = vi.fn((name: string) => `/textures/${name}.png`);
      const state = normalizeSceneState({ resolveTexture });
      expect(state.resolveTexture).toBe(resolveTexture);
    });

    it("leaves lighting and resolveTexture undefined when not provided", () => {
      const state = normalizeSceneState({});
      expect(state.lighting).toBeUndefined();
      expect(state.resolveTexture).toBeUndefined();
    });
  });

  describe("lighting forwarded into rendered scene", () => {
    it("calls the lighting hook during render", () => {
      const lighting = vi.fn(() => ({ backgroundColor: "rgb(255, 0, 0)" }));
      const voxels = [{ x: 0, y: 0, z: 0, color: "#aaa" }];

      const binding = mountScene({
        controller,
        element,
        voxels,
        showWalls: false,
        showFloor: false,
        projection: "cubic",
        lighting,
      });

      expect(lighting).toHaveBeenCalled();

      binding.destroy();
    });

    it("calls the resolveTexture hook during render", () => {
      const resolveTexture = vi.fn((name: string) => `/textures/${name}.png`);
      const voxels = [{ x: 0, y: 0, z: 0, texture: "brick" }];

      const binding = mountScene({
        controller,
        element,
        voxels,
        showWalls: false,
        showFloor: false,
        projection: "cubic",
        resolveTexture,
      });

      expect(resolveTexture).toHaveBeenCalledWith("brick", expect.any(String));

      binding.destroy();
    });
  });

  describe("cache invalidation", () => {
    it("re-renders when lighting reference changes", () => {
      const lightingA = vi.fn(() => ({ backgroundColor: "rgb(255, 0, 0)" }));
      const lightingB = vi.fn(() => ({ backgroundColor: "rgb(0, 255, 0)" }));
      const voxels = [{ x: 0, y: 0, z: 0, color: "#aaa" }];

      const rafSpy = vi.spyOn(globalThis, "requestAnimationFrame");

      const binding = mountScene({
        controller,
        element,
        voxels,
        showWalls: false,
        showFloor: false,
        projection: "cubic",
        lighting: lightingA,
      });

      rafSpy.mockClear();

      binding.update({
        voxels,
        showWalls: false,
        showFloor: false,
        projection: "cubic",
        lighting: lightingB,
      });

      expect(rafSpy).toHaveBeenCalled();

      rafSpy.mockRestore();
      binding.destroy();
    });

    it("re-renders when resolveTexture reference changes", () => {
      const resolveTextureA = vi.fn((name: string) => `/a/${name}.png`);
      const resolveTextureB = vi.fn((name: string) => `/b/${name}.png`);
      const voxels = [{ x: 0, y: 0, z: 0, texture: "brick" }];

      const rafSpy = vi.spyOn(globalThis, "requestAnimationFrame");

      const binding = mountScene({
        controller,
        element,
        voxels,
        showWalls: false,
        showFloor: false,
        projection: "cubic",
        resolveTexture: resolveTextureA,
      });

      rafSpy.mockClear();

      binding.update({
        voxels,
        showWalls: false,
        showFloor: false,
        projection: "cubic",
        resolveTexture: resolveTextureB,
      });

      expect(rafSpy).toHaveBeenCalled();

      rafSpy.mockRestore();
      binding.destroy();
    });

    it("does NOT re-render when same lighting reference is provided", () => {
      const lighting = vi.fn(() => ({ backgroundColor: "rgb(255, 0, 0)" }));
      const voxels = [{ x: 0, y: 0, z: 0, color: "#aaa" }];

      const rafSpy = vi.spyOn(globalThis, "requestAnimationFrame");

      const binding = mountScene({
        controller,
        element,
        voxels,
        showWalls: false,
        showFloor: false,
        projection: "cubic",
        lighting,
      });

      rafSpy.mockClear();

      binding.update({
        voxels,
        showWalls: false,
        showFloor: false,
        projection: "cubic",
        lighting,
      });

      expect(rafSpy).not.toHaveBeenCalled();

      rafSpy.mockRestore();
      binding.destroy();
    });
  });

  describe("merge is not skipped when hooks present (per §4b)", () => {
    it("mergeVoxels=2d still merges even when lighting hook is present", () => {
      const lighting = vi.fn(() => ({ backgroundColor: "rgb(255, 0, 0)" }));
      const voxels = [
        { x: 0, y: 0, z: 0, color: "#aaa" },
        { x: 1, y: 0, z: 0, color: "#aaa" },
      ];

      const binding = mountScene({
        controller,
        element,
        voxels,
        showWalls: false,
        showFloor: false,
        projection: "cubic",
        mergeVoxels: "2d",
        lighting,
      });

      // Two adjacent same-color voxels merge into one rectangle — one cube element.
      const cubes = element.querySelectorAll(".voxcss-cube");
      expect(cubes.length).toBe(1);

      binding.destroy();
    });
  });
});
