import type { LoaderLayer, LoaderPreset } from "./loaders";

/**
 * Framework snippets for one loader (same four-tab shape /synth and the gallery
 * use). Everything a loader needs is public API: a flat quad, `addEffectLayer`
 * per stock effect, and a `requestAnimationFrame` writing `time` (and, for a
 * determinate loader, its driven `progress` param).
 *
 * The HTML tab doubles as the CodePen body. We hand-write it rather than calling
 * `buildGlyphInteractiveExport` because that exporter mounts exactly ONE stock
 * effect and only drives `time` — a masked progress bar is two layers with a
 * second driven param, which it has no way to express.
 */
export type LoaderTab = "html" | "vanilla" | "react" | "vue";

export const LOADER_TAB_ORDER: LoaderTab[] = ["html", "vanilla", "react", "vue"];
export const LOADER_TAB_LABEL: Record<LoaderTab, string> = { html: "HTML", vanilla: "JS", react: "React", vue: "Vue" };

/** Pin the CDN snippets to the published version the site is built against. */
const CDN_VERSION = "latest";
const CDN_GLYPHCSS = `https://esm.sh/glyphcss@${CDN_VERSION}`;
const CDN_EFFECTS = `https://esm.sh/@glyphcss/effects@${CDN_VERSION}?deps=glyphcss@${CDN_VERSION}`;

function params(layer: LoaderLayer, indent: string): string {
  const entries = Object.entries(layer.params).map(([k, v]) => `${indent}  ${k}: ${JSON.stringify(v)},`);
  return `{\n${entries.join("\n")}\n${indent}}`;
}

/** The per-frame body shared by every framework tab: one clock, N layers. */
function driveBody(loader: LoaderPreset, ref: (i: number) => string, indent: string): string {
  const lines: string[] = [];
  loader.layers.forEach((layer, i) => {
    if (layer.timeScale) lines.push(`${indent}${ref(i)}.params.time = t * ${layer.timeScale};`);
    if (layer.progress) {
      lines.push(`${indent}// Determinate: one empty→full sweep every ${layer.progress.cycle}s.`);
      lines.push(`${indent}${ref(i)}.params.${layer.progress.param} = (t % ${layer.progress.cycle}) / ${layer.progress.cycle};`);
    }
  });
  return lines.join("\n");
}

function layerNames(loader: LoaderPreset): string[] {
  return loader.layers.map((l, i) => (loader.layers.length === 1 ? "layer" : `layer${i + 1}`));
}

const QUAD = `// A flat quad with 0..1 UVs — the loader is a texture on a plane.
const quad = [{
  vertices: [[-3, -3, 0], [3, -3, 0], [3, 3, 0], [-3, 3, 0]],
  uvs: [[0, 0], [1, 0], [1, 1], [0, 1]],
  color: "#243244",
}];`;

function buildVanilla(loader: LoaderPreset, cols: number, rows: number): string {
  const names = layerNames(loader);
  const mounts = loader.layers.map((l, i) => `const ${names[i]} = scene.addEffectLayer({
  effect: getGlyphEffect(${JSON.stringify(l.effectId)}),
  blend: ${JSON.stringify(l.blend)},
  target: "surfaces",
  params: ${params(l, "")},
});`).join("\n\n");

  return `import { createGlyphScene, createGlyphOrthographicCamera } from "glyphcss";
import { getGlyphEffect } from "@glyphcss/effects";

${QUAD}

const host = document.querySelector("#loader");
const camera = createGlyphOrthographicCamera({ rotX: 0, rotY: 0, zoom: 20 });

const scene = createGlyphScene(host, {
  camera,
  // A loader is a fixed-size widget, so state the grid rather than autoSize.
  cols: ${cols},
  rows: ${rows},
  mode: "solid",
  useColors: true,
  doubleSided: true,
  directionalLight: { direction: [0.2, 0.3, 0.93], intensity: 0.85 },
  ambientLight: { intensity: 0.45 },
});

scene.add(quad);
scene.fit();

${mounts}

let start = performance.now();
function frame(now) {
  const t = (now - start) / 1000;
${driveBody(loader, (i) => names[i]!, "  ")}
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);`;
}

function buildReact(loader: LoaderPreset, cols: number, rows: number): string {
  const names = layerNames(loader);
  const refs = names.map((n) => `  const ${n} = useRef<GlyphEffectLayerHandle | null>(null);`).join("\n");
  const mounts = loader.layers.map((l, i) => `      <GlyphEffectLayer
        ref={${names[i]}}
        effect={getGlyphEffect(${JSON.stringify(l.effectId)})!}
        blend=${JSON.stringify(l.blend)}
        target="surfaces"
        params={${params(l, "        ")}}
      />`).join("\n");

  return `import { useEffect, useRef } from "react";
import { GlyphScene, GlyphOrthographicCamera, GlyphMesh, GlyphEffectLayer, type GlyphEffectLayerHandle } from "@glyphcss/react";
import { getGlyphEffect } from "@glyphcss/effects";

${QUAD}

export function Loader() {
${refs}

  useEffect(() => {
    const start = performance.now();
    let raf = 0;
    const frame = (now: number) => {
      const t = (now - start) / 1000;
${driveBody(loader, (i) => `${names[i]}.current!`, "      ")}
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <GlyphScene cols={${cols}} rows={${rows}} mode="solid" useColors doubleSided>
      <GlyphOrthographicCamera rotX={0} rotY={0} zoom={20} />
      <GlyphMesh polygons={quad} />
${mounts}
    </GlyphScene>
  );
}`;
}

function buildVue(loader: LoaderPreset, cols: number, rows: number): string {
  const names = layerNames(loader);
  const refs = names.map((n) => `const ${n} = ref<GlyphEffectLayerHandle | null>(null);`).join("\n");
  const mounts = loader.layers.map((l, i) => `    <GlyphEffectLayer
      :ref="${names[i]}"
      :effect="getGlyphEffect(${JSON.stringify(l.effectId)})"
      blend=${JSON.stringify(l.blend)}
      target="surfaces"
      :params="${names[i]}Params"
    />`).join("\n");
  const paramConsts = loader.layers.map((l, i) => `const ${names[i]}Params = ${params(l, "")};`).join("\n");

  return `<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import { GlyphScene, GlyphOrthographicCamera, GlyphMesh, GlyphEffectLayer, type GlyphEffectLayerHandle } from "@glyphcss/vue";
import { getGlyphEffect } from "@glyphcss/effects";

${QUAD}

${paramConsts}

${refs}

let raf = 0;
onMounted(() => {
  const start = performance.now();
  const frame = (now: number) => {
    const t = (now - start) / 1000;
${driveBody(loader, (i) => `${names[i]}.value!`, "    ")}
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
});
onBeforeUnmount(() => cancelAnimationFrame(raf));
</script>

<template>
  <GlyphScene :cols="${cols}" :rows="${rows}" mode="solid" use-colors double-sided>
    <GlyphOrthographicCamera :rot-x="0" :rot-y="0" :zoom="20" />
    <GlyphMesh :polygons="quad" />
${mounts}
  </GlyphScene>
</template>`;
}

/** Self-contained page: CDN imports only, no build step. Also the CodePen body. */
function buildHtmlJs(loader: LoaderPreset, cols: number, rows: number): string {
  const names = layerNames(loader);
  const mounts = loader.layers.map((l, i) => `const ${names[i]} = scene.addEffectLayer({
  effect: getGlyphEffect(${JSON.stringify(l.effectId)}),
  blend: ${JSON.stringify(l.blend)},
  target: "surfaces",
  params: ${params(l, "")},
});`).join("\n\n");

  return `import { createGlyphScene, createGlyphOrthographicCamera } from "${CDN_GLYPHCSS}";
// ?deps pins ONE shared glyphcss instance across both CDN imports.
import { getGlyphEffect } from "${CDN_EFFECTS}";

${QUAD}

const host = document.querySelector("#loader");
const camera = createGlyphOrthographicCamera({ rotX: 0, rotY: 0, zoom: 20 });

const scene = createGlyphScene(host, {
  camera,
  cols: ${cols},
  rows: ${rows},
  mode: "solid",
  useColors: true,
  doubleSided: true,
  directionalLight: { direction: [0.2, 0.3, 0.93], intensity: 0.85 },
  ambientLight: { intensity: 0.45 },
});

scene.add(quad);
scene.fit();

${mounts}

let start = performance.now();
function frame(now) {
  const t = (now - start) / 1000;
${driveBody(loader, (i) => names[i]!, "  ")}
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);`;
}

const PEN_HTML = `<div id="loader"></div>`;
const PEN_CSS = `body {
  margin: 0;
  min-height: 100vh;
  display: grid;
  place-items: center;
  background: #07090d;
}
#loader .glyph-output { font-size: 14px; line-height: 1; }`;

function buildHtml(loader: LoaderPreset, cols: number, rows: number): string {
  return `<!doctype html>
<meta charset="utf-8" />
<title>${loader.label} — glyphcss loader</title>
<style>
${PEN_CSS}
</style>

${PEN_HTML}

<script type="module">
${buildHtmlJs(loader, cols, rows)}
</script>`;
}

export function generateLoaderSnippets(loader: LoaderPreset, cols: number, rows: number): Record<LoaderTab, string> {
  return {
    html: buildHtml(loader, cols, rows),
    vanilla: buildVanilla(loader, cols, rows),
    react: buildReact(loader, cols, rows),
    vue: buildVue(loader, cols, rows),
  };
}

/** CodePen's prefill contract: a form POST carrying one JSON `data` field —
 *  the same shape `glyphCodepenPrefill` produces, built here because the pen
 *  body is our multi-layer snippet rather than an interactive-export result. */
export function loaderCodepenPrefill(loader: LoaderPreset, cols: number, rows: number): { action: string; data: string } {
  return {
    action: "https://codepen.io/pen/define",
    data: JSON.stringify({
      title: `glyphcss — ${loader.label} loader`,
      html: PEN_HTML,
      css: PEN_CSS,
      js: buildHtmlJs(loader, cols, rows),
      editors: "110",
    }),
  };
}

export function openLoaderCodepen(loader: LoaderPreset, cols: number, rows: number): void {
  const { action, data } = loaderCodepenPrefill(loader, cols, rows);
  const form = document.createElement("form");
  form.method = "POST";
  form.action = action;
  form.target = "_blank";
  const field = document.createElement("input");
  field.type = "hidden";
  field.name = "data";
  field.value = data;
  form.appendChild(field);
  document.body.appendChild(form);
  form.submit();
  form.remove();
}
