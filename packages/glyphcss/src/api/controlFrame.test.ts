import { describe, expect, it } from "vitest";
import type { Polygon } from "@glyphcss/core";
import { createGlyphOrthographicCamera, createGlyphPerspectiveCamera } from "./createGlyphCamera";
import { compileScene } from "./compileScene";
import { encodeGlyphBuffers } from "../render/cells";
import { buildRasterizeContext } from "./rasterizeContext";
import { rasterize, rasterizeToCells } from "../render/rasterize";
import { buildGlyphControlFrame, computeGlyphControlContentSha256, computeGlyphControlGeometryHashes, type GlyphControlSceneManifest, type GlyphObjectDictionary } from "./controlFrame";

const hash = (digit: string) => digit.repeat(64);
const dictionaryBase: Omit<GlyphObjectDictionary, "contentSha256"> = {
  schemaVersion: "glyph-object-dictionary/v2",
  id: "dictionary/test-v1",
  font: { id: "font/test", version: "1", sha256: hash("b") },
  classes: [
    { id: 1, name: "cube", semanticGlyph: "A", controlColor: "#e63946" },
    { id: 2, name: "floor", semanticGlyph: "B", controlColor: "#457b9d" },
  ],
};
const dictionary: GlyphObjectDictionary = { ...dictionaryBase, contentSha256: computeGlyphControlContentSha256(dictionaryBase) };

function quad(z: number, x0 = -1, x1 = 1, color = "#ffffff"): Polygon {
  return { vertices: [[x0, -1, z], [x0, 1, z], [x1, 1, z], [x1, -1, z]], color };
}

function manifest(surfaceIds: string[], sameClass = false): GlyphControlSceneManifest {
  const instances = surfaceIds.map((_, index) => ({ id: `instance/test-${index}`, classId: sameClass ? 1 : (index % 2) + 1 }));
  return {
    schemaVersion: "control-scene/v1",
    id: "scene/test",
    dictionaryId: dictionary.id,
    dictionarySha256: dictionary.contentSha256,
    geometrySha256: hash("c"),
    polygonOrderSha256: hash("d"),
    contentSha256: hash("e"),
    instances,
    surfaces: surfaceIds.map((id, index) => ({ id, instanceId: instances[index]!.id })),
    polygonSurfaceIds: surfaceIds,
  };
}

function sealScene(scene: GlyphControlSceneManifest, polygons: readonly Polygon[]): GlyphControlSceneManifest {
  const hashes = computeGlyphControlGeometryHashes(polygons);
  const unsigned = { ...scene, dictionarySha256: dictionary.contentSha256, ...hashes, contentSha256: "" };
  return { ...unsigned, contentSha256: computeGlyphControlContentSha256(unsigned) };
}

function frame(polygons: Polygon[], scene = manifest(polygons.map((_, index) => `surface/test-${index}`)), perspective = false, supersample = 1) {
  const sealedScene = sealScene(scene, polygons);
  return buildGlyphControlFrame({
    polygons,
    scene: sealedScene,
    dictionary,
    camera: perspective
      ? createGlyphPerspectiveCamera({ rotX: 0, rotY: 0, perspective: 500, zoom: 100 })
      : createGlyphOrthographicCamera({ rotX: 0, rotY: 0, zoom: 160 }),
    grid: { cols: 32, rows: 24, cellAspect: 2 },
    doubleSided: true,
    supersample,
    directionalLight: { direction: [0, 0, 1], intensity: 0 },
    ambientLight: { intensity: 1 },
  });
}

function rawAscii(chars: readonly string[], cols: number, rows: number): string {
  return Array.from({ length: rows }, (_, row) => chars.slice(row * cols, (row + 1) * cols).join("")).join("\n");
}

function cameraProjectionSnapshot(camera: ReturnType<typeof createGlyphOrthographicCamera> | ReturnType<typeof createGlyphPerspectiveCamera>) {
  return {
    kind: camera.kind,
    rotX: camera.rotX,
    rotY: camera.rotY,
    center: [...camera.center],
    mat: camera.mat ? [...camera.mat] : null,
    useMat: camera.useMat,
    distance: camera.distance,
    perspective: camera.perspective,
    zoom: camera.zoom,
    stretch: camera.stretch,
    fovScale: camera.fovScale,
    target: [...camera.target],
    eyeMode: camera.eyeMode,
  };
}

describe("buildGlyphControlFrame", () => {
  it("uses a supplied texture sampler on the depth-winning cell", () => {
    const polygons = [{
      vertices: [[-1, -1, 0], [1, -1, 0], [-1, 1, 0]],
      uvs: [[0, 0], [1, 0], [0, 1]],
      texture: "memory://checker",
      color: "#ffffff",
    }];
    const scene = sealScene(manifest(["surface/test-0"]), polygons);
    const textured = buildGlyphControlFrame({
      polygons,
      scene,
      dictionary,
      camera: createGlyphOrthographicCamera({ zoom: 160 }),
      grid: { cols: 4, rows: 4, cellAspect: 2 },
      doubleSided: true,
      textureSamplers: new Map([["memory://checker", { width: 1, height: 1, data: new Uint8Array([12, 34, 56, 255]), lowDetail: false }]]),
    });
    const flat = buildGlyphControlFrame({
      polygons, scene, dictionary, camera: createGlyphOrthographicCamera({ zoom: 160 }),
      grid: { cols: 4, rows: 4, cellAspect: 2 }, doubleSided: true,
    });
    expect([...textured.visibleColor]).not.toEqual([...flat.visibleColor]);
    expect(textured.albedoRgb.some((color) => color === 0x0c2238)).toBe(true);
    expect(textured.targetRgb.some((color) => color !== 0 && color !== 0x0c2238)).toBe(true);
  });
  it("keeps albedo lighting-invariant while the final target uses colored per-cell light and the authored base factor", () => {
    const polygons: Polygon[] = [{ vertices: [[-1, -1, 0], [1, -1, 0], [-1, 1, 0]], uvs: [[0, 0], [1, 0], [0, 1]], texture: "memory://factor", color: "#8080ff" }];
    const result = buildGlyphControlFrame({
      polygons, scene: sealScene(manifest(["surface/test-0"]), polygons), dictionary,
      camera: createGlyphOrthographicCamera({ zoom: 120 }), grid: { cols: 8, rows: 8, cellAspect: 2 }, doubleSided: true,
      textureSamplers: new Map([["memory://factor", { width: 1, height: 1, data: new Uint8Array([200, 100, 50, 255]), lowDetail: false }]]),
      directionalLight: { direction: [0, 0, 1], intensity: 0, color: "#0000ff" }, ambientLight: { intensity: .5, color: "#ff0000" },
    });
    const covered = Array.from(result.coverage).findIndex(Boolean);
    expect(result.albedoRgb[covered]).toBe(0x643232);
    expect(result.targetRgb[covered]).toBe(0x320000);
  });
  it("keeps textured RGB and every control field on the same depth winner at corpus supersample one", () => {
    const polygons: Polygon[] = [
      { vertices: [[-1, -1, 0], [1, -1, 0], [-1, 1, 0]], uvs: [[0, 0], [1, 0], [0, 1]], texture: "memory://rear", color: "#ffffff" },
      { vertices: [[-1, -1, 1], [1, -1, 1], [-1, 1, 1]], uvs: [[0, 0], [1, 0], [0, 1]], texture: "memory://front", color: "#ffffff" },
    ];
    const scene = sealScene(manifest(["surface/rear", "surface/front"]), polygons);
    const result = buildGlyphControlFrame({
      polygons, scene, dictionary, camera: createGlyphOrthographicCamera({ zoom: 120 }),
      grid: { cols: 8, rows: 8, cellAspect: 2 }, doubleSided: true, supersample: 1,
      textureSamplers: new Map([
        ["memory://rear", { width: 1, height: 1, data: new Uint8Array([12, 34, 56, 255]), lowDetail: false }],
        ["memory://front", { width: 1, height: 1, data: new Uint8Array([210, 120, 40, 255]), lowDetail: false }],
      ]),
      directionalLight: { direction: [0, 0, 1], intensity: 0 }, ambientLight: { intensity: 1 },
    });
    const covered = Array.from(result.coverage).findIndex(Boolean);
    expect(covered).toBeGreaterThanOrEqual(0);
    expect(result.metadata.supersample).toBe(1);
    expect(result.winnerPolygon[covered]).toBe(1);
    expect(result.visibleColor[covered]! & 0xffffff).toBe(0xd27828);
    expect(result.targetRgb[covered]).toBe(0xd27828);
    expect(result.albedoRgb[covered]).toBe(0xd27828);
    expect(result.surfaceLookup[result.surfaceId[covered]!]).toBe("surface/front");
    expect(result.instanceLookup[result.instanceId[covered]!]).toBe("instance/test-1");
    expect(result.classId[covered]).toBe(2);
    expect(Number.isFinite(result.depth[covered]!)).toBe(true);
    expect(Number.isFinite(result.surfaceUv[covered * 2]!)).toBe(true);
  });
  it("retains an opaque black texture winner even when presentation is a space", () => {
    const polygons: Polygon[] = [{ vertices: [[-1, -1, 0], [1, -1, 0], [-1, 1, 0]], uvs: [[0, 0], [1, 0], [0, 1]], texture: "memory://black", color: "#ffffff" }];
    const result = buildGlyphControlFrame({
      polygons, scene: sealScene(manifest(["surface/test-0"]), polygons), dictionary,
      camera: createGlyphOrthographicCamera({ zoom: 120 }), grid: { cols: 8, rows: 8, cellAspect: 2 }, doubleSided: true,
      textureSamplers: new Map([["memory://black", { width: 1, height: 1, data: new Uint8Array([0, 0, 0, 255]), lowDetail: false }]]),
      directionalLight: { direction: [0, 0, 1], intensity: 0 }, ambientLight: { intensity: 0 },
    });
    const covered = Array.from(result.coverage).findIndex(Boolean);
    expect(covered).toBeGreaterThanOrEqual(0);
    expect(result.targetRgb[covered]).toBe(0);
    expect(result.visibleAscii.replace(/\n/g, "")[covered]).toBe(" ");
  });
  it("hashes texture identity rather than treating distinct references as equivalent geometry", () => {
    const one: Polygon[] = [{ vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0]], uvs: [[0, 0], [1, 0], [0, 1]], texture: "glyph-node-texture://" + "a".repeat(64) }];
    const two: Polygon[] = [{ ...one[0]!, texture: "glyph-node-texture://" + "b".repeat(64) }];
    expect(computeGlyphControlGeometryHashes(one)).not.toEqual(computeGlyphControlGeometryHashes(two));
  });
  it("canonicalizes cross-platform sub-ULP geometry noise without hiding meaningful changes", () => {
    const polygon = (y: number): Polygon[] => [{ vertices: [[0, y, 0], [1, 0, 0], [0, 1, 0]], color: "#ffffff" }];
    const darwin = computeGlyphControlGeometryHashes(polygon(-0.5419498956652755));
    const linux = computeGlyphControlGeometryHashes(polygon(-0.5419498956652756));
    const changed = computeGlyphControlGeometryHashes(polygon(-0.5419498957652755));
    expect(linux).toEqual(darwin);
    expect(darwin).toEqual({
      geometrySha256: "b609e968075c721ae8b20d408908735f3c2a028a817b7c1f51a0872ffe22d15d",
      polygonOrderSha256: "b609e968075c721ae8b20d408908735f3c2a028a817b7c1f51a0872ffe22d15d",
    });
    expect(changed).not.toEqual(darwin);
  });

  it("rejects sparse polygon, vertex, and UV arrays before geometry hashing", () => {
    const sparsePolygons = new Array(2) as Polygon[];
    sparsePolygons[0] = quad(0);
    expect(() => computeGlyphControlGeometryHashes(sparsePolygons)).toThrow(/dense arrays/);
    const sparseVertices = new Array(3);
    sparseVertices[0] = [0, 0, 0];
    sparseVertices[2] = [0, 1, 0];
    expect(() => computeGlyphControlGeometryHashes([{ ...quad(0), vertices: sparseVertices } as unknown as Polygon])).toThrow(/dense arrays/);
    const sparseUv = new Array(3);
    sparseUv[0] = [0, 0];
    sparseUv[2] = [0, 1];
    expect(() => computeGlyphControlGeometryHashes([{ ...quad(0), uvs: sparseUv } as unknown as Polygon])).toThrow(/dense arrays/);
  });

  it("uses the B31 canonical SHA-256 definition deterministically", () => {
    expect(computeGlyphControlContentSha256({ value: "abc" })).toBe("afef793fc69ce78450c4c66b8d52dd7c7779bfa4871c521469741f22d5dde564");
    const sparse = new Array(3);
    sparse[0] = 1;
    sparse[2] = 3;
    expect(() => computeGlyphControlContentSha256({ value: sparse })).toThrow(/dense arrays/);
  });

  it("keeps raw visible and semantic text distinct while the shared encoder preserves raw DOM text", () => {
    const result = frame([quad(0, -1.2, -0.1, "#00ff00"), quad(0, 0.1, 1.2, "#0000ff")]);
    expect(result.visibleAscii).not.toBe(result.semanticAscii);
    expect(result.visibleAscii).not.toContain("<span");
    expect(result.semanticAscii).not.toContain("<span");
    const visible = document.createElement("pre");
    visible.innerHTML = encodeGlyphBuffers([...result.visibleAscii.replace(/\n/g, "")], Array.from(result.visibleColor, (color) => color ? `#${(color & 0xffffff).toString(16).padStart(6, "0")}` : null), 32, 24, true);
    const semantic = document.createElement("pre");
    semantic.innerHTML = encodeGlyphBuffers([...result.semanticAscii.replace(/\n/g, "")], Array.from(result.semanticColor, (color) => color ? `#${(color & 0xffffff).toString(16).padStart(6, "0")}` : null), 32, 24, true);
    expect(visible.textContent).toBe(result.visibleAscii);
    expect(semantic.textContent).toBe(result.semanticAscii);
    expect(result.visibleColor.some((color) => color === 0xff000000)).toBe(false);
    expect(result.semanticColor.some((color) => color === 0xffe63946)).toBe(true);
  });

  it("keeps depth winners and lineage aligned for orthographic, perspective, adjacent, overlap, and supersampled frames", () => {
    for (const result of [
      frame([quad(0), quad(1)]),
      frame([quad(-2), quad(0)], undefined, true),
      frame([quad(0, -1.4, -0.1), quad(0, 0.1, 1.4)]),
      frame([quad(0), quad(1)], undefined, false, 2),
    ]) {
      for (let index = 0; index < result.coverage.length; index++) {
        if (!result.coverage[index]) {
          expect(result.winnerPolygon[index]).toBe(-1);
          expect(result.classId[index]).toBe(-1);
          continue;
        }
        const winner = result.winnerPolygon[index]!;
        expect(winner).toBeGreaterThanOrEqual(0);
        expect(result.classId[index]).toBeGreaterThan(0);
        expect(result.instanceId[index]).toBeGreaterThanOrEqual(0);
        expect(result.surfaceId[index]).toBeGreaterThanOrEqual(0);
        expect(result.semanticAscii.replace(/\n/g, "")[index]).toBe(winner === 0 ? "A" : "B");
      }
    }
  });

  it("allows multi-polygon surfaces and repeated classes while preserving distinct instance and surface indices", () => {
    const baseShared = manifest(["surface/shared", "surface/shared"]);
    const shared: GlyphControlSceneManifest = {
      ...baseShared,
      instances: [{ id: "instance/shared", classId: 1 }],
      surfaces: [{ id: "surface/shared", instanceId: "instance/shared" }],
    };
    const multi = frame([quad(0, -1.4, -0.1), quad(0, 0.1, 1.4)], shared);
    expect(new Set(Array.from(multi.surfaceId).filter((value) => value >= 0))).toEqual(new Set([0]));

    const repeated = frame([quad(0, -1.4, -0.1), quad(0, 0.1, 1.4)], manifest(["surface/left", "surface/right"], true));
    expect(new Set(Array.from(repeated.classId).filter((value) => value >= 0))).toEqual(new Set([1]));
    expect(new Set(Array.from(repeated.instanceId).filter((value) => value >= 0)).size).toBe(2);
    expect(new Set(Array.from(repeated.surfaceId).filter((value) => value >= 0)).size).toBe(2);
  });

  it("uses durable copies, deterministic lexical lookup tables, and empty sentinels", () => {
    const empty = frame([quad(0, 100, 101)]);
    expect(empty.visibleAscii).toBe(Array(24).fill(" ".repeat(32)).join("\n"));
    expect(Array.from(empty.winnerPolygon).every((value) => value === -1)).toBe(true);
    expect(Array.from(empty.coverage).every((value) => value === 0)).toBe(true);
    expect(Array.from(empty.classId).every((value) => value === -1)).toBe(true);

    const scene = manifest(["surface/z", "surface/a"], true);
    const result = frame([quad(0, -1.4, -0.1), quad(0, 0.1, 1.4)], scene);
    expect(result.surfaceLookup).toEqual(["surface/a", "surface/z"]);
    expect(result.instanceLookup).toEqual(["instance/test-0", "instance/test-1"]);
    result.winnerPolygon[0] = 99;
    result.metadata.scene.polygonSurfaceIds[0] = "surface/mutated";
    const next = frame([quad(0, -1.4, -0.1), quad(0, 0.1, 1.4)], scene);
    expect(next.winnerPolygon[0]).not.toBe(99);
    expect(next.metadata.scene.polygonSurfaceIds[0]).toBe("surface/z");
    expect(scene.polygonSurfaceIds[0]).toBe("surface/z");
  });

  it("rejects inconsistent or unknown immutable metadata", () => {
    expect(() => frame([quad(0)], { ...manifest(["surface/missing"]), surfaces: [] })).toThrow(/nonempty/);
    expect(() => frame([quad(0)], { ...manifest(["surface/test-0"]), polygonSurfaceIds: [] })).toThrow(/exactly match/);
    expect(() => buildGlyphControlFrame({
      polygons: [quad(0)], scene: manifest(["surface/test-0"]), dictionary,
      camera: createGlyphOrthographicCamera(), grid: { cols: 2, rows: 2, cellAspect: 2 }, mode: "wireframe",
    })).toThrow(/solid mode/);
  });

  it("rejects stale, reordered, or changed polygon geometry before rasterization", () => {
    const polygons = [quad(0, -1.2, -0.1), quad(0, 0.1, 1.2)];
    const scene = sealScene(manifest(["surface/test-0", "surface/test-1"]), polygons);
    expect(() => buildGlyphControlFrame({ polygons: [...polygons].reverse(), scene, dictionary, camera: createGlyphOrthographicCamera(), grid: { cols: 4, rows: 4, cellAspect: 2 } })).toThrow(/geometry hashes/);
    expect(() => buildGlyphControlFrame({ polygons: [{ ...polygons[0]!, vertices: [[-2, -1, 0], [-2, 1, 0], [-0.1, 1, 0], [-0.1, -1, 0]] }, polygons[1]!], scene, dictionary, camera: createGlyphOrthographicCamera(), grid: { cols: 4, rows: 4, cellAspect: 2 } })).toThrow(/geometry hashes/);
    expect(() => buildGlyphControlFrame({ polygons, scene: { ...scene, contentSha256: "0".repeat(64) }, dictionary, camera: createGlyphOrthographicCamera(), grid: { cols: 4, rows: 4, cellAspect: 2 } })).toThrow(/contentSha256/);
  });

  it.each(["orthographic", "perspective"] as const)("isolates every %s projection field while matching a direct control-frame raster", (kind) => {
    const camera = kind === "perspective"
      ? createGlyphPerspectiveCamera({ rotX: 13, rotY: 21, perspective: 700, distance: 19, zoom: 80, stretch: 1.3, fovScale: 0.73, center: [0.3, 0.7], mat: [1, 0, 0, 0, 1, 0, 0, 0, 1], useMat: true })
      : createGlyphOrthographicCamera({ rotX: 13, rotY: 21, zoom: 80, center: [0.3, 0.7], mat: [1, 0, 0, 0, 1, 0, 0, 0, 1], useMat: true });
    if (kind === "orthographic") { camera.distance = 19; camera.stretch = 1.3; camera.fovScale = 0.73; }
    camera.target = [0.1, 0.2, 0.3]; camera.eyeMode = true;
    const polygons = [quad(0)];
    const scene = sealScene(manifest(["surface/test-0"]), polygons);
    const options = { polygons, scene, dictionary, camera, grid: { cols: 32, rows: 24, cellAspect: 2 }, doubleSided: true, ambientLight: { intensity: 1 } };
    const before = cameraProjectionSnapshot(camera);
    const captured = buildGlyphControlFrame(options);
    const after = cameraProjectionSnapshot(camera);
    expect(after).toEqual(before);
    expect((camera as unknown as { __glyphScratch?: unknown }).__glyphScratch).toBeUndefined();
    const direct = rasterizeToCells(buildRasterizeContext({ ...options, mode: "solid", useColors: true, retainWinnerPolygon: true, retainShade: true, retainWorldPosition: true, retainNormal: true }));
    const directVisibleAscii = rawAscii(direct.char, direct.cols, direct.rows);
    const directHash = computeGlyphControlContentSha256({ visibleAscii: directVisibleAscii, winnerPolygon: Array.from(direct.winnerPolygon!) });
    const capturedHash = computeGlyphControlContentSha256({ visibleAscii: captured.visibleAscii, winnerPolygon: Array.from(captured.winnerPolygon) });
    expect(captured.visibleAscii).toBe(directVisibleAscii);
    expect(captured.winnerPolygon).toEqual(direct.winnerPolygon);
    expect(capturedHash).toBe(directHash);
    expect(captured.coverage.some((value) => value === 1)).toBe(true);
    expect(captured.metadata.camera).toMatchObject({ ...before, target: [0.1, 0.2, 0.3], fovScale: 0.73, stretch: 1.3 });
  });

  it("rejects own enumerable extras in every B31/B4 lineage record", () => {
    const polygons = [quad(0)];
    const scene = sealScene(manifest(["surface/test-0"]), polygons);
    const opts = { polygons, scene, dictionary, camera: createGlyphOrthographicCamera(), grid: { cols: 2, rows: 2, cellAspect: 2 } };
    const extra = { unexpected: true };
    for (const [label, changed] of [
      ["dictionary", { ...dictionary, ...extra }],
      ["font", { ...dictionary, font: { ...dictionary.font, ...extra } }],
      ["class", { ...dictionary, classes: [{ ...dictionary.classes[0]!, ...extra }, dictionary.classes[1]! ] }],
    ] as const) expect(() => buildGlyphControlFrame({ ...opts, dictionary: changed })).toThrow(new RegExp(label));
    for (const [label, changed] of [
      ["scene", { ...scene, ...extra }],
      ["instance", { ...scene, instances: [{ ...scene.instances[0]!, ...extra }, ...scene.instances.slice(1)] }],
      ["surface", { ...scene, surfaces: [{ ...scene.surfaces[0]!, ...extra }, ...scene.surfaces.slice(1)] }],
    ] as const) expect(() => buildGlyphControlFrame({ ...opts, scene: changed })).toThrow(new RegExp(label));
  });

  it("packs opaque black distinctly from empty and suppresses visible-space colors", () => {
    const blackBase: Omit<GlyphObjectDictionary, "contentSha256"> = { ...dictionaryBase, classes: [{ id: 1, name: "black", semanticGlyph: "Z", controlColor: "#000000" }] };
    const black = { ...blackBase, contentSha256: computeGlyphControlContentSha256(blackBase) } satisfies GlyphObjectDictionary;
    const polygons = [quad(0, -1, 1, "#000000")];
    const rawScene = manifest(["surface/test-0"]);
    const sceneWithoutDictionary = { ...rawScene, dictionaryId: black.id, dictionarySha256: black.contentSha256 };
    const hashes = computeGlyphControlGeometryHashes(polygons);
    const unsigned = { ...sceneWithoutDictionary, ...hashes, contentSha256: "" };
    const scene = { ...unsigned, contentSha256: computeGlyphControlContentSha256(unsigned) };
    const result = buildGlyphControlFrame({ polygons, scene, dictionary: black, camera: createGlyphOrthographicCamera({ rotX: 0, rotY: 0, zoom: 120 }), grid: { cols: 8, rows: 8, cellAspect: 2 }, doubleSided: true, ambientLight: { intensity: 1 } });
    expect(result.semanticColor.some((color) => color === 0xff000000)).toBe(true);
    for (let i = 0; i < result.coverage.length; i++) if (!result.coverage[i]) expect(result.visibleColor[i]).toBe(0);
  });

  it("does not change compileScene bytes when capture is unused", () => {
    const polygons = [quad(0)];
    const options = { polygons, cols: 16, rows: 10, useColors: true, camera: createGlyphOrthographicCamera({ rotX: 0, rotY: 0, zoom: 160 }) };
    const before = compileScene(options).inner;
    frame(polygons);
    expect(compileScene(options).inner).toBe(before);
  });
  it("does not allocate RGB capture buffers on the ordinary raster path", () => {
    const polygons = [quad(0)]; const camera = createGlyphOrthographicCamera({ zoom: 120 });
    rasterize(buildRasterizeContext({ polygons, camera, grid: { cols: 8, rows: 8, cellAspect: 2 }, mode: "solid" }));
    const scratch = (camera as unknown as { __glyphScratch?: { albedoRgb: unknown; targetRgb: unknown } }).__glyphScratch;
    expect(scratch?.albedoRgb).toBeNull();
    expect(scratch?.targetRgb).toBeNull();
  });
});
