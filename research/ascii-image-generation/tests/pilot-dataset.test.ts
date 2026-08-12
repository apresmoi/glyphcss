import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildMockPilotDataset } from "../src/pilot-dataset.mjs";
import { createMockTargetProvider } from "../src/targets/provider-core.mjs";

const root = resolve(import.meta.dirname, "..");
describe("B11 mock dataset admission", () => {
  it("cannot use the mock-only zero-network assembler with a non-mock provider", async () => {
    const dataset = await mkdtemp(join(tmpdir(), "glyph-b11-mock-boundary-"));
    try {
      await expect(buildMockPilotDataset({ outputRoot: dataset, provider: { id: "openai-images/v1", apiVersion: "openai-images/v1" } as any })).rejects.toThrow("PILOT_MOCK_PROVIDER_REQUIRED");
    } finally { await rm(dataset, { recursive: true, force: true }); }
  });

  it("assembles every B7 frame and fails closed for B10, lineage, and balance corruption", async () => {
    const dataset = await mkdtemp(join(tmpdir(), "glyph-b11-dataset-"));
    try {
      const built = await buildMockPilotDataset({ outputRoot: dataset, provider: createMockTargetProvider(), configPath: join(root, "tests/fixtures/pilot-legacy.json") });
      expect(built.manifest.records).toHaveLength(90);
      const authoritativeSplits = new Map(built.manifest.records.map((record: any) => [record.targetId, record.split]));
      const validateLegacyFixture = async () => {
        for (const record of built.manifest.records) {
          const acceptance = JSON.parse(await readFile(join(dataset, record.acceptancePath), "utf8"));
          if (acceptance.b10.metrics["visible-ascii-adherence"] !== 0) throw new Error("PILOT_B10_REJECTED_visible-ascii-adherence");
          if (record.split !== authoritativeSplits.get(record.targetId)) throw new Error("PILOT_INVENTED_SCENE_OR_SPLIT_LABEL");
        }
        for (const population of built.balance.populations) for (const split of Object.values(population.splits) as any[]) {
          if (!split || !Object.keys(split.classCells).length || !Object.keys(split.glyphCells).length || !Object.keys(split.instanceCells).length || !Object.keys(split.surfaceCells).length || !Object.keys(split.motionFrames).length) throw new Error("PILOT_BALANCE_RECONSTRUCTION_MISMATCH");
        }
      };
      await expect(validateLegacyFixture()).resolves.toBeUndefined();

      const first = built.manifest.records[0], acceptancePath = join(dataset, first.acceptancePath);
      const acceptance = JSON.parse(await readFile(acceptancePath, "utf8"));
      acceptance.b10.metrics["visible-ascii-adherence"] = 1;
      await writeFile(acceptancePath, `${JSON.stringify(acceptance, null, 2)}\n`);
      first.acceptanceSha256 = (await import("node:crypto")).createHash("sha256").update(await readFile(acceptancePath)).digest("hex");
      await writeFile(built.reportPath, `${JSON.stringify(built.manifest, null, 2)}\n`);
      await expect(validateLegacyFixture()).rejects.toThrow("PILOT_B10_REJECTED_visible-ascii-adherence");

      acceptance.b10.metrics["visible-ascii-adherence"] = 0;
      await writeFile(acceptancePath, `${JSON.stringify(acceptance, null, 2)}\n`);
      first.acceptanceSha256 = (await import("node:crypto")).createHash("sha256").update(await readFile(acceptancePath)).digest("hex");
      first.split = "test";
      await writeFile(built.reportPath, `${JSON.stringify(built.manifest, null, 2)}\n`);
      await expect(validateLegacyFixture()).rejects.toThrow("PILOT_INVENTED_SCENE_OR_SPLIT_LABEL");

      first.split = "train";
      Object.assign(built.balance.populations[0].splits.train, { classCells: {}, glyphCells: {}, instanceCells: {}, surfaceCells: {}, motionFrames: {} });
      await writeFile(join(dataset, "pilot-balance.json"), `${JSON.stringify(built.balance, null, 2)}\n`);
      await writeFile(built.reportPath, `${JSON.stringify(built.manifest, null, 2)}\n`);
      await expect(validateLegacyFixture()).rejects.toThrow("PILOT_BALANCE_RECONSTRUCTION_MISMATCH");
    } finally { await rm(dataset, { recursive: true, force: true }); }
  }, 180_000);
});
