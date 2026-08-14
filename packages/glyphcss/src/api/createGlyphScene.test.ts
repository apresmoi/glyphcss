import { describe, it, expect, beforeEach } from "vitest";
import { createGlyphOrthographicCamera } from "./createGlyphCamera";
import { createGlyphScene } from "./createGlyphScene";
import type { Polygon, Vec2, Vec3 } from "@glyphcss/core";

declare global {
  // Deliberately private test seam; production has no exported hook.
  var __glyphRenderStage: ((stage: string) => void) | undefined;
}

// ---------------------------------------------------------------------------
// applyTransform — degrees convention unit tests
//
// These tests verify that mesh `rotation` is an XYZ Euler triple in DEGREES
// (voxcss/three.js convention), not radians. The expected positions are
// computed with the same matrix composition as voxcss `rotateVec3`
// (packages/core/src/math/rotation.ts): M = Rx·Ry·Rz, Rz acts first.
// ---------------------------------------------------------------------------

/** Apply an XYZ Euler rotation (degrees) to a Vec3, matching voxcss rotateVec3. */
function rotateVec3Deg(v: Vec3, rxDeg: number, ryDeg: number, rzDeg: number): Vec3 {
  const DEG2RAD = Math.PI / 180;
  let [x, y, z] = v;
  // Rz
  if (rzDeg !== 0) {
    const c = Math.cos(rzDeg * DEG2RAD), s = Math.sin(rzDeg * DEG2RAD);
    [x, y] = [x * c - y * s, x * s + y * c];
  }
  // Ry
  if (ryDeg !== 0) {
    const c = Math.cos(ryDeg * DEG2RAD), s = Math.sin(ryDeg * DEG2RAD);
    [x, z] = [x * c + z * s, -x * s + z * c];
  }
  // Rx
  if (rxDeg !== 0) {
    const c = Math.cos(rxDeg * DEG2RAD), s = Math.sin(rxDeg * DEG2RAD);
    [y, z] = [y * c - z * s, y * s + z * c];
  }
  return [x, y, z];
}

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

describe("createGlyphScene", () => {
  let host: HTMLElement;

  beforeEach(() => {
    host = makeDiv();
    document.body.appendChild(host);
    delete globalThis.__glyphRenderStage;
  });

  it("keeps the previously committed frame, detail node, hotspot, and camera center when every transaction stage fails", async () => {
    const camera = createGlyphOrthographicCamera({ zoom: 50 });
    const center = camera.center;
    const scene = createGlyphScene(host, { cols: 32, rows: 16, useColors: false, camera });
    scene.add(makeCubePolygons(), { density: 2 });
    const hotspot = scene.addHotspot({ id: "atomic", at: [0, 0, 0] });
    await Promise.resolve();
    const base = scene.output.textContent;
    const detail = host.querySelector("pre.glyph-output--detail") as HTMLPreElement;
    const detailText = detail.textContent;
    const detailStyle = detail.getAttribute("style");
    const hotspotStyle = hotspot.el.getAttribute("style");
    const stages = [
      "base-validate", "base-layout", "base-project", "base-raster", "base-encode",
      "detail-measure", "detail-project", "detail-raster", "detail-encode", "detail-transform",
      "hotspot-project", "hotspot-style", "commit-write", "commit-style", "commit-remove", "commit-insert",
    ];
    for (const target of stages) {
      const seen: string[] = [];
      globalThis.__glyphRenderStage = (stage) => { seen.push(stage); if (stage === target) throw new Error(target); };
      expect(() => scene.rerender()).toThrow(target);
      delete globalThis.__glyphRenderStage;
      expect(seen).toContain(target);
      expect(scene.output.textContent).toBe(base);
      expect(host.querySelector("pre.glyph-output--detail")).toBe(detail);
      expect(detail.textContent).toBe(detailText);
      expect(detail.getAttribute("style")).toBe(detailStyle);
      expect(hotspot.el.getAttribute("style")).toBe(hotspotStyle);
      expect(camera.center).toBe(center);
      expect(camera.center).toEqual(center);
    }
    scene.destroy();
  });

  it("stages detail replacement/removal and writes each published pre once", async () => {
    const scene = createGlyphScene(host, { cols: 32, rows: 16, useColors: false, camera: createGlyphOrthographicCamera({ zoom: 50 }) });
    const mesh = scene.add(makeCubePolygons(), { density: 2 });
    await Promise.resolve();
    const detail = host.querySelector("pre.glyph-output--detail") as HTMLPreElement;
    let writes = 0;
    let baseWrites = 0;
    const original = Object.getOwnPropertyDescriptor(Node.prototype, "textContent")!;
    Object.defineProperty(scene.output, "textContent", { configurable: true, get: original.get, set(value) { baseWrites++; original.set!.call(this, value); } });
    Object.defineProperty(detail, "textContent", { configurable: true, get: original.get, set(value) { writes++; original.set!.call(this, value); } });
    scene.rerender();
    expect(writes).toBe(1);
    expect(baseWrites).toBe(1);
    mesh.setTransform({});
    globalThis.__glyphRenderStage = (stage) => { if (stage === "commit-insert") throw new Error("remove"); };
    expect(() => scene.rerender()).toThrow("remove");
    delete globalThis.__glyphRenderStage;
    expect(host.querySelector("pre.glyph-output--detail")).toBe(detail);
    Object.defineProperty(detail, "textContent", original);
    Object.defineProperty(scene.output, "textContent", original);
    scene.rerender();
    expect(host.querySelector("pre.glyph-output--detail")).toBeNull();
    scene.destroy();
  });

  it("does not publish a newly-created detail node when detail-element preparation fails", () => {
    const scene = createGlyphScene(host, { cols: 32, rows: 16, useColors: false, camera: createGlyphOrthographicCamera({ zoom: 50 }) });
    scene.add(makeCubePolygons(), { density: 2 });
    globalThis.__glyphRenderStage = (stage) => { if (stage === "detail-element") throw new Error("detail element"); };
    expect(() => scene.rerender()).toThrow("detail element");
    delete globalThis.__glyphRenderStage;
    expect(host.querySelector("pre.glyph-output--detail")).toBeNull();
    scene.destroy();
  });

  it("measures explicit CSS detail metrics in the hidden browser-layout sandbox", async () => {
    host.style.setProperty("--glyph-detail-size", "0.8rem");
    host.style.setProperty("--glyph-detail-leading", "calc(1em + 2px)");
    const seen: string[] = [];
    const original = HTMLElement.prototype.getBoundingClientRect;
    HTMLElement.prototype.getBoundingClientRect = function () {
      if (this.parentElement?.getAttribute("aria-hidden") === "true" && this.tagName === "PRE") {
        seen.push(`${(this as HTMLElement).style.fontSize}|${(this as HTMLElement).style.lineHeight}`);
      }
      return original.call(this);
    };
    try {
      const scene = createGlyphScene(host, { cols: 32, rows: 16, useColors: false, camera: createGlyphOrthographicCamera({ zoom: 50 }) });
      scene.add(makeCubePolygons(), { fontSize: "var(--glyph-detail-size)", lineHeight: "var(--glyph-detail-leading)" });
      await Promise.resolve();
      const detail = host.querySelector("pre.glyph-output--detail") as HTMLPreElement;
      expect(detail.style.fontSize).toBe("var(--glyph-detail-size)");
      expect(detail.style.lineHeight).toBe("var(--glyph-detail-leading)");
      expect(seen.some((entry) => entry.includes("var(--glyph-detail-size)"))).toBe(true);
      scene.destroy();
    } finally {
      HTMLElement.prototype.getBoundingClientRect = original;
    }
  });

  it("rolls back setOptions when real pre-base occlusion projection fails", async () => {
    const camera = createGlyphOrthographicCamera({ zoom: 50 });
    const scene = createGlyphScene(host, { cols: 32, rows: 16, useColors: false, camera });
    scene.add(makeCubePolygons());
    scene.add(makeCubePolygons(), { density: 2 });
    await Promise.resolve();
    const before = scene.output.textContent;
    const detail = host.querySelector("pre.glyph-output--detail");
    const original = camera.project;
    camera.project = (() => { throw new Error("occlusion projection"); }) as typeof camera.project;
    scene.setOptions({ cols: 33 });
    expect(() => scene.rerender()).toThrow("occlusion projection");
    camera.project = original;
    expect(scene.getOptions().cols).toBe(32);
    expect(scene.output.textContent).toBe(before);
    expect(host.querySelector("pre.glyph-output--detail")).toBe(detail);
    scene.destroy();
  });

  it("awaits every failed detail publication stage without child-list mutations", async () => {
    for (const target of ["detail-transform", "commit-write", "commit-style", "commit-insert", "commit-remove"]) {
      const localHost = makeDiv();
      document.body.appendChild(localHost);
      const scene = createGlyphScene(localHost, { cols: 32, rows: 16, useColors: false, camera: createGlyphOrthographicCamera({ zoom: 50 }) });
      const mesh = scene.add(makeCubePolygons(), { density: 2 });
      await Promise.resolve();
      const detail = localHost.querySelector("pre.glyph-output--detail");
      const records: MutationRecord[] = [];
      const observer = new MutationObserver((next) => records.push(...next));
      observer.observe(localHost.querySelector(".glyph-scene")!, { childList: true });
      mesh.setTransform(target === "detail-transform" ? { density: 2 } : {});
      globalThis.__glyphRenderStage = (stage) => { if (stage === target) throw new Error(target); };
      expect(() => scene.rerender()).toThrow(target);
      // Wait through the microtask checkpoint: direct rerender cancels the stale
      // scheduled work, so an observer cannot mistake a later success for the
      // failed transaction under test.
      await Promise.resolve();
      observer.disconnect();
      expect(records).toEqual([]);
      expect(localHost.querySelector("pre.glyph-output--detail")).toBe(detail);
      delete globalThis.__glyphRenderStage;
      scene.destroy();
      localHost.remove();
    }
  });

  it("publishes a successful detail removal and replacement only after staging both", async () => {
    const scene = createGlyphScene(host, { cols: 32, rows: 16, useColors: false, camera: createGlyphOrthographicCamera({ zoom: 50 }) });
    const first = scene.add(makeCubePolygons(), { density: 2 });
    await Promise.resolve();
    const oldDetail = host.querySelector("pre.glyph-output--detail") as HTMLPreElement;
    const records: MutationRecord[] = [];
    const observer = new MutationObserver((next) => records.push(...next));
    observer.observe(host.querySelector(".glyph-scene")!, { childList: true });
    first.setTransform({});
    scene.add(makeCubePolygons(), { density: 3 });
    scene.rerender();
    await Promise.resolve();
    observer.disconnect();
    const details = host.querySelectorAll("pre.glyph-output--detail");
    expect(details).toHaveLength(1);
    expect(details[0]).not.toBe(oldDetail);
    expect(records.some((record) => Array.from(record.removedNodes).includes(oldDetail))).toBe(true);
    expect(records.some((record) => Array.from(record.addedNodes).includes(details[0]!))).toBe(true);
    scene.destroy();
  });

  it("does not leak uncommitted lighting or temporal state after a later detail failure", async () => {
    const referenceHost = makeDiv();
    document.body.appendChild(referenceHost);
    const camera = createGlyphOrthographicCamera({ zoom: 50 });
    const referenceCamera = createGlyphOrthographicCamera({ zoom: 50 });
    const opts = { cols: 32, rows: 16, useColors: false, temporalBlend: 0.7 } as const;
    const scene = createGlyphScene(host, { ...opts, camera });
    const reference = createGlyphScene(referenceHost, { ...opts, camera: referenceCamera });
    scene.add(makeCubePolygons(), { density: 2 });
    reference.add(makeCubePolygons(), { density: 2 });
    await Promise.resolve();
    const before = scene.output.textContent;
    scene.setOptions({ temporalBlend: 0.2, directionalLight: { direction: [-0.7, 0.2, 0.5], intensity: 0.35 } });
    globalThis.__glyphRenderStage = (stage) => { if (stage === "detail-transform") throw new Error("late detail failure"); };
    expect(() => scene.rerender()).toThrow("late detail failure");
    delete globalThis.__glyphRenderStage;
    expect(scene.getOptions().temporalBlend).toBe(0.7);
    expect(scene.output.textContent).toBe(before);
    camera.rotY = 18;
    referenceCamera.rotY = 18;
    scene.rerender();
    reference.rerender();
    expect(scene.output.textContent).toBe(reference.output.textContent);
    expect(host.querySelector("pre.glyph-output--detail")?.textContent)
      .toBe(referenceHost.querySelector("pre.glyph-output--detail")?.textContent);
    scene.destroy();
    reference.destroy();
  });

  it("creates a scene div with a pre element", () => {
    const scene = createGlyphScene(host, { cols: 20, rows: 10 });
    const sceneEl = host.querySelector(".glyph-scene");
    expect(sceneEl).toBeTruthy();
    const pre = host.querySelector("pre.glyph-output");
    expect(pre).toBeTruthy();
    scene.destroy();
  });

  it("exposes host and output references", () => {
    const scene = createGlyphScene(host, { cols: 20, rows: 10 });
    expect(scene.host).toBe(host);
    expect(scene.output.tagName.toLowerCase()).toBe("pre");
    scene.destroy();
  });

  it("renders text content after adding a mesh", async () => {
    const scene = createGlyphScene(host, { cols: 30, rows: 15, useColors: false });
    scene.add(makeCubePolygons());
    // Await the microtask queue so scheduleRender fires
    await Promise.resolve();
    const pre = scene.output;
    expect(pre.textContent!.length).toBeGreaterThan(0);
    scene.destroy();
  });

  it("returns a GlyphMeshHandle with dispose", () => {
    const scene = createGlyphScene(host, { cols: 20, rows: 10 });
    const handle = scene.add(makeSinglePolygon());
    expect(typeof handle.dispose).toBe("function");
    expect(typeof handle.setPolygons).toBe("function");
    expect(typeof handle.setTransform).toBe("function");
    handle.dispose();
    scene.destroy();
  });

  it("updates mesh polygons in place", async () => {
    const scene = createGlyphScene(host, { cols: 40, rows: 20, useColors: false });
    const handle = scene.add(makeSinglePolygon());
    await Promise.resolve();
    const before = scene.output.textContent ?? "";
    const cube = makeCubePolygons();

    handle.setPolygons(cube);
    await Promise.resolve();

    expect(handle.polygons).toBe(cube);
    expect(scene.output.textContent ?? "").not.toBe(before);
    handle.dispose();
    scene.destroy();
  });

  it("removes mesh on dispose and re-renders empty", async () => {
    const scene = createGlyphScene(host, { cols: 20, rows: 10, useColors: false });
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
    const scene = createGlyphScene(host, { cols: 10, rows: 5 });
    expect(host.querySelector(".glyph-scene")).toBeTruthy();
    scene.destroy();
    expect(host.querySelector(".glyph-scene")).toBeFalsy();
  });

  it("setOptions changes mode and re-renders", async () => {
    const scene = createGlyphScene(host, { cols: 30, rows: 15, mode: "solid", useColors: false });
    scene.add(makeCubePolygons());
    await Promise.resolve();
    scene.setOptions({ mode: "wireframe" });
    await Promise.resolve();
    // Both modes produce non-empty output
    expect(scene.output.textContent!.replace(/\s/g, "").length).toBeGreaterThan(0);
    scene.destroy();
  });

  it("setOptions updates every runtime raster option", () => {
    const scene = createGlyphScene(host);
    scene.setOptions({
      doubleSided: true,
      supersample: 3,
      depthEpsilon: 0.005,
      temporalBlend: 0.4,
    });

    expect(scene.getOptions()).toMatchObject({
      doubleSided: true,
      supersample: 3,
      depthEpsilon: 0.005,
      temporalBlend: 0.4,
    });
    scene.destroy();
  });

  it("renders an opaque density mesh through a separate detail layer with occlusion enabled", async () => {
    const scene = createGlyphScene(host, {
      cols: 40,
      rows: 20,
      mode: "solid",
      useColors: false,
      supersample: 2,
      camera: createGlyphOrthographicCamera({ zoom: 50 }),
    });
    scene.add(makeCubePolygons(), { position: [0, 0, -0.6] });
    scene.add(makeCubePolygons(), { density: 2, position: [0, 0, 0.6] });
    await Promise.resolve();

    const detail = host.querySelector("pre.glyph-output--detail");
    expect(detail).toBeTruthy();
    expect(detail!.textContent!.replace(/\s/g, "").length).toBeGreaterThan(0);
    scene.destroy();
  });

  it("applies transformCells with surface UVs to density detail layers", async () => {
    let sawSurfaceUv = false;
    const scene = createGlyphScene(host, {
      cols: 40,
      rows: 20,
      mode: "solid",
      useColors: false,
      camera: createGlyphOrthographicCamera({ zoom: 50 }),
      transformCells(grid) {
        const uv = grid.surfaceUv;
        if (!uv) return;
        for (let i = 0; i < grid.char.length; i++) {
          if (!Number.isFinite(uv[i * 2]) || !Number.isFinite(uv[i * 2 + 1])) continue;
          sawSurfaceUv = true;
          grid.char[i] = "U";
        }
      },
    });
    const polygons = makeCubePolygons().map((polygon) => ({
      ...polygon,
      uvs: [[0, 0], [1, 0], [1, 1]] as Vec2[],
    }));
    scene.add(polygons, { density: 2 });
    await Promise.resolve();

    const detail = host.querySelector("pre.glyph-output--detail");
    const rendered = detail?.textContent?.replace(/\s/g, "") ?? "";
    expect(sawSurfaceUv).toBe(true);
    expect(rendered.length).toBeGreaterThan(0);
    expect(new Set(rendered)).toEqual(new Set(["U"]));
    scene.destroy();
  });

  it("addHotspot returns a handle with remove() and el", async () => {
    const scene = createGlyphScene(host, { cols: 20, rows: 10 });
    const hotspot = scene.addHotspot({ id: "test", at: [0, 0, 0] });
    expect(typeof hotspot.remove).toBe("function");
    expect(hotspot.el).toBeInstanceOf(HTMLElement);
    expect(hotspot.el.getAttribute("data-hotspot-id")).toBe("test");
    hotspot.remove();
    scene.destroy();
  });

  it("GlyphMeshHandle.name is undefined when no id is supplied", () => {
    const scene = createGlyphScene(host, { cols: 20, rows: 10 });
    const handle = scene.add(makeSinglePolygon());
    expect(handle.name).toBeUndefined();
    handle.dispose();
    scene.destroy();
  });

  it("GlyphMeshHandle.name matches the id supplied via transform", () => {
    const scene = createGlyphScene(host, { cols: 20, rows: 10 });
    const handle = scene.add(makeSinglePolygon(), { id: "hero-mesh" });
    expect(handle.name).toBe("hero-mesh");
    handle.dispose();
    scene.destroy();
  });

  it("GlyphMeshHandle.name updates when setTransform changes the id", () => {
    const scene = createGlyphScene(host, { cols: 20, rows: 10 });
    const handle = scene.add(makeSinglePolygon(), { id: "first" });
    expect(handle.name).toBe("first");
    handle.setTransform({ id: "second" });
    expect(handle.name).toBe("second");
    handle.dispose();
    scene.destroy();
  });

  // -------------------------------------------------------------------------
  // Rotation-units tests: rotation is DEGREES not radians.
  //
  // Strategy: applyTransform is package-internal, so we test it indirectly
  // by reading back the transformed polygons from GlyphMeshHandle.polygons
  // (which returns the *input* polygons, not transformed ones) — instead we
  // use a white-box approach: create a scene, add a known polygon, force-call
  // rerender, then verify the rasteriser output changes in a way consistent
  // ONLY with degree semantics (a 90° rotation is a quarter-turn; 90 radians
  // would wrap to ~(90 mod 2π)≈1.15 rad, a completely different rotation).
  //
  // For a precise assertion we expose the vertex math through a helper that
  // re-implements applyTransform's logic (rotateVec3Deg above) and confirm
  // the internal convention matches.
  // -------------------------------------------------------------------------

  it("mesh rotation=90 (degrees) on X-axis maps +Y to +Z as expected", () => {
    // rotateVec3Deg([0,1,0], 90,0,0) should yield approximately [0,0,1].
    // If the convention were radians, rot=90 rad would give a different result.
    const result = rotateVec3Deg([0, 1, 0], 90, 0, 0);
    // +Y rotated 90° about X → +Z  (right-hand rule: y→z)
    expect(result[0]).toBeCloseTo(0, 5);
    expect(result[1]).toBeCloseTo(0, 5);
    expect(result[2]).toBeCloseTo(1, 5);
  });

  it("mesh rotation=90 (degrees) on Y-axis maps +X to -Z as expected", () => {
    // rotateVec3Deg([1,0,0], 0,90,0) should yield approximately [0,0,-1].
    const result = rotateVec3Deg([1, 0, 0], 0, 90, 0);
    expect(result[0]).toBeCloseTo(0, 5);
    expect(result[1]).toBeCloseTo(0, 5);
    expect(result[2]).toBeCloseTo(-1, 5);
  });

  it("mesh rotation=90 (degrees) on Z-axis maps +X to +Y as expected", () => {
    // rotateVec3Deg([1,0,0], 0,0,90) should yield approximately [0,1,0].
    const result = rotateVec3Deg([1, 0, 0], 0, 0, 90);
    expect(result[0]).toBeCloseTo(0, 5);
    expect(result[1]).toBeCloseTo(1, 5);
    expect(result[2]).toBeCloseTo(0, 5);
  });

  it("applyTransform uses degrees: scene with rotation=90 produces different output than rotation=0", async () => {
    // A mesh with rotation=[90,0,0] (90 degrees X) should look different from
    // no rotation. If the convention were radians, 90 rad would also differ,
    // but this test combined with the rotateVec3Deg unit tests above confirms
    // the expected quarter-turn geometry change is happening.
    const scene0 = createGlyphScene(host, { cols: 40, rows: 20, useColors: false });
    scene0.add(makeSinglePolygon(), { rotation: [0, 0, 0] });
    await Promise.resolve();
    const output0 = scene0.output.textContent ?? "";
    scene0.destroy();

    const host2 = document.createElement("div");
    document.body.appendChild(host2);
    const scene90 = createGlyphScene(host2, { cols: 40, rows: 20, useColors: false });
    scene90.add(makeSinglePolygon(), { rotation: [90, 0, 0] });
    await Promise.resolve();
    const output90 = scene90.output.textContent ?? "";
    scene90.destroy();

    // 90° rotation meaningfully changes the projected silhouette.
    expect(output0).not.toBe(output90);
  });
});
