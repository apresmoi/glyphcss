#!/usr/bin/env node
// Feed the REAL glyphcss text to the ascii-block Oven widget: the actual characters
// glyphcss wrote, plus their per-cell colour, with no rasterisation anywhere.
import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import { resolve, dirname } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname);
const repoRoot = resolve(root, "..", "..");
const sceneKey = process.argv[2] ?? "building";
const sceneRoot = resolve(root, "reports/glyph-scenes", sceneKey);
const outPath = resolve(repoRoot, ".local/burnlist/data/glyph-scene-ascii.json");
const COLS = 256;

const exists = async (p) => { try { await access(p); return true; } catch { return false; } };
const hex = (v) => `#${(v & 0xffffff).toString(16).padStart(6, "0")}`;

// One colour per character, row by row. AsciiBlock coalesces equal adjacent colours
// into a single span, so a flat-shaded row costs one node rather than 256.
async function frame(textPath, colorPath, label) {
  if (!(await exists(textPath))) return null;
  const text = await readFile(textPath, "utf8");
  const lines = text.split("\n").filter((l) => l.length);
  let colors = null;
  if (await exists(colorPath)) {
    const buffer = await readFile(colorPath);
    colors = lines.map((line, row) =>
      Array.from({ length: line.length }, (_, col) => hex(buffer.readUInt32LE((row * COLS + col) * 4))));
  }
  return { text: lines.join("\n"), colors, label, cols: lines[0]?.length ?? 0, rows: lines.length };
}

const manifest = JSON.parse(await readFile(resolve(sceneRoot, "manifest.json"), "utf8"));
const controlsManifest = JSON.parse(await readFile(resolve(sceneRoot, manifest.controls.path), "utf8"));
const frameCount = controlsManifest.frames.length;
const gridText = await readFile(resolve(root, manifest.input.gridPath), "utf8");

const views = [];
for (let index = 0; index < frameCount; index++) {
  const dir = resolve(sceneRoot, "views/frames", `frame-${String(index).padStart(3, "0")}`);
  const semantic = await frame(resolve(dir, "semantic.txt"), resolve(dir, "semantic-color-argb.bin"), "semantic frame — authored class characters");
  const visible = await frame(resolve(dir, "visible.txt"), resolve(dir, "visible-color-argb.bin"), "visible frame — shading ramp");
  if (!semantic || !visible) continue;
  views.push({ id: `view-${String(index).padStart(3, "0")}`, title: `view ${index}`, semantic, visible });
}

const payload = {
  subtitle: `${sceneKey}: an authored ${manifest.input.grid.cols}x${manifest.input.grid.rows} character grid became ${manifest.input.polygonCount} polygons. Below is glyphcss's real text output per view — characters and per-cell colour, not an image.`,
  grid: { text: gridText.replace(/\n+$/, ""), label: `authored input grid (${manifest.input.gridPath})` },
  views,
};

await mkdir(dirname(outPath), { recursive: true });
await writeFile(outPath, JSON.stringify(payload), "utf8");
console.log(JSON.stringify({ payload: outPath, views: views.length, megabytes: +((await readFile(outPath)).length / 1048576).toFixed(1) }));
