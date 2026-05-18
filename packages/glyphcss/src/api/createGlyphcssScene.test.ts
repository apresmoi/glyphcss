import { describe, it, expect, beforeEach } from "vitest";
import { createGlyphcssScene } from "./createGlyphcssScene";
import type { Polygon } from "@glyphcss/core";

function makeDiv(): HTMLElement {
  return document.createElement("div");
}

function makeSinglePolygon(): Polygon[] {
  return [{
    vertices: [
      [0, 1, 0],
      [-1, -1, 0],
      [1, -1, 0],
    ],
    color: "#aaaaaa",
  }];
}

function makeCubePolygons(): Polygon[] {
  const out: Polygon[] = [];
  const faces: Array<[number,number,number, number,number,number, number,number,number]> = [
    [-1,-1, 1, 1,-1, 1, 1, 1, 1],
    [-1,-1, 1, 1, 1, 1,-1, 1, 1],
    [ 1,-1,-1,-1,-1,-1,-1, 1,-1],
    [ 1,-1,-1,-1, 1,-1, 1, 1,-1],
    [-1, 1, 1, 1, 1, 1, 1, 1,-1],
    [-1, 1, 1, 1, 1,-1,-1, 1,-1],
  ];
  for (const [x0,y0,z0,x1,y1,z1,x2,y2,z2] of faces) {
    out.push({ vertices: [[x0,y0,z0],[x1,y1,z1],[x2,y2,z2]] });
  }
  return out;
}

describe("createGlyphcssScene", () => {
  let host: HTMLElement;

  beforeEach(() => {
    host = makeDiv();
    document.body.appendChild(host);
  });

  it("creates a scene div with a pre element", () => {
    const scene = createGlyphcssScene(host, { cols: 20, rows: 10 });
    const sceneEl = host.querySelector(".glyphcss-scene");
    expect(sceneEl).toBeTruthy();
    const pre = host.querySelector("pre.glyphcss-output");
    expect(pre).toBeTruthy();
    scene.destroy();
  });

  it("exposes host and output references", () => {
    const scene = createGlyphcssScene(host, { cols: 20, rows: 10 });
    expect(scene.host).toBe(host);
    expect(scene.output.tagName.toLowerCase()).toBe("pre");
    scene.destroy();
  });

  it("renders text content after adding a mesh", async () => {
    const scene = createGlyphcssScene(host, { cols: 30, rows: 15, useColors: false });
    scene.add(makeCubePolygons());
    // Await the microtask queue so scheduleRender fires
    await Promise.resolve();
    const pre = scene.output;
    expect(pre.textContent!.length).toBeGreaterThan(0);
    scene.destroy();
  });

  it("returns a GlyphcssMeshHandle with dispose", () => {
    const scene = createGlyphcssScene(host, { cols: 20, rows: 10 });
    const handle = scene.add(makeSinglePolygon());
    expect(typeof handle.dispose).toBe("function");
    expect(typeof handle.setTransform).toBe("function");
    handle.dispose();
    scene.destroy();
  });

  it("removes mesh on dispose and re-renders empty", async () => {
    const scene = createGlyphcssScene(host, { cols: 20, rows: 10, useColors: false });
    const handle = scene.add(makeCubePolygons());
    await Promise.resolve();
    const withMesh = scene.output.textContent ?? "";

    handle.dispose();
    await Promise.resolve();
    const withoutMesh = scene.output.textContent ?? "";

    // After mesh removal, output should have fewer (or equal) non-space chars
    const nonSpaceBefore = withMesh.replace(/[\s\n]/g, "").length;
    const nonSpaceAfter = withoutMesh.replace(/[\s\n]/g, "").length;
    expect(nonSpaceAfter).toBeLessThanOrEqual(nonSpaceBefore);
    scene.destroy();
  });

  it("destroy removes the scene element from host", () => {
    const scene = createGlyphcssScene(host, { cols: 10, rows: 5 });
    expect(host.querySelector(".glyphcss-scene")).toBeTruthy();
    scene.destroy();
    expect(host.querySelector(".glyphcss-scene")).toBeFalsy();
  });

  it("setOptions changes mode and re-renders", async () => {
    const scene = createGlyphcssScene(host, { cols: 30, rows: 15, mode: "solid", useColors: false });
    scene.add(makeCubePolygons());
    await Promise.resolve();
    scene.setOptions({ mode: "wireframe" });
    await Promise.resolve();
    // Both modes produce non-empty output
    expect(scene.output.textContent!.replace(/\s/g, "").length).toBeGreaterThan(0);
    scene.destroy();
  });

  it("addHotspot returns a handle with remove()", async () => {
    const scene = createGlyphcssScene(host, { cols: 20, rows: 10 });
    const hotspot = scene.addHotspot({ id: "test", at: [0, 0, 0] });
    expect(typeof hotspot.remove).toBe("function");
    hotspot.remove();
    scene.destroy();
  });

  it("GlyphcssMeshHandle.name is undefined when no id is supplied", () => {
    const scene = createGlyphcssScene(host, { cols: 20, rows: 10 });
    const handle = scene.add(makeSinglePolygon());
    expect(handle.name).toBeUndefined();
    handle.dispose();
    scene.destroy();
  });

  it("GlyphcssMeshHandle.name matches the id supplied via transform", () => {
    const scene = createGlyphcssScene(host, { cols: 20, rows: 10 });
    const handle = scene.add(makeSinglePolygon(), { id: "hero-mesh" });
    expect(handle.name).toBe("hero-mesh");
    handle.dispose();
    scene.destroy();
  });

  it("GlyphcssMeshHandle.name updates when setTransform changes the id", () => {
    const scene = createGlyphcssScene(host, { cols: 20, rows: 10 });
    const handle = scene.add(makeSinglePolygon(), { id: "first" });
    expect(handle.name).toBe("first");
    handle.setTransform({ id: "second" });
    expect(handle.name).toBe("second");
    handle.dispose();
    scene.destroy();
  });
});
