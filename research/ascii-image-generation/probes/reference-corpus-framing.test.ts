import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { fitReferenceCamera, generateCorpusAt, runCorpus, sceneFor } from "../src/generate-controls.mjs";

const root = resolve(import.meta.dirname, "..");
const configPath = "config/reference-corpus.json";
const load = async (path: string) => JSON.parse(await readFile(path, "utf8"));
const cells = async (path: string) => new Uint8Array(await readFile(path));

describe("reference-corpus-framing", () => {
  it("seals a separately framed public-grid population without changing the tiny fixture", async () => {
    const config = await load(join(root, configPath));
    const dictionary = await load(join(root, config.dictionary));
    expect(config.grid).toEqual({ cols: 80, rows: 24, cellAspect: 2 });
    expect(config.framing).toEqual({ rule: "world-bounds-sphere/v1", margin: .15, baseline: { rotX: 61, rotY: 24, zoom: 18 } });
    const generated = sceneFor(config.sceneSeeds[0], dictionary, 0);
    const fit = fitReferenceCamera(generated.polygons, config.grid, config.framing);
    expect(fit.zoom).toBeGreaterThan(config.framing.baseline.zoom);
    expect(fit.bounds.radius).toBeGreaterThan(0);

    const firstRoot = await mkdtemp(join(tmpdir(), "glyphcss-reference-corpus-"));
    const secondRoot = await mkdtemp(join(tmpdir(), "glyphcss-reference-corpus-repeat-"));
    try {
      const [first, second] = await Promise.all([generateCorpusAt(configPath, firstRoot), generateCorpusAt(configPath, secondRoot)]);
      expect(first.contentSha256).toBe(second.contentSha256);
      expect(first.framing).toEqual({ ...config.framing, fitRule: "world-bounds-sphere/v1" });
      expect(first.id).toBe("corpus/reference-80x24-v1");
      expect(first.trajectories).toHaveLength(10);
      expect(first.trajectories.some((record: any) => record.kind === "occlusion-swap" && record.properties.winnerSwapCells > 0)).toBe(true);
      expect(first.trajectories.some((record: any) => record.kind === "reveal" && record.properties.revealCells > 0 && record.properties.disocclusionCells > 0)).toBe(true);
      expect(first.trajectories.some((record: any) => record.kind === "reset" && record.properties.reset)).toBe(true);
      const slow = first.trajectories.filter((record: any) => record.kind === "slow").map((record: any) => record.motion.mean);
      const fast = first.trajectories.filter((record: any) => record.kind === "fast").map((record: any) => record.motion.mean);
      expect(Math.max(...slow)).toBeLessThan(Math.min(...fast));
      for (const record of first.trajectories) for (const selector of ["visible", "semantic"]) {
        for (const frame of record.trajectory.controlTrajectory.frames) {
          const coverage = await cells(join(firstRoot, record[`${selector}Bundle`], "frames", frame.frameId, "coverage-u8.bin"));
          expect(coverage.reduce((sum, value) => sum + value, 0), `${record.kind}/${frame.frameId}/${selector}`).toBeGreaterThan(1);
        }
      }
      // This runs the generator's content-addressed resume probes: changed
      // framing/zoom config and corrupted serialized maps must not be accepted.
      await expect(runCorpus(configPath, { fixture: true })).resolves.toMatchObject({ contentSha256: first.contentSha256 });
    } finally {
      await rm(firstRoot, { recursive: true, force: true });
      await rm(secondRoot, { recursive: true, force: true });
    }
  }, 180_000);

  it("fails closed when the declared fit/grid changes", async () => {
    const config = await load(join(root, configPath));
    const dictionary = await load(join(root, config.dictionary));
    const generated = sceneFor(config.sceneSeeds[0], dictionary, 0);
    expect(() => fitReferenceCamera(generated.polygons, { ...config.grid, cols: 79 }, config.framing)).toThrow(/public 80x24/);
    expect(() => fitReferenceCamera(generated.polygons, config.grid, { ...config.framing, margin: 0 })).toThrow(/margin/);
    expect(() => fitReferenceCamera(generated.polygons, config.grid, { ...config.framing, rule: "manual-zoom/v1" })).toThrow(/world-bounds-sphere/);
    expect(() => fitReferenceCamera(generated.polygons, config.grid, { ...config.framing, baseline: { ...config.framing.baseline, zoom: 0 } })).toThrow(/camera baseline/);
    expect(() => fitReferenceCamera(generated.polygons, config.grid, { ...config.framing, baseline: { ...config.framing.baseline, rotX: Number.NaN } })).toThrow(/camera baseline/);
  });
});
