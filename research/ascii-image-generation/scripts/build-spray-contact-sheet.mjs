#!/usr/bin/env node
// Build a self-contained review page for the B59 spray-paint proof.
// Images are referenced relatively so the page works straight from disk.
import { readFile, writeFile, readdir } from "node:fs/promises";
import { resolve, relative } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname);
const reviewRoot = resolve(root, "review/spray-pass");
const out = resolve(reviewRoot, "contact-sheet.html");
const report = JSON.parse(await readFile(resolve(root, "reports/spray-pass.json"), "utf8"));

const esc = (value) => String(value).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const rel = (absolute) => relative(reviewRoot, absolute).split("\\").join("/");
const list = async (dir, filter) => {
  try { return (await readdir(dir)).filter(filter).sort(); } catch { return []; }
};

const sections = [];
for (const subject of report.subjects) {
  const dir = resolve(reviewRoot, "subjects", subject.key);
  const textures = await list(resolve(dir, "textures"), (f) => f.startsWith("texture-") && f.endsWith(".png"));
  const states = await list(resolve(dir, "textures"), (f) => f.startsWith("state-") && f.endsWith(".png"));
  const generated = await list(resolve(dir, "generated"), (f) => f.endsWith(".png"));
  const loopDir = resolve(reviewRoot, "closed-loop", subject.key, "renders");
  const loop = await list(loopDir, (f) => f.endsWith(".png"));

  const incidences = subject.views.map((v) => v.meanIncidence).filter((v) => typeof v === "number");
  const meanIncidence = incidences.length ? (incidences.reduce((a, b) => a + b, 0) / incidences.length).toFixed(3) : "n/a";
  const grazing = subject.views.reduce((sum, v) => sum + (v.backProjection?.cells_skipped_grazing ?? 0), 0);
  const observed = subject.beforeFill.observedTexels;
  const empty = observed === 0;

  sections.push(`
<section>
  <h2>${esc(subject.key)} ${empty ? '<span class="bad">painted nothing</span>' : ""}</h2>
  ${subject.warnings?.length ? `<p class="warn">${subject.warnings.map(esc).join("<br>")}</p>` : ""}
  <table>
    <tr><th>observed texels</th><td>${observed.toLocaleString()}</td>
        <th>unknown after fill</th><td>${subject.afterFill.unknownTexels.toLocaleString()}</td></tr>
    <tr><th>mean incidence</th><td>${meanIncidence}</td>
        <th>grazing cells skipped</th><td>${grazing.toLocaleString()}</td></tr>
    <tr><th>materials</th><td>${subject.materials.length}</td>
        <th>triangles</th><td>${subject.materialTriangleCount.toLocaleString()}</td></tr>
  </table>

  <h3>Baked authored-UV pages${empty ? " — empty, no authored UVs" : ""}</h3>
  <div class="grid pages">
    ${textures.map((f) => `<figure><img loading="lazy" src="${esc(rel(resolve(dir, "textures", f)))}"><figcaption>${esc(f)}</figcaption></figure>`).join("")}
    ${states.map((f) => `<figure><img loading="lazy" src="${esc(rel(resolve(dir, "textures", f)))}"><figcaption>${esc(f)} <span class="dim">(observed / filled mask)</span></figcaption></figure>`).join("")}
  </div>

  <h3>Closed loop — baked texture rendered back through glyphcss (${loop.length})</h3>
  ${loop.length ? `<div class="grid">${loop.map((f) => `<figure><img loading="lazy" src="${esc(rel(resolve(loopDir, f)))}"><figcaption>${esc(f)}</figcaption></figure>`).join("")}</div>`
    : `<p class="warn">Not renderable: no authored UVs, so there is no baked texture to render.</p>`}

  <h3>Generated views, in order (${generated.length})</h3>
  <div class="grid">
    ${generated.map((f, i) => `<figure><img loading="lazy" src="${esc(rel(resolve(dir, "generated", f)))}"><figcaption>${esc(f)} <span class="dim">${i === 0 ? "text2img" : "inpaint"}</span></figcaption></figure>`).join("")}
  </div>
</section>`);
}

await writeFile(out, `<!doctype html><meta charset="utf-8">
<title>B59 spray-paint proof — contact sheet</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 14px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; margin: 0 auto; padding: 2rem; max-width: 1200px; }
  h1 { margin-bottom: .25rem; }
  .banner { border: 2px solid #c0392b; color: #c0392b; padding: .75rem 1rem; margin: 1rem 0 2rem; font-weight: bold; }
  section { border-top: 1px solid currentColor; padding-top: 1.5rem; margin-top: 2.5rem; }
  table { border-collapse: collapse; margin: .5rem 0 1.5rem; }
  th, td { text-align: left; padding: .2rem 1.25rem .2rem 0; }
  th { font-weight: normal; opacity: .65; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: .75rem; }
  .grid.pages { grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); }
  figure { margin: 0; }
  img { width: 100%; image-rendering: pixelated; border: 1px solid rgba(128,128,128,.4); display: block; }
  figcaption { font-size: 11px; opacity: .7; margin-top: .2rem; word-break: break-all; }
  .warn { color: #b7791f; }
  .bad { color: #c0392b; font-size: .7em; vertical-align: middle; }
  .dim { opacity: .55; }
</style>
<h1>B59 — spray-paint texture proof</h1>
<p class="dim">${esc(report.subjects.length)} subjects x ${esc(report.subjects[0].views.length)} views · SDXL + depth-ControlNet on the RTX 4090 · authored-UV back-projection</p>
<div class="banner">PROOF-ONLY — NOT ADMISSIBLE EVIDENCE. No thresholds declared, no G-gate claimed.
Most texels are gap-filled rather than camera-observed; do not treat these pages as ground truth.</div>
${sections.join("\n")}
`, "utf8");
console.log(out);
