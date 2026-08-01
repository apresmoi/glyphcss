import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  buildGlyphControlFrame,
  computeGlyphControlContentSha256,
  computeGlyphControlGeometryHashes,
  createGlyphOrthographicCamera,
  packGlyphControlTensor,
  type GlyphControlSceneManifest,
  type GlyphObjectDictionary,
  type GlyphTemporalControlInputs,
} from "glyphcss";
import { buildCompileControlFrameFromFile, compileFile } from "./compileFile";
import { writeGlyphControlMaps } from "./controlMaps";
import type { GlyphLabelSidecar, GlyphPolygonRemap } from "./labelSidecar";
import { verifyGlyphLabelSidecar } from "./labelSidecar";
import { loadMeshFromFile } from "./loadMeshFromFile";
import { glyphcssCompile } from "./vite";

const execute = promisify(execFile);
const normalization = { depth: { near: -100, far: 100 }, world: { min: [-10, -10, -10] as [number, number, number], max: [10, 10, 10] as [number, number, number] } };
let cliPath = "";
let cliBuild = "";

beforeAll(async () => {
  cliBuild = await mkdtemp(join(process.cwd(), ".glyph-cli-build-"));
  await execute("pnpm", ["exec", "tsup", "src/cli.ts", "--format", "esm", "--out-dir", cliBuild, "--clean", "false"], { cwd: process.cwd() });
  cliPath = join(cliBuild, "cli.js");
});
afterAll(async () => { if (cliBuild) await rm(cliBuild, { recursive: true, force: true }); });

async function fixture(root: string): Promise<{ mesh: string; labels: string; normalizationFile: string; sidecar: GlyphLabelSidecar }> {
  const mesh = join(root, "two.obj");
  await writeFile(mesh, [
    "v -1 -1 0", "v 0 -1 0", "v 0 1 0", "v -1 1 0",
    "v 0 -1 0.5", "v 1 -1 0.5", "v 1 1 0.5", "v 0 1 0.5",
    "f 1 2 3 4", "f 5 6 7 8", "",
  ].join("\n"));
  const { polygons } = await loadMeshFromFile(mesh, { meshResolution: "lossless" });
  const dictionaryRaw = {
    schemaVersion: "glyph-object-dictionary/v2",
    id: "dictionary/parity",
    font: { id: "font/parity", version: "1", sha256: "a".repeat(64) },
    classes: [
      { id: 1, name: "left", semanticGlyph: "L", controlColor: "#ff0000" },
      { id: 2, name: "right", semanticGlyph: "R", controlColor: "#00ff00" },
    ],
  };
  const dictionary: GlyphObjectDictionary = { ...dictionaryRaw, contentSha256: computeGlyphControlContentSha256(dictionaryRaw) };
  const hashes = computeGlyphControlGeometryHashes(polygons);
  const sceneRaw = {
    schemaVersion: "control-scene/v1" as const,
    id: "scene/parity",
    dictionaryId: dictionary.id,
    dictionarySha256: dictionary.contentSha256,
    ...hashes,
    instances: [{ id: "instance/left", classId: 1 }, { id: "instance/right", classId: 2 }],
    surfaces: [{ id: "surface/left", instanceId: "instance/left" }, { id: "surface/right", instanceId: "instance/right" }],
    polygonSurfaceIds: polygons.map((_, index) => index < polygons.length / 2 ? "surface/left" : "surface/right"),
  };
  const scene: GlyphControlSceneManifest = { ...sceneRaw, contentSha256: computeGlyphControlContentSha256(sceneRaw) };
  const sidecar: GlyphLabelSidecar = { schemaVersion: "glyph-label-sidecar/v1", scene, dictionary };
  const labels = join(root, "labels.json"); const normalizationFile = join(root, "normalization.json");
  await writeFile(labels, JSON.stringify(sidecar));
  await writeFile(normalizationFile, JSON.stringify(normalization));
  return { mesh, labels, normalizationFile, sidecar };
}

async function files(root: string, directory = root): Promise<Record<string, Buffer>> {
  const result: Record<string, Buffer> = {};
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) Object.assign(result, await files(root, path));
    else result[path.slice(root.length + 1)] = await readFile(path);
  }
  return result;
}

function innerFromVite(code: string): string {
  const match = code.match(/export const inner = (.*);/);
  if (!match) throw new Error("missing Vite inner export");
  return JSON.parse(match[1]!);
}

describe("label sidecar and adapter parity", () => {
  it("preserves direct/lossless lineage, accepts a hash-bound remap, and rejects stale/bad remaps", async () => {
    const root = await mkdtemp(join(tmpdir(), "glyph-label-remap-"));
    try {
      const { mesh, sidecar } = await fixture(root);
      const { polygons } = await loadMeshFromFile(mesh, { meshResolution: "lossless" });
      expect(verifyGlyphLabelSidecar(polygons, sidecar).sceneManifest.contentSha256).toBe(sidecar.scene.contentSha256);
      const reordered = [...polygons].reverse();
      const loaded = computeGlyphControlGeometryHashes(reordered);
      const remapRaw = {
        schemaVersion: "glyph-polygon-remap/v1" as const,
        loadedGeometrySha256: loaded.geometrySha256,
        loadedPolygonOrderSha256: loaded.polygonOrderSha256,
        authoredGeometrySha256: sidecar.scene.geometrySha256,
        authoredPolygonOrderSha256: sidecar.scene.polygonOrderSha256,
        loadedToAuthored: polygons.map((_, index) => polygons.length - index - 1),
      };
      const polygonRemap: GlyphPolygonRemap = { ...remapRaw, contentSha256: computeGlyphControlContentSha256(remapRaw) };
      const remapped = verifyGlyphLabelSidecar(reordered, { ...sidecar, polygonRemap });
      expect(remapped.sceneManifest.polygonSurfaceIds).toEqual([...sidecar.scene.polygonSurfaceIds].reverse());
      await expect(Promise.resolve().then(() => verifyGlyphLabelSidecar(reordered, sidecar))).rejects.toThrow(/post-load/);
      expect(() => verifyGlyphLabelSidecar(reordered, { ...sidecar, polygonRemap: { ...polygonRemap, loadedToAuthored: polygonRemap.loadedToAuthored.map(() => 0), contentSha256: computeGlyphControlContentSha256({ ...polygonRemap, loadedToAuthored: polygonRemap.loadedToAuthored.map(() => 0), contentSha256: "" }) } })).toThrow(/bijection|contentSha256/);
      expect(() => verifyGlyphLabelSidecar(reordered, { ...sidecar, polygonRemap: { ...polygonRemap, loadedPolygonOrderSha256: "0".repeat(64), contentSha256: computeGlyphControlContentSha256({ ...polygonRemap, loadedPolygonOrderSha256: "0".repeat(64), contentSha256: "" }) } })).toThrow(/stale/);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  for (const glyphOutput of ["visible", "semantic"] as const) {
    it(`keeps Node, actual CLI, and Vite ${glyphOutput} text and control artifacts byte-identical`, async () => {
      const root = await mkdtemp(join(tmpdir(), `glyph-${glyphOutput}-parity-`));
      try {
        const { mesh, labels, normalizationFile, sidecar } = await fixture(root);
        const common = { labelSidecar: sidecar, glyphOutput, meshResolution: "lossless" as const, projection: "orthographic" as const, rotX: 0, rotY: 0, zoom: 18, cols: 12, rows: 6, cellAspect: 2, useColors: false, doubleSided: true };
        const nodeText = await compileFile(mesh, common);
        const frame = await buildCompileControlFrameFromFile(mesh, common);
        const nodeOut = join(root, "node-controls");
        await writeGlyphControlMaps({ destination: nodeOut, frames: [{ frame }], normalization, glyphOutput });
        const cliOut = join(root, "cli-controls");
        const cli = await execute(process.execPath, [cliPath, mesh, "--mesh-resolution", "lossless", "--ortho", "--rot-x", "0", "--rot-y", "0", "--zoom", "18", "--cols", "12", "--rows", "6", "--cell-aspect", "2", "--double-sided", "--format", "text", "--glyph-output", glyphOutput, "--glyph-labels", labels, "--control-out", cliOut, "--control-normalization", normalizationFile]);
        expect(cli.stdout.endsWith("\n") ? cli.stdout.slice(0, -1) : cli.stdout).toBe(nodeText.inner);
        const viteOut = join(root, "vite-controls");
        const plugin = glyphcssCompile();
        const id = `${mesh}?glyph&meshResolution=lossless&projection=orthographic&rotX=0&rotY=0&zoom=18&cols=12&rows=6&cellAspect=2&doubleSided=1&colors=0&glyphOutput=${glyphOutput}&glyphLabels=${encodeURIComponent(labels)}&controlOut=${encodeURIComponent(viteOut)}&controlNormalization=${encodeURIComponent(normalizationFile)}`;
        const code = await plugin.load.call({}, id);
        expect(innerFromVite(code!)).toBe(nodeText.inner);
        expect(await files(cliOut)).toEqual(await files(nodeOut));
        expect(await files(viteOut)).toEqual(await files(nodeOut));
      } finally { await rm(root, { recursive: true, force: true }); }
    });
  }
});

describe("two-frame temporal export", () => {
  it("writes B24 maps and the exact B32 temporal tensor, and rejects stale transitions and duplicate ids before staging", async () => {
    const root = await mkdtemp(join(tmpdir(), "glyph-temporal-export-"));
    try {
      const { mesh, sidecar } = await fixture(root); const { polygons } = await loadMeshFromFile(mesh, { meshResolution: "lossless" });
      const labels = verifyGlyphLabelSidecar(polygons, sidecar);
      const make = (rotY: number) => buildGlyphControlFrame({ polygons, scene: labels.sceneManifest, dictionary: labels.dictionary, camera: createGlyphOrthographicCamera({ rotX: 0, rotY, zoom: 18 }), grid: { cols: 12, rows: 6, cellAspect: 2 }, doubleSided: true });
      const first = make(0), second = make(8), n = second.metadata.cols * second.metadata.rows;
      const temporal: GlyphTemporalControlInputs = { warpRgb: new Float32Array(n * 3).fill(.25), reprojectionValid: new Float32Array(n).fill(1), disocclusion: new Float32Array(n), atlasConfidence: new Float32Array(n).fill(.75) };
      const transition = { sourceFrameId: "a", sourceSceneSha256: first.metadata.scene.contentSha256, sourcePolygonOrderSha256: first.metadata.scene.polygonOrderSha256 };
      const destination = join(root, "sequence");
      await writeGlyphControlMaps({ destination, frames: [{ id: "a", frame: first }, { id: "b", frame: second, temporal, transition }], normalization });
      expect(new Uint8Array(await readFile(join(destination, "frames/b/tensor-temporal-f32.bin")))).toEqual(new Uint8Array(packGlyphControlTensor(second, normalization, temporal).temporal!.buffer));
      expect(new Uint8Array(await readFile(join(destination, "frames/b/reprojection-valid-f32.bin")))).toEqual(new Uint8Array(temporal.reprojectionValid.buffer));
      expect(JSON.parse(await readFile(join(destination, "frames/b/index-lookups.json"), "utf8"))).toEqual({ instanceLookup: second.instanceLookup, surfaceLookup: second.surfaceLookup });
      await expect(writeGlyphControlMaps({ destination: join(root, "stale"), frames: [{ id: "a", frame: first }, { id: "b", frame: second, temporal, transition: { ...transition, sourceFrameId: "wrong" } }], normalization })).rejects.toThrow(/stale/);
      await expect(writeGlyphControlMaps({ destination: join(root, "duplicate"), frames: [{ id: "same", frame: first }, { id: "same", frame: second }], normalization })).rejects.toThrow(/unique/);
      expect((await readdir(root)).some((name) => name.includes("duplicate"))).toBe(false);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
