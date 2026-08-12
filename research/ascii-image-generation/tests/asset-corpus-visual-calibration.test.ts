import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { validateAssetCorpusVisualCalibration } from "../scripts/validate-asset-corpus-visual-calibration.mjs";
import { validateAssetCorpusRenderRecipe } from "../src/render-asset-corpus.mjs";

const root = resolve(import.meta.dirname, "..");
const reportPath = resolve(root, "reports/asset-corpus-visual-calibration.json");

describe("B51 visual calibration authority", () => {
  it("freezes the approved 256x128 cell-aspect-aware recipe without making review admissible", async () => {
    const report = await validateAssetCorpusVisualCalibration("reports/asset-corpus-visual-calibration.json", { verifyArtifacts: false });
    expect(report.admissible).toBe(false);
    expect(report.trainingAuthority).toBe(false);
    expect(report.recipe.frozen.grid).toEqual({ cols: 256, rows: 128, cellAspect: 2 });
    expect(report.recipe.frozen.margin).toBe(0.05);
    expect(report.recipe.frozen.modelRaster.continuousControlSampling).toBe("nearest");
    expect(report.recipe.frozen.modelRaster.latentContinuousSampling).toBe("bilinear");
    const r2 = report.reviewBatches.find((batch: { id: string }) => batch.id === "visual-calibration-r2");
    expect(r2.passingContactSheetPaths).toHaveLength(10);
    expect(r2.passingContactSheetPaths).not.toContain("research/ascii-image-generation/review/visual-calibration-r2/contact-sheets/morse-telegraph-key--c764726a33.png");
  });

  it("fails closed for stale recipe, missing approval, or an unrecorded malformed render", async () => {
    const report = JSON.parse(await readFile(reportPath, "utf8"));
    const stale = structuredClone(report);
    stale.recipe.sha256 = "0".repeat(64);
    await expect(validateAssetCorpusVisualCalibrationFor(stale)).rejects.toThrow(/RECIPE_SHA/);
    const unapproved = structuredClone(report);
    unapproved.reviewBatches.find((batch: { id: string }) => batch.id === "visual-calibration-r2").humanApproval.approved = false;
    await expect(validateAssetCorpusVisualCalibrationFor(unapproved)).rejects.toThrow(/REVIEW_AUTHORITY/);
    const unsafe = structuredClone(report);
    unsafe.reviewBatches.find((batch: { id: string }) => batch.id === "visual-calibration-r2").assetExceptions = [];
    await expect(validateAssetCorpusVisualCalibrationFor(unsafe)).rejects.toThrow(/TELEGRAPH_EXCEPTION/);
  });

  it("is accepted by the renderer itself and rejects the retired v2 recipe", async () => {
    const config = JSON.parse(await readFile(resolve(root, "config/asset-corpus.json"), "utf8"));
    expect(() => validateAssetCorpusRenderRecipe(config)).not.toThrow();
    expect(() => validateAssetCorpusRenderRecipe({ ...config, schemaVersion: "glyph-asset-corpus-config/v2" }))
      .toThrow(/ASSET_CORPUS_CONFIG_INVALID/);
    expect(() => validateAssetCorpusRenderRecipe({ ...config, grid: { cols: 80, rows: 48, cellAspect: 2 } }))
      .toThrow(/ASSET_CORPUS_CONFIG_INVALID/);
  });
});

async function validateAssetCorpusVisualCalibrationFor(report: object) {
  const original = await readFile(reportPath, "utf8");
  const temporary = `${reportPath}.test-tampered`;
  const { writeFile, rm } = await import("node:fs/promises");
  try {
    await writeFile(temporary, `${JSON.stringify(report)}\n`);
    return await validateAssetCorpusVisualCalibration(temporary, { verifyArtifacts: false });
  } finally {
    await rm(temporary, { force: true });
    void original;
  }
}
