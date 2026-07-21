// Generate per-page social-preview (Open Graph) images.
//
// Each image reuses the landing `og.png` template — dark canvas, the
// `[ glyphcss ]` wordmark + a page-specific tagline on the left, and the
// page's REAL glyphcss ASCII render on the right. We capture the render live
// (Playwright → the running preview server) so effect layers (field-synth,
// Matrix rain) bake into the still exactly as a visitor sees them; a static
// `compileScene` can't evaluate a mounted effect.
//
// Prereq: `pnpm --filter @glyphcss/website build && astro preview --port 4323`.
// Run:    node website/scripts/generate-og.mjs [slug ...]   (default: all)
//
// Output: website/public/og/<slug>.png  (1200×630)

import { chromium } from "playwright";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(__dirname, "../public/og");
const BASE = process.env.OG_BASE ?? "http://localhost:4323";

const W = 1200;
const H = 630;
// Render panel on the right half of the canvas.
const PANEL = { x: 600, y: 70, w: 548, h: 490 };

const PAGES = [
  {
    slug: "synth",
    url: "/synth",
    tagline: ["modular ASCII ", "field synth"],
    sub: "Stack oscillators into moiré interference — a live in-browser synthesizer for glyph fields.",
    foot: "glyphcss.com/synth",
    settle: 3800,
  },
  {
    slug: "wordart",
    // Capture a single frame-filling word in the brand yellow→orange gradient
    // with auto-spin off (front-facing, reproducible) — the default two-line
    // bevel-gold "Glyph/CSS" reads muddy at OG scale.
    url: "/wordart?text=GLYPH&fill=gradient&ga=%23ffd23f&gb=%23ff5e3a&spin=0",
    tagline: ["3D ASCII text ", "from any font"],
    sub: "Extrude any Google font into shaded, gradient, block-textured glyphs — one <pre>.",
    foot: "glyphcss.com/wordart",
    settle: 3800,
  },
  {
    slug: "gallery",
    // ?model=<hash of "glb-duck"> loads the classic glTF Duck.
    url: "/gallery?model=2604777134",
    tagline: ["the ASCII ", "render playground"],
    sub: "Drop in OBJ · glTF · GLB · STL · .vox and tune camera, density, and shading live.",
    foot: "glyphcss.com/gallery",
    settle: 5500,
  },
  {
    slug: "parthenon",
    url: "/examples/parthenon",
    tagline: ["the Parthenon, ", "in Matrix rain"],
    sub: "An octastyle Doric temple built from primitives, green rain streaming down its columns.",
    foot: "glyphcss.com/examples/parthenon",
    settle: 4200,
  },
  {
    slug: "image",
    url: "/examples/image",
    tagline: ["any image, ", "as glyphs"],
    sub: "Drop in a photo and watch it rasterise into shaded, colored ASCII in real time.",
    foot: "glyphcss.com/examples/image",
    settle: 4200,
    // The page renders nothing until an image is dropped — feed it a sample
    // through its hidden file input so the OG shows a real rasterised photo. A
    // bright, full-frame texture rasterises far better than a screenshot (whose
    // black margins map to blank glyphs).
    inputFile: { selector: "#file", path: "public/jslogo.png" },
  },
  {
    slug: "world",
    url: "/examples/world",
    tagline: ["ASCII ", "Earth"],
    sub: "ETOPO1 global topography rasterised into glyphs. Isometric, drag to orbit.",
    foot: "glyphcss.com/examples/world",
    settle: 4200,
  },
  {
    slug: "flatmap",
    url: "/examples/flatmap",
    tagline: ["ASCII ", "iso world map"],
    sub: "The whole planet flattened into a tiled isometric glyph map.",
    foot: "glyphcss.com/examples/flatmap",
    settle: 4200,
  },
  {
    slug: "city-lab",
    url: "/examples/city-lab",
    tagline: ["endless ", "ASCII city"],
    sub: "A procedural city rendered as colored ASCII on a performance-first render loop.",
    foot: "glyphcss.com/examples/city-lab",
    settle: 4200,
  },
];

// Fit a monospace grid (cols × rows) into a pixel box. Monospace advance ≈
// 0.6·fontSize; line box = fontSize (the render pre uses line-height == size).
function fitFont(cols, rows, box) {
  const byW = box.w / (cols * 0.6);
  const byH = box.h / rows;
  return Math.max(3, Math.min(byW, byH));
}

const esc = (s) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function templateHtml(page, render) {
  const font = Math.floor(fitFont(render.cols, render.rows, PANEL) * 100) / 100;
  const [t0, t1] = page.tagline;
  const boost = page.boost ? `filter: ${page.boost};` : "";
  return `<!doctype html><html><head><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700&display=swap" rel="stylesheet">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: ${W}px; height: ${H}px; }
  body {
    position: relative; overflow: hidden;
    background: #0d0f12;
    font-family: "JetBrains Mono", ui-monospace, monospace;
  }
  /* subtle vignette so the render never clips a hard edge */
  body::after {
    content: ""; position: absolute; inset: 0; pointer-events: none;
    background: radial-gradient(120% 90% at 78% 50%, transparent 55%, rgba(0,0,0,0.55) 100%);
  }
  .left { position: absolute; left: 72px; top: 0; height: 100%; width: 520px;
    display: flex; flex-direction: column; justify-content: center; gap: 22px; z-index: 2; }
  .mark { font-size: 62px; font-weight: 700; letter-spacing: 0.01em; line-height: 1; }
  .mark .b { color: #f0531f; }
  .mark .n { color: #efe2c6; }
  .tag { font-size: 33px; font-weight: 500; line-height: 1.18; color: #d8d2c4; }
  .tag .k { color: #f0531f; }
  .sub { font-size: 20px; line-height: 1.5; color: #9a958a; max-width: 470px; }
  .foot { font-size: 18px; color: #6f6a60; margin-top: 8px; }
  .foot b { color: #b9b2a4; font-weight: 500; }
  .stage { position: absolute; left: ${PANEL.x}px; top: ${PANEL.y}px;
    width: ${PANEL.w}px; height: ${PANEL.h}px;
    display: flex; align-items: center; justify-content: center; z-index: 1; }
  .stage pre { margin: 0; font-family: "JetBrains Mono", ui-monospace, monospace;
    font-size: ${font}px; line-height: ${font}px; white-space: pre;
    color: #cfe9d8; text-shadow: 0 0 1px rgba(0,0,0,0.4); ${boost} }
</style></head>
<body>
  <div class="left">
    <div class="mark"><span class="b">[</span><span class="n">&nbsp;glyphcss&nbsp;</span><span class="b">]</span></div>
    <div class="tag">${esc(t0)}<span class="k">${esc(t1)}</span></div>
    <div class="sub">${esc(page.sub)}</div>
    <div class="foot"><b>${page.foot}</b></div>
  </div>
  <div class="stage"><pre>${render.html}</pre></div>
</body></html>`;
}

async function capture(page, browser) {
  const pg = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  await pg.goto(BASE + page.url, { waitUntil: "networkidle", timeout: 45000 });
  if (page.inputFile) {
    await pg.setInputFiles(
      page.inputFile.selector,
      path.resolve(__dirname, "..", page.inputFile.path),
    );
  }
  await pg.waitForTimeout(page.settle);
  const render = await pg.evaluate(() => {
    const pres = [...document.querySelectorAll("pre")];
    let best = null, bestLen = -1;
    for (const p of pres) {
      const len = (p.textContent || "").replace(/\s/g, "").length;
      if (len > bestLen) { bestLen = len; best = p; }
    }
    if (!best) return null;

    // Walk the DOM into a grid of { ch, color } cells so we can crop the render
    // to its content bounding box — the raw render is padded with blank cells
    // (a small mesh in a big viewport), which would otherwise shrink it in the
    // OG panel. Cropping makes each card fill its space.
    const grid = [[]];
    const walk = (node, color) => {
      for (const n of node.childNodes) {
        if (n.nodeType === 3) {
          for (const ch of n.nodeValue) {
            if (ch === "\n") grid.push([]);
            else grid[grid.length - 1].push({ ch, color });
          }
        } else if (n.nodeType === 1) {
          walk(n, n.style && n.style.color ? n.style.color : color);
        }
      }
    };
    walk(best, null);
    while (grid.length && grid[grid.length - 1].length === 0) grid.pop();

    let minC = Infinity, maxC = -1, minR = Infinity, maxR = -1;
    grid.forEach((row, r) => row.forEach((cell, c) => {
      if (cell.ch !== " ") {
        if (c < minC) minC = c;
        if (c > maxC) maxC = c;
        if (r < minR) minR = r;
        if (r > maxR) maxR = r;
      }
    }));
    if (maxC < 0) return null;
    const PAD = 1;
    minC = Math.max(0, minC - PAD); minR = Math.max(0, minR - PAD);
    maxC += PAD; maxR += PAD;

    const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    let html = "";
    for (let r = minR; r <= maxR; r++) {
      const row = grid[r] || [];
      let run = "", runColor;
      const flush = () => {
        if (!run) return;
        html += runColor ? `<span style="color:${runColor}">${esc(run)}</span>` : esc(run);
        run = "";
      };
      for (let c = minC; c <= maxC; c++) {
        const cell = row[c] || { ch: " ", color: null };
        const col = cell.ch === " " ? null : cell.color;
        if (col !== runColor) { flush(); runColor = col; }
        run += cell.ch;
      }
      flush();
      if (r < maxR) html += "\n";
    }
    return { html, cols: maxC - minC + 1, rows: maxR - minR + 1 };
  });
  if (!render) throw new Error(`no <pre> found on ${page.url}`);
  await pg.setContent(templateHtml(page, render), { waitUntil: "networkidle" });
  await pg.waitForTimeout(500); // let the webfont settle
  const el = await pg.$("body");
  const file = path.join(OUT_DIR, `${page.slug}.png`);
  await el.screenshot({ path: file, clip: { x: 0, y: 0, width: W, height: H } });
  await pg.close();
  console.log(`  ✓ ${page.slug}.png  (grid ${render.cols}×${render.rows})`);
}

const want = process.argv.slice(2);
const pages = want.length ? PAGES.filter((p) => want.includes(p.slug)) : PAGES;
const browser = await chromium.launch();
console.log(`Generating ${pages.length} OG image(s) → public/og/`);
for (const p of pages) {
  try { await capture(p, browser); }
  catch (e) { console.error(`  ✗ ${p.slug}: ${e.message}`); }
}
await browser.close();
