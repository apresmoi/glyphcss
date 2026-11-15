// Generate the animated images the root README shows: four turntables and the
// twinkling wordmark. GitHub strips scripts and styles from a README but shows
// an SVG as an image, and an SVG image keeps its own animation.
//
// Prereq: run `pnpm --filter @glyphcss/website dev` on port 4323 (or set
// README_BASE); the wordmark is the home page's build-time render.
// Run:    node website/scripts/generate-readme-images.mjs
//
// Output: assets/readme/*.svg

import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { buildGlyphFramesSvgExport } from "glyphcss";
import { loadMeshFromFile } from "@glyphcss/compile";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.resolve(__dirname, "../public");
const OUT_DIR = path.resolve(__dirname, "../../assets/readme");
const BASE = process.env.README_BASE ?? "http://localhost:4323";

const MODELS = {
  apple: "gallery/glb/apple.glb",
  castle: "gallery/obj/castle.obj",
  house: "gallery/glb/poly-pizza/house.glb",
  coliseum: "gallery/obj/coliseum.obj",
};
const FONT_SIZE = 11;
const COLS = 60;
const ROWS = 40;
// Every model sits centred in the same box, so the row lines up in the README.
const BOX = { width: Math.ceil(COLS * FONT_SIZE * 0.61), height: ROWS * FONT_SIZE };

await mkdir(OUT_DIR, { recursive: true });

for (const [name, file] of Object.entries(MODELS)) {
  const { polygons } = await loadMeshFromFile(path.join(PUBLIC, file));
  const { svg, width, height, frameCount } = buildGlyphFramesSvgExport(polygons, {
    frameCount: 135,
    durationSec: 9,
    cols: COLS,
    rows: ROWS,
    fit: true,
    fontSizePx: FONT_SIZE,
    autoCenter: true,
    rotX: 50,
    // z is up in these models. The light sits high so faces stay bright and
    // the darkness comes from cast shadows, not from side shading.
    directionalLight: { direction: [-0.45, 0.35, 0.82], intensity: 1.1 },
    ambientLight: { intensity: 0.6 },
    shadow: { opacity: 0.8, lift: 0 },
  });
  const x = (BOX.width - width) / 2;
  const y = (BOX.height - height) / 2;
  const boxed =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${BOX.width}" height="${BOX.height}" viewBox="0 0 ${BOX.width} ${BOX.height}">` +
    svg.replace("<svg ", `<svg x="${x}" y="${y}" `) +
    "</svg>";
  await writeFile(path.join(OUT_DIR, `${name}.svg`), boxed);
  console.log(`${name}.svg  ${frameCount} frames, ${Math.round(boxed.length / 1024)} KB`);
}

// The wordmark is one frame of text; a sample of its stars fades on staggered
// delays, with the keyframes the home page uses.
const home = await (await fetch(`${BASE}/`)).text();
const pre = home.match(/class="hero-wordmark"[\s\S]*?<pre[^>]*>([\s\S]*?)<\/pre>/)?.[1];
if (!pre) throw new Error(`no wordmark at ${BASE}/ (is the dev server running?)`);
const plain = pre.split("\n").map((line) => line.replace(/<[^>]+>/g, ""));
const indent = Math.min(...plain.filter((line) => line.trim()).map((line) => line.match(/^ */)[0].length));
const lines = pre.split("\n").map((line) => line.replace(new RegExp(`^ {0,${indent}}`), ""));
const WORDMARK_FONT_SIZE = 12;
const PAD = 4;
const width = Math.ceil((Math.max(...plain.map((line) => line.trimEnd().length)) - indent) * WORDMARK_FONT_SIZE * 0.6) + PAD * 2;
const height = lines.length * WORDMARK_FONT_SIZE + PAD * 2;
// An SVG image cannot load a file, so the font travels inside it.
const font = (await readFile(path.join(PUBLIC, "fonts/glyph-mono.woff2"))).toString("base64");
for (const [theme, flash] of [["dark", "#f4f6f8"], ["light", "#111418"]]) {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<foreignObject x="${PAD}" y="${PAD}" width="${width - PAD * 2}" height="${height - PAD * 2}"><div xmlns="http://www.w3.org/1999/xhtml"><style>` +
    `@font-face{font-family:"Glyph Mono";src:url(data:font/woff2;base64,${font}) format("woff2")}` +
    `pre{margin:0;white-space:pre;font-family:"Glyph Mono",monospace;font-size:${WORDMARK_FONT_SIZE}px;line-height:1}` +
    `.tw{animation:tw 4s ease-in-out var(--tw-delay) infinite}` +
    `@keyframes tw{0%,70%,100%{opacity:1;text-shadow:none}80%{opacity:.25}88%{opacity:1;color:${flash};text-shadow:0 0 6px currentColor}}` +
    `@media (prefers-reduced-motion:reduce){.tw{animation:none}}` +
    `</style><pre>${lines.join("\n")}</pre></div></foreignObject></svg>`;
  await writeFile(path.join(OUT_DIR, `wordmark-${theme}.svg`), svg);
  console.log(`wordmark-${theme}.svg  ${Math.round(svg.length / 1024)} KB`);
}
