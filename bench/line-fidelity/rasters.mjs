// Step 1 — glyph rasters measured in headless Chromium with the REAL faces.
//
// Each candidate glyph is drawn alone into a padded canvas (canvas readback,
// alpha = coverage) whose inner box is exactly one cell: width = the face's
// measured advance, height = em (glyphcss renders at line-height 1). The
// baseline sits where a line-height:1 line box puts it: half-leading
// (em - (ascent + descent)) / 2 above the ascent. Ink that overflows the cell
// box is kept on the padding. A DOM screenshot of a real multi-row <pre> then
// validates the canvas masks + additive compositing (see validateComposite).
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { CACHE, DPR, EM, FACES, PAD_X, PAD_Y, ROOT, atlasJson, cp, fontFaceCss, readJson, writeJson } from "./common.mjs";
import { woff2CodePoints } from "./woff2cmap.mjs";

/** Sub-pixel phases each mask is captured at (Chromium positions outline glyphs at fractional device px). */
export const PHASES = 4;
import { compositeGrid } from "./composite.mjs";

/** Extended candidate set: line-ish ASCII, box drawing, block elements, braille, a few dots. */
export function extendedCandidates() {
  const out = [];
  for (const g of "-_=~|/\\()[]<>^v',.`:;+*x") out.push(g);
  out.push("‾", "·", "˙", "•", "⋅", "∙");
  for (let c = 0x2500; c <= 0x257f; c++) out.push(String.fromCodePoint(c));
  for (let c = 0x2580; c <= 0x259f; c++) out.push(String.fromCodePoint(c));
  for (let c = 0x2800; c <= 0x28ff; c++) out.push(String.fromCodePoint(c));
  return out;
}

const PAGE_JS = `
window.measureFace = async (family, items, em, padX, padY, dpr, phases) => {
  // Real DOM text: every glyph alone in its own <pre> (glyphcss's output
  // rule: line-height 1, no ligatures/kerning), tiled on a transparent page,
  // screenshotted once (omitBackground → alpha = coverage). Tiles sit on whole
  // CSS px so each glyph origin lands on a whole device px.
  document.querySelectorAll('.tile').forEach(e => e.remove());
  await document.fonts.load(em / dpr + 'px "' + family + '"', items.map(i => i.text).join(''));
  await document.fonts.ready;
  const style = 'position:absolute;margin:0;padding:0;font-family:"' + family + '";font-size:' + (em / dpr) + 'px;line-height:1;white-space:pre;font-variant-ligatures:none;font-kerning:none;font-feature-settings:normal;text-rendering:optimizeSpeed;color:#000';
  // Cell metrics from the DOM itself: advance from a 20-glyph run, baseline from an inline-block marker.
  const m = document.createElement('pre'); m.className = 'tile'; m.style.cssText = style + ';left:0;top:0';
  const run = document.createElement('span'); run.textContent = items[0].text.repeat(20);
  const mark = document.createElement('span'); mark.style.cssText = 'display:inline-block;width:0;height:0;vertical-align:baseline';
  m.append(run, mark); document.body.appendChild(m);
  const advanceCss = run.getBoundingClientRect().width / 20;
  const baselineCss = mark.getBoundingClientRect().top - m.getBoundingClientRect().top;
  const lineCss = m.getBoundingClientRect().height;
  m.remove();
  const advance = advanceCss * dpr;
  const tileW = Math.ceil((Math.ceil(advance) + 2 * padX) / dpr), tileH = Math.ceil((em + 2 * padY) / dpr);
  const perRow = 48;
  const tiles = [];
  items.forEach((it, i) => {
    const x = (i % perRow) * tileW, y = Math.floor(i / perRow) * tileH;
    const pre = document.createElement('pre'); pre.className = 'tile';
    pre.style.cssText = style + ';left:' + (x + padX / dpr + (it.phase || 0) / (phases * dpr)) + 'px;top:' + (y + padY / dpr) + 'px';
    const s = document.createElement('span'); s.textContent = it.text; pre.appendChild(s);
    document.body.appendChild(pre);
    tiles.push({ it, x, y, span: s });
  });
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  // Per-glyph advance from a 32-glyph run (a single span's width snaps to 1/64 CSS px).
  const probe = document.createElement('pre'); probe.className = 'tile'; probe.style.cssText = style + ';left:0;top:0;visibility:hidden';
  document.body.appendChild(probe);
  const meta = tiles.map(t => {
    probe.textContent = t.it.text.repeat(32);
    return { glyph: t.it.glyph, phase: t.it.phase || 0, x: t.x * dpr, y: t.y * dpr, advance: probe.getBoundingClientRect().width / 32 * dpr };
  });
  probe.remove();
  return { advance, baseline: baselineCss * dpr, lineHeight: lineCss * dpr, tileW: tileW * dpr, tileH: tileH * dpr, rowsUsed: Math.ceil(items.length / perRow), perRow, meta };
};
window.decodePng = async (b64) => {
  const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
  const cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height;
  const ctx = cv.getContext('2d'); ctx.drawImage(img, 0, 0);
  const d = ctx.getImageData(0, 0, img.width, img.height).data;
  let bin = '';
  const CH = 0x8000;
  for (let i = 0; i < img.width * img.height; i += CH) {
    const n = Math.min(CH, img.width * img.height - i);
    const a = new Uint8Array(n);
    for (let j = 0; j < n; j++) a[j] = d[(i + j) * 4 + 3];
    bin += String.fromCharCode.apply(null, a);
  }
  return { W: img.width, H: img.height, alpha: btoa(bin) };
};
`;

async function newPage(browser) {
  const page = await browser.newPage({ deviceScaleFactor: DPR, viewport: { width: 1200, height: 1600 } });
  await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>${fontFaceCss()} body{margin:0;background:transparent}</style></head><body><script>${PAGE_JS}</script></body></html>`);
  return page;
}

/** The text a face really receives for glyph g (atlas: slot-0 PUA code point), or null if the face cannot draw it. */
export function faceTextFor(face, g, ctx) {
  if (g === " ") return " ";
  if (face === "atlas") {
    const idx = ctx.atlas.glyphs.indexOf(g);
    if (idx < 0) return null;
    const ext = ctx.atlas.extension;
    const code = ext && idx >= ext.glyphOffset ? ext.puaStart + idx - ext.glyphOffset : ctx.atlas.puaStart + idx;
    return String.fromCodePoint(code);
  }
  return ctx.monoCps.has(g.codePointAt(0)) ? g : null;
}

function maskFile(face) { return path.join(CACHE, `masks-${face}.json`); }

export async function buildRasters(candidates, { force = false } = {}) {
  const ctx = { atlas: atlasJson(), monoCps: woff2CodePoints(path.join(ROOT, "website/public/fonts/glyph-mono.woff2")) };
  const key = JSON.stringify({ candidates, EM, PAD_X, PAD_Y, v: 5, PHASES });
  const result = {};
  let browser = null;
  for (const face of Object.keys(FACES)) {
    const file = maskFile(face);
    if (!force && fs.existsSync(file)) {
      const cached = readJson(file);
      if (cached.key === key) { result[face] = cached; continue; }
    }
    browser ??= await chromium.launch();
    const page = await newPage(browser);
    const drawable = [];
    const absent = [];
    for (const g of candidates) {
      const text = faceTextFor(face, g, ctx);
      if (text === null) absent.push(g); else for (let phase = 0; phase < PHASES; phase++) drawable.push({ glyph: g, text, phase });
    }
    // Reference advance: a glyph every face certainly has ("-"), first in the list.
    drawable.unshift({ glyph: "-", text: faceTextFor(face, "-", ctx) });
    const r = await page.evaluate(([fam, items, em, px, py, dpr, ph]) => window.measureFace(fam, items, em, px, py, dpr, ph), [FACES[face].family, drawable, EM, PAD_X, PAD_Y, DPR, PHASES]);
    const shot = await page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: (r.perRow * r.tileW) / DPR, height: (r.rowsUsed * r.tileH) / DPR } });
    const dec = await page.evaluate((b64) => window.decodePng(b64), shot.toString("base64"));
    const sheet = Buffer.from(dec.alpha, "base64");
    const cellW = r.advance;
    const W = Math.ceil(cellW) + 2 * PAD_X, H = EM + 2 * PAD_Y;
    const glyphs = {};
    for (const mt of r.meta.slice(1)) {
      const a = Buffer.alloc(W * H);
      let ink = 0;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const v = sheet[(mt.y + y) * dec.W + mt.x + x]; a[y * W + x] = v; ink += v; }
      const g = mt.glyph;
      if (mt.phase > 0) { glyphs[g].phases[mt.phase] = a.toString("base64"); continue; }
      const blankByDesign = g === " " || g === "\u2800";
      const advOk = Math.abs(mt.advance - cellW) < 0.01;
      const inkOk = ink > 0 || blankByDesign;
      glyphs[g] = { cp: cp(g), advance: mt.advance, W, H, ink: ink / 255, phases: [a.toString("base64")], safe: advOk && inkOk, reason: advOk ? (inkOk ? "ok" : "no ink") : `advance ${mt.advance} != cell ${cellW}` };
    }
    const rec = { key, face, phases: PHASES, family: FACES[face].family, cellW, cellH: r.lineHeight, baseline: r.baseline, padX: PAD_X, padY: PAD_Y, glyphs };
    writeJson(file, rec);
    result[face] = rec;
    await page.close();
  }
  if (browser) await browser.close();
  return result;
}

/** Decode a cached mask record into Float32 coverage. */
export function loadMasks(rec) {
  const masks = new Map();
  for (const [g, m] of Object.entries(rec.glyphs)) {
    if (!m.phases) continue;
    const phases = m.phases.map((b64) => {
      const bin = Buffer.from(b64, "base64");
      const a = new Float32Array(bin.length);
      for (let i = 0; i < bin.length; i++) a[i] = bin[i] / 255;
      return a;
    });
    masks.set(g, { W: m.W, H: m.H, a: phases[0], phases, safe: m.safe });
  }
  return { face: rec.face, cellW: rec.cellW, cellH: rec.cellH, padX: rec.padX, padY: rec.padY, nPhases: rec.phases, masks };
}

/**
 * Validate the per-glyph masks + additive compositing against a real DOM <pre>
 * screenshot (omitBackground → alpha = coverage) of a multi-row string.
 */
export async function validateComposite(faces) {
  const ctx = { atlas: atlasJson(), monoCps: woff2CodePoints(path.join(ROOT, "website/public/fonts/glyph-mono.woff2")) };
  const rows = ["─┼─│┌┐└┘├┤", "/\\-_|‾▏▕▔·", "⠿⣀⡇⢸⠉⣿⠒⠤⡠⢄", "│╳┬┴═║+*x.", "▁▂▄█▌▐░▒▓'"];
  const browser = await chromium.launch();
  const page = await newPage(browser);
  const report = {};
  for (const face of Object.keys(FACES)) {
    const fm = faces[face];
    const grid = rows.map((r) => [...r].map((g) => (faceTextFor(face, g, ctx) !== null && fm.masks.has(g) ? g : " ")));
    const text = grid.map((r) => r.map((g) => faceTextFor(face, g, ctx) ?? " ").join("")).join("\n");
    const leftCss = 10, topCss = 20;
    await page.evaluate(([t, fam, l, tp]) => {
      document.querySelectorAll("pre").forEach((p) => p.remove());
      const pre = document.createElement("pre");
      pre.style.cssText = `position:absolute;left:${l}px;top:${tp}px;margin:0;padding:0;font-family:"${fam}";font-size:16px;line-height:1;white-space:pre;font-variant-ligatures:none;font-kerning:none;text-rendering:optimizeSpeed;color:#000`;
      pre.textContent = t;
      document.body.appendChild(pre);
      return document.fonts.ready;
    }, [text, FACES[face].family, leftCss, topCss]);
    const cols = rows[0].length;
    const clip = { x: 0, y: 0, width: Math.ceil(leftCss + (cols * fm.cellW) / DPR + 12), height: Math.ceil(topCss + (rows.length * fm.cellH) / DPR + 12) };
    const png = await page.screenshot({ omitBackground: true, clip });
    const dec = await page.evaluate((b64) => window.decodePng(b64), png.toString("base64"));
    const domA = Buffer.from(dec.alpha, "base64");
    const dom = { W: dec.W, H: dec.H, a: domA };
    const comp = compositeGrid(fm, grid, { originX: leftCss * DPR, originY: topCss * DPR, W: dom.W, H: dom.H });
    let absErr = 0, inkDom = 0, inkComp = 0, maxErr = 0;
    for (let i = 0; i < dom.a.length; i++) {
      const d = dom.a[i] / 255, c = comp.img[i];
      const e = Math.abs(d - c);
      absErr += e; inkDom += d; inkComp += c; if (e > maxErr) maxErr = e;
    }
        report[face] = { relL1: absErr / inkDom, inkDom, inkComp, inkRatio: inkComp / inkDom, maxPixelErr: maxErr, rows: grid.map((r) => r.join("")) };
  }
  await browser.close();
  return report;
}
