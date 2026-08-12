import { createCanvas, loadImage } from "@napi-rs/canvas";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

const args = Object.fromEntries(process.argv.slice(2).map((arg) => {
  const match = /^--([^=]+)=(.+)$/.exec(arg);
  if (!match) throw new Error(`expected --name=value, received ${arg}`);
  return [match[1], match[2]];
}));
if (!args.input || !args.output) throw new Error("usage: --input=<raw corpus root> --output=<sheet directory>");

const root = resolve(import.meta.dirname, "..");
const input = resolve(args.input);
const output = resolve(args.output);
const registry = JSON.parse(await readFile(join(root, "reports", "asset-registry.json"), "utf8"));
const corpusConfig = JSON.parse(await readFile(join(root, "config", "asset-corpus.json"), "utf8"));
if (corpusConfig.grid?.cols !== 256 || corpusConfig.grid?.rows !== 128 || corpusConfig.grid?.cellAspect !== 2
  || corpusConfig.modelRaster?.width !== 256 || corpusConfig.modelRaster?.height !== 256
  || corpusConfig.modelRaster?.continuousControlSampling !== "nearest") throw new Error("VISUAL_CALIBRATION_RECIPE_INVALID");
const labels = new Map(registry.assets.map((asset) => [asset.id.slice("asset/".length), asset.label]));
const assetDirs = (await readdir(input, { withFileTypes: true })).filter((entry) => entry.isDirectory()).sort((a, b) => a.name.localeCompare(b.name));
await mkdir(output, { recursive: true });

const tile = 256;
const gutter = 16;
const header = 42;
const labelsForFrames = ["camera 1 · light A", "camera 1 · light B", "camera 2 · light A", "camera 2 · light B"];
const sha = (value) => createHash("sha256").update(value).digest("hex");
const created = [];

function checkerboard(context, x, y) {
  const cell = 16;
  for (let row = 0; row < tile / cell; row++) {
    for (let col = 0; col < tile / cell; col++) {
      context.fillStyle = (row + col) % 2 ? "#25272b" : "#34373c";
      context.fillRect(x + col * cell, y + row * cell, cell, cell);
    }
  }
}

for (const assetDir of assetDirs) {
  const variantsRoot = join(input, assetDir.name, "variants");
  const variants = (await readdir(variantsRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && entry.name.endsWith("--none"))
    .sort((a, b) => a.name.localeCompare(b.name));
  if (variants.length === 0) throw new Error(`no --none review variant for ${assetDir.name}`);
  const selectedVariants = args["all-variants"] === "true" ? variants : variants.slice(0, 1);
  for (const variant of selectedVariants) {
    const variantRoot = join(variantsRoot, variant.name);
    const images = await Promise.all(Array.from({ length: 4 }, (_, index) => loadImage(join(variantRoot, `target-frame-${String(index).padStart(3, "0")}.png`))));
    // Targets retain raw grid dimensions. The canvas expands each 2:1 glyph
    // cell vertically into the square model-space view below.
    if (images.some((image) => image.width !== corpusConfig.grid.cols || image.height !== corpusConfig.grid.rows)) throw new Error(`VISUAL_CALIBRATION_TARGET_DIMENSIONS_INVALID: ${assetDir.name}/${variant.name}`);
    const canvas = createCanvas(tile * 2 + gutter * 3, (tile + header) * 2 + gutter * 3);
    const context = canvas.getContext("2d");
    context.fillStyle = "#111316";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.textBaseline = "middle";
    context.font = "600 17px system-ui";
    context.imageSmoothingEnabled = false;
    for (let index = 0; index < images.length; index++) {
      const col = index % 2;
      const row = Math.floor(index / 2);
      const x = gutter + col * (tile + gutter);
      const y = gutter + row * (tile + header + gutter);
      context.fillStyle = "#e8eaed";
      context.fillText(labelsForFrames[index], x, y + header / 2);
      checkerboard(context, x, y + header);
      // The raw grid is 256×128 with 2:1 cell aspect. Expanding it to
      // 256×256 is the physical/model-space view; never stretch it wider.
      context.drawImage(images[index], x, y + header, tile, tile);
    }
    const label = labels.get(assetDir.name) ?? assetDir.name.slice(0, 12);
    const safeLabel = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const variantSuffix = selectedVariants.length > 1 ? `--${variant.name}` : "";
    const destination = join(output, `${safeLabel || "asset"}--${assetDir.name.slice(0, 10)}${variantSuffix}.png`);
    const bytes = canvas.toBuffer("image/png");
    await writeFile(destination, bytes);
    created.push({ path: relative(resolve(root, "..", ".."), destination).replaceAll("\\", "/"), sha256: sha(bytes) });
  }
}

if (args.report) {
  const report = JSON.parse(await readFile(resolve(args.report), "utf8"));
  const expected = report.reviewBatches?.flatMap((batch) => batch.contactSheets ?? []).filter((sheet) => sheet.path.startsWith(`${relative(resolve(root, "..", ".."), output).replaceAll("\\", "/")}/`));
  if (!Array.isArray(expected) || expected.length !== created.length || JSON.stringify(expected.sort((a, b) => a.path.localeCompare(b.path))) !== JSON.stringify(created.sort((a, b) => a.path.localeCompare(b.path)))) throw new Error("VISUAL_CALIBRATION_CONTACT_SHEET_REPORT_STALE");
}

console.log(`wrote ${assetDirs.length} visual calibration sheets to ${output}`);
