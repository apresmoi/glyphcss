import { createHash } from "node:crypto";
import { access, readFile, readdir } from "node:fs/promises";
import { basename, relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const repo = resolve(root, "..", "..");
const resolvePath = (path) => resolve(path.startsWith("research/") ? repo : root, path);
const sha = (value) => createHash("sha256").update(value).digest("hex");
const fileSha = async (path) => sha(await readFile(path));
const canonical = (value) => Array.isArray(value)
  ? `[${value.map(canonical).join(",")}]`
  : value && typeof value === "object"
    ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`
    : JSON.stringify(value);
const fail = (code) => { throw new Error(`ASSET_CORPUS_VISUAL_CALIBRATION_${code}`); };

async function exists(path) { try { await access(path); return true; } catch { return false; } }
async function filesRecursively(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.sort((a, b) => a.name.localeCompare(b.name)).map(async (entry) => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? filesRecursively(path) : entry.isFile() && entry.name !== ".DS_Store" ? [path] : [];
  }))).flat();
}
async function treeSha(directory) {
  const files = await filesRecursively(directory);
  const lines = await Promise.all(files.map(async (path) => `${relative(directory, path).replaceAll("\\\\", "/")}\\0${await fileSha(path)}`));
  return sha(lines.join("\\n"));
}

function validateRecipe(config) {
  if (config.schemaVersion !== "glyph-asset-corpus-config/v3" || config.id !== "asset-corpus/native-v3") fail("RECIPE_VERSION");
  if (canonical(config.grid) !== canonical({ cols: 256, rows: 128, cellAspect: 2 })) fail("GRID");
  if (config.trajectory?.margin !== 0.05) fail("MARGIN");
  const raster = config.modelRaster;
  if (raster?.id !== "glyph-model-raster/physical-cell-letterbox-v1" || raster?.width !== 256 || raster?.height !== 256 || canonical(raster.source) !== canonical(config.grid)
    || raster.fit !== "contain" || raster.targetSampling !== "nearest" || raster.discreteControlSampling !== "nearest" || raster.continuousControlSampling !== "nearest" || raster.latentContinuousSampling !== "bilinear"
    || raster.transform?.kind !== "cell-aspect-aware-letterbox" || canonical(raster.transform.activeRect) !== canonical({ x: 0, y: 0, width: 256, height: 256 })
    || canonical(raster.transform.rawCellToModelPixels) !== canonical({ x: 1, y: 2 })) fail("MODEL_RASTER");
  if (canonical(config.background) !== canonical({ id: "transparent-rgba-v1", targetRgba: [0, 0, 0, 0], modelRasterPaddingRgba: [0, 0, 0, 0], reviewComposite: "checkerboard-only-not-training-data" })) fail("BACKGROUND");
  if (config.sampling?.targetAndDiscreteControls !== "nearest" || config.sampling?.continuousControls !== "nearest" || config.sampling?.latentReductionOnly !== "bilinear") fail("SAMPLING");
}

export async function validateAssetCorpusVisualCalibration(reportPath = "reports/asset-corpus-visual-calibration.json", { verifyArtifacts = true } = {}) {
  const reportFile = resolvePath(reportPath);
  const report = JSON.parse(await readFile(reportFile, "utf8"));
  const configFile = resolve(repo, report.recipe?.path ?? "");
  if (report.schemaVersion !== "glyph-asset-corpus-visual-calibration/v1" || report.status !== "approved-recipe-review-only") fail("STATUS");
  if (!(await exists(configFile)) || report.recipe.sha256 !== await fileSha(configFile)) fail("RECIPE_SHA");
  const config = JSON.parse(await readFile(configFile, "utf8"));
  validateRecipe(config);
  if (canonical(report.recipe.frozen) !== canonical({ grid: config.grid, margin: config.trajectory.margin, modelRaster: config.modelRaster, background: config.background, sampling: config.sampling, texturePolicy: config.texturePolicy })) fail("RECIPE_REBOUND");
  const rejected = report.rejectedRecipes?.find((entry) => entry.id === "asset-corpus/native-v2-80x48");
  if (!rejected || rejected.status !== "rejected-non-admissible" || rejected.configSha256 !== "98de09fab128b3a03bf7db0deaea53224a1393302f69b1ca9c26240aa4d81be9" || rejected.reportSha256 !== "62a61ba7c16fc64269b43fc3c8b51eb3da50731f779635a4c570976833975d5f") fail("LEGACY_REJECTION");
  const r1 = report.reviewBatches?.find((entry) => entry.id === "visual-calibration-r1");
  const r2 = report.reviewBatches?.find((entry) => entry.id === "visual-calibration-r2");
  if (!r1 || r1.disposition !== "rejected" || !r2 || r2.disposition !== "approved-diverse-recipe" || r2.humanApproval?.approved !== true || r2.humanApproval?.authority !== "user") fail("REVIEW_AUTHORITY");
  if (![r1, r2].every((batch) => batch.remoteReview?.kind === "remote-rendered-calibration-batch" && batch.remoteReview?.reportRoot === batch.sourceRoot && batch.remoteReview?.sourceTreeSha256 === batch.sourceTreeSha256)) fail("REMOTE_REVIEW_REPORT");
  if (r2.sourceTreeSha256 !== "ec51d207fb9c4655fbbd9d33a0c2bd25646061bf82836dfde75b033d3d25247b" || r1.sourceTreeSha256 !== "c404e49dbacc6e9c97eb3d6c56c1ba6d272b644dc0f66d67c2a385d5336491b2") fail("SOURCE_SHA");
  if (!Array.isArray(r1.contactSheets) || r1.contactSheets.length !== 6 || !Array.isArray(r2.contactSheets) || r2.contactSheets.length !== 11 || ![...r1.contactSheets, ...r2.contactSheets].every((sheet) => typeof sheet.path === "string" && /^[a-f0-9]{64}$/.test(sheet.sha256))) fail("CONTACT_SHEETS");
  const telegraph = r2.assetExceptions?.find((entry) => entry.assetId === "asset/c764726a33592ecf883d6003929099e84d42530d4bd85eb6be9aed08fa1593ea");
  if (!telegraph || telegraph.disposition !== "exclude-from-training-until-rerender-and-independent-admission" || telegraph.status !== "visual-render-failure") fail("TELEGRAPH_EXCEPTION");
  if (!Array.isArray(r2.passingContactSheetPaths) || r2.passingContactSheetPaths.length !== 10 || r2.passingContactSheetPaths.includes("research/ascii-image-generation/review/visual-calibration-r2/contact-sheets/morse-telegraph-key--c764726a33.png")
    || !r2.passingContactSheetPaths.every((path) => r2.contactSheets.some((sheet) => sheet.path === path))) fail("APPROVED_SHEET_SET");
  if (report.admissible !== false || report.trainingAuthority !== false || report.humanReviewSubstitutesForAlignmentProvenanceOrCausality !== false) fail("NON_ADMISSIBLE");
  if (verifyArtifacts) for (const batch of [r1, r2]) {
    const source = resolve(repo, batch.sourceRoot);
    if (!(await exists(source)) || await treeSha(source) !== batch.sourceTreeSha256) fail("REVIEW_SOURCE_STALE");
    for (const sheet of batch.contactSheets) {
      const path = resolve(repo, sheet.path);
      if (!(await exists(path)) || await fileSha(path) !== sheet.sha256) fail("CONTACT_SHEET_STALE");
    }
  }
  return report;
}

if (process.argv[1] === import.meta.filename) {
  const args = process.argv.slice(2);
  const checkAt = args.indexOf("--check");
  if (checkAt < 0 || !args[checkAt + 1] || args.length !== 2) throw new Error("usage: --check <report path>");
  await validateAssetCorpusVisualCalibration(args[checkAt + 1]);
  process.stdout.write("asset corpus visual calibration: valid\n");
}
