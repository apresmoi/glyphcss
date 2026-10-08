import type { Polygon, Vec2, Vec3 } from "@glyphcss/core";
import { bakeSolidTextureSampledPolygons, loadMesh } from "@glyphcss/core";
import type { GlyphInteraction, GlyphStaticEncoding } from "glyphcss";
import { encodeStaticGlyphHtml } from "glyphcss";
import { primitiveGeometrySize } from "../data/presetList";
import { type GalleryEffectDefinition, galleryEffectExportName } from "../model/effects";
import type { GalleryEffectState, PresetModel, SceneOptionsState } from "../model/types";

const midV = (a: Vec3, b: Vec3): Vec3 => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];

const midU = (a: Vec2, b: Vec2): Vec2 => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];

/**
 * Subdivide each textured triangle (4-way, UV-interpolated) `levels` times so a
 * standalone snippet — which can't ship the texture image — captures sub-face
 * color when each piece is baked to its own average. Untextured faces pass through.
 */
function subdivideTexturedPolygons(polygons: Polygon[], levels: number): Polygon[] {
  const out: Polygon[] = [];
  for (const p of polygons) {
    const tts = p.textureTriangles;
    if (!tts || tts.length === 0) {
      out.push(p);
      continue;
    }
    for (const tt of tts) {
      let pieces: { v: [Vec3, Vec3, Vec3]; uv: [Vec2, Vec2, Vec2] }[] = [{ v: tt.vertices, uv: tt.uvs }];
      for (let l = 0; l < levels; l++) {
        const next: typeof pieces = [];
        for (const { v, uv } of pieces) {
          const m01 = midV(v[0], v[1]),
            m12 = midV(v[1], v[2]),
            m20 = midV(v[2], v[0]);
          const u01 = midU(uv[0], uv[1]),
            u12 = midU(uv[1], uv[2]),
            u20 = midU(uv[2], uv[0]);
          next.push(
            { v: [v[0], m01, m20], uv: [uv[0], u01, u20] },
            { v: [m01, v[1], m12], uv: [u01, uv[1], u12] },
            { v: [m20, m12, v[2]], uv: [u20, u12, uv[2]] },
            { v: [m01, m12, m20], uv: [u01, u12, u20] },
          );
        }
        pieces = next;
      }
      for (const { v, uv } of pieces) {
        out.push({
          ...p,
          vertices: v,
          uvs: undefined,
          textureTriangles: [{ vertices: v, uvs: uv, texture: tt.texture ?? p.texture }],
        });
      }
    }
  }
  return out;
}

export type Tab = "html" | "vanilla" | "react" | "vue";

export const INTERACTION_LIST: { key: GlyphInteraction; label: string }[] = [
  { key: "orbit", label: "Orbit" },
  { key: "zoom", label: "Zoom" },
  { key: "pan", label: "Pan" },
  { key: "fpv", label: "FPV" },
];

const GALLERY_ZOOM_COMPAT = 50;

export function toRuntimeZoom(galleryZoom: number): number {
  return galleryZoom * GALLERY_ZOOM_COMPAT;
}

/**
 * Build a fully-static CodePen from the LIVE rendered `<pre>` — the exact ASCII
 * on screen (full per-cell color/texture detail), with ZERO runtime: no glyphcss,
 * no JS, just the baked `<pre>` + its font CSS.
 */
export function buildStaticPen(mode: GlyphStaticEncoding): { html: string; css: string; js: string } | null {
  const pre = document.querySelector("pre.glyph-output") as HTMLElement | null;
  if (!pre || !pre.innerHTML.trim()) return null;
  const cs = getComputedStyle(pre);
  // Faithful to the library: font + per-cell colors only, no glow/tint effects.
  const fontCss = `html,body{margin:0;height:100%;background:#0b0d10;display:grid;place-items:center}
.glyph-output{margin:0;white-space:pre;font-family:${cs.fontFamily};font-size:${cs.fontSize};line-height:${cs.lineHeight};color:${cs.color}}`;
  // crop: true drops the empty grid margin (leading spaces / blank rows) so the
  // centered block hugs the actual glyphs. Grid mode also needs explicit track
  // sizes that match the rendered cell, or line-height / column advance drift.
  const encOpts: { crop: boolean; rowHeight?: string; colWidth?: string } = { crop: true };
  if (mode === "grid") {
    encOpts.rowHeight = cs.lineHeight === "normal" ? `${parseFloat(cs.fontSize) * 1.2}px` : cs.lineHeight;
    encOpts.colWidth = "1ch";
    try {
      const ctx = document.createElement("canvas").getContext("2d");
      if (ctx) {
        ctx.font = `${cs.fontSize} ${cs.fontFamily}`;
        const w = ctx.measureText("0").width;
        if (w > 0) encOpts.colWidth = `${w}px`;
      }
    } catch {
      /* fall back to 1ch */
    }
  }
  const enc = encodeStaticGlyphHtml(pre.innerHTML, mode, encOpts);
  return { html: enc.html, css: enc.css ? `${fontCss}\n${enc.css}` : fontCss, js: "" };
}

/**
 * Load the same polygons the gallery renders, ready for export. Primitives carry
 * their `uprightAlongZ` orientation via the preset generator; URL models load
 * from source. Textured meshes are subdivided + baked to per-face color (a
 * snippet can't ship the image), capped to keep the count reasonable.
 */
export async function loadExportPolygons(preset: PresetModel): Promise<{ polygons: Polygon[]; textured: boolean }> {
  if (preset.kind === "primitive") return { polygons: preset.generatePolygons(), textured: false };
  const parsed = await loadMesh(preset.url, { mtlUrl: preset.mtlUrl, solidTextureSamples: false });
  const texturedTris = parsed.polygons.reduce((n, p) => n + (p.textureTriangles?.length ?? 0), 0);
  if (texturedTris > 0) {
    let levels = 2;
    while (levels > 0 && texturedTris * 4 ** levels > 6000) levels--;
    const sub = subdivideTexturedPolygons(parsed.polygons, levels);
    return { polygons: await bakeSolidTextureSampledPolygons(sub, { colorTolerance: 255 }), textured: true };
  }
  return { polygons: parsed.polygons, textured: false };
}

/** Live-render grid + cell metrics, read off the on-screen `<pre>`. */
export function liveGridMetrics(): { cols: number; rows: number; lineHeightPx: number; fontSizePx: number } {
  const pre = document.querySelector("pre.glyph-output") as HTMLElement | null;
  const lines = (pre?.textContent ?? "").replace(/\s+$/, "").split("\n");
  const rows = Math.max(1, lines.length);
  const cols = lines.reduce((m, l) => Math.max(m, l.length), 1);
  const cs = pre ? getComputedStyle(pre) : null;
  const fontSizePx = cs ? parseFloat(cs.fontSize) || 13 : 13;
  const lineHeightPx = cs
    ? cs.lineHeight === "normal"
      ? fontSizePx * 1.2
      : parseFloat(cs.lineHeight) || fontSizePx
    : fontSizePx;
  return { cols, rows, lineHeightPx, fontSizePx };
}

/** POST a CodePen prefill payload (opens a new pen in a new tab). */
export function postToCodepen(prefill: { action: string; data: string }): void {
  const form = document.createElement("form");
  form.method = "POST";
  form.action = prefill.action;
  form.target = "_blank";
  const input = document.createElement("input");
  input.type = "hidden";
  input.name = "data";
  input.value = prefill.data;
  form.appendChild(input);
  document.body.appendChild(form);
  form.submit();
  form.remove();
}

// Primitive presets that need a +90° X rotation so their natural Y-up axis maps
// to the Z-up screen convention (cylinder/cone/pyramid/prism families build
// along +Y). Mirrors `uprightAlongZ` in presetList.ts.
const UPRIGHT_PRIMITIVES = new Set([
  "primitive-cylinder",
  "primitive-cone",
  "primitive-pyramid",
  "primitive-prism",
  "primitive-antiprism",
  "primitive-bipyramid",
  "primitive-trapezohedron",
]);

/** `primitive-truncated-cube` → `truncatedCube`. */
function primitiveGeometryName(id: string): string {
  return id.replace(/^primitive-/, "").replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

const SITE_URL = "https://glyphcss.com";

/** Build the absolute mesh URL the snippet should reference. */
function absoluteMeshUrl(rel: string): string {
  if (!rel) return "";
  if (/^https?:\/\//.test(rel)) return rel;
  return `${SITE_URL}${rel.startsWith("/") ? "" : "/"}${rel}`;
}

/** Two-decimal-place stringification for snippet numbers. */
function fmt(n: number): string {
  if (!Number.isFinite(n)) return "0";
  // Drop trailing zeros to keep snippets terse but cap precision at 2.
  return String(Number(n.toFixed(2)));
}

function jsonForScript(value: unknown): string {
  const json = JSON.stringify(value);
  if (json === undefined) throw new TypeError("Gallery snippet values must be JSON-serializable.");
  return json
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

/** Spherical (azimuth/elevation in degrees) → source vector toward the light. */
function dirFromSpherical(azimuthDeg: number, elevationDeg: number): [number, number, number] {
  const az = (azimuthDeg * Math.PI) / 180;
  const el = (elevationDeg * Math.PI) / 180;
  return [Math.cos(el) * Math.cos(az), Math.cos(el) * Math.sin(az), Math.sin(el)];
}

function vec3(v: [number, number, number]): string {
  return `[${fmt(v[0])}, ${fmt(v[1])}, ${fmt(v[2])}]`;
}

interface GallerySnippetInputs {
  meshUrl: string;
  options: SceneOptionsState;
  selectedPreset: PresetModel;
  effectState: GalleryEffectState;
  effectDefinition: GalleryEffectDefinition | null;
}

export function generateSnippets({
  meshUrl,
  options,
  selectedPreset,
  effectState,
  effectDefinition,
}: GallerySnippetInputs): Record<Tab, string> {
  const url = absoluteMeshUrl(meshUrl);
  const isPrimitive = selectedPreset.kind === "primitive";
  const geometryName = isPrimitive ? primitiveGeometryName(selectedPreset.id) : "";
  const primitiveSize = isPrimitive ? primitiveGeometrySize(geometryName) : 1;
  const needsUpright = isPrimitive && UPRIGHT_PRIMITIVES.has(selectedPreset.id);
  // 90° — uprightAlongZ maps Y-up geometry to Z-up screen convention.
  const uprightRotation: [number, number, number] = [90, 0, 0];
  const mode = options.renderMode ?? "solid";
  const palette = options.glyphPalette ?? "default";
  const charMode = options.charMode ?? "ascii";
  const emitCharMode =
    (mode === "wireframe" && charMode === "braille") ||
    (mode === "solid" && (charMode === "halfblock" || charMode === "quadrant"));
  const wireframeJunctions = options.wireframeJunctions === true;
  const emitWireframeJunctions = mode === "wireframe" && charMode !== "braille" && wireframeJunctions;
  const hiddenLines = options.hiddenLines ?? "show";
  // Unlike wireframeJunctions, hiddenLines applies to BOTH ascii and braille
  // charMode — it's a no-op only outside wireframe mode.
  const emitHiddenLines = mode === "wireframe" && hiddenLines === "hide";
  // Solid-mode-only second density axis. Also a no-op under charMode
  // "halfblock"/"quadrant" (both two-color-per-cell encodings have no
  // font-weight span).
  const emitSolidWeightRamp =
    mode === "solid" && charMode !== "halfblock" && charMode !== "quadrant" && options.solidWeightRamp === true;
  // The ramp is measurement DATA (a `(glyph, weight)[]` step list), not a
  // primitive prop value like charMode — so instead of a literal snapshot,
  // every flavor computes it the same way the gallery itself does:
  // `calibrateWeightedGlyphRamp` against the live font, at import time.
  const weightRampImport = '\nimport { calibrateWeightedGlyphRamp } from "@glyphcss/effects";';
  const weightRampCompute = `const solidWeightRamp = calibrateWeightedGlyphRamp({
  font: { family: "ui-monospace, monospace", size: 32 },
  steps: 24,
  weights: [400, 700],
}).steps.map(({ glyph, weight }) => ({ glyph, weight: Number(weight) }));`;
  const useColors = options.useColors !== false;
  const autoCenter = options.autoCenter !== false;
  // The gallery recenters every mesh to its own center (voxcss `autoCenter`).
  // In the packages that's `autoCenter` ON THE MESH, not a scene option — so the
  // copied model pivots around its own center instead of world origin. (camelCase
  // for React/JSX; kebab-case for the custom element + Vue template.)
  const centerJsx = autoCenter ? " autoCenter" : "";
  const centerKebab = autoCenter ? " auto-center" : "";
  const lineHeight = options.lineHeight ?? 1;
  // Density drives the render font-size (base 13px ÷ density). Emit the resulting
  // font-size so the copied snippet matches the gallery's on-screen resolution.
  const density = options.density ?? 1;
  const fontSizePx = Math.round((13 / density) * 100) / 100;
  const featureEdges = options.featureEdges ?? 0;
  const rotX = options.rotX ?? 0;
  const rotY = options.rotY ?? 0;
  const zoom = toRuntimeZoom(options.zoom ?? 0.35);
  const perspective = options.perspective;
  const isOrtho = perspective === false;
  const distance = typeof perspective === "number" ? perspective : 3;
  const target = options.target ?? [0, 0, 0];
  const hasTarget = target[0] !== 0 || target[1] !== 0 || target[2] !== 0;
  const effectName = galleryEffectExportName(effectDefinition);
  const hasEffect = effectName !== null && effectState.effectId !== null;
  const hasEffectClock =
    hasEffect &&
    !!effectDefinition &&
    "time" in effectDefinition.parameterSchema &&
    effectDefinition.parameterSchema.time.kind === "number" &&
    !effectState.paused &&
    effectState.timeScale > 0;
  const effectParams = jsonForScript(effectState.params);
  const effectImport = hasEffect ? `\nimport { GlyphEffects } from "@glyphcss/effects";` : "";

  const lightDir = dirFromSpherical(options.lightAzimuth ?? 50, options.lightElevation ?? 45);
  const lightIntensity = options.lightIntensity ?? 1;
  const lightColor = options.lightColor ?? "#ffffff";
  const ambientIntensity = options.ambientIntensity ?? 0.4;
  const ambientColor = options.ambientColor ?? "#ffffff";

  // ── React ────────────────────────────────────────────────────────────
  const cameraComponentName = isOrtho ? "GlyphOrthographicCamera" : "GlyphPerspectiveCamera";
  const cameraOpenTag = isOrtho
    ? `<GlyphOrthographicCamera rotX={${fmt(rotX)}} rotY={${fmt(rotY)}} zoom={${fmt(zoom)}}>`
    : `<GlyphPerspectiveCamera rotX={${fmt(rotX)}} rotY={${fmt(rotY)}} zoom={${fmt(zoom)}} distance={${fmt(distance)}}>`;
  const cameraCloseTag = isOrtho ? `</GlyphOrthographicCamera>` : `</GlyphPerspectiveCamera>`;
  const featureEdgesProp = mode === "wireframe" ? ` featureEdges={${fmt(featureEdges)}}` : "";
  const charModeProp = emitCharMode ? ` charMode="${charMode}"` : "";
  const junctionsPropReact = emitWireframeJunctions ? ` wireframeJunctions` : "";
  const hiddenLinesPropReact = emitHiddenLines ? ` hiddenLines="hide"` : "";
  const weightRampPropReact = emitSolidWeightRamp ? ` solidWeightRamp={solidWeightRamp}` : "";
  const targetReact = hasTarget ? `\n      target={${vec3(target)}}` : "";
  const meshTagReact = isPrimitive
    ? `<GlyphMesh geometry="${geometryName}" size={${fmt(primitiveSize)}}${needsUpright ? ` rotation={${vec3(uprightRotation)}}` : ""}${centerJsx} />`
    : `<GlyphMesh src="${url}"${centerJsx} />`;
  const effectTagReact = hasEffect
    ? `\n        <GlyphEffectLayer${hasEffectClock ? " ref={effectLayer}" : ""} effect={GlyphEffects.${effectName}} params={${effectParams}} blend="${effectState.blend}" />`
    : "";
  const reactEffectClock = hasEffectClock
    ? `
  const effectLayer = useRef<GlyphEffectLayerHandle<any>>(null);
  useEffect(() => {
    let raf = 0;
    let time = 0;
    let previous = performance.now();
    const frame = (now: number) => {
      time += Math.min((now - previous) / 1000, 0.1) * ${fmt(effectState.timeScale)};
      previous = now;
      if (effectLayer.current) effectLayer.current.params.time = time;
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);
`
    : "";

  const react = `${hasEffectClock ? `import { useEffect, useRef } from "react";\n` : ""}import {
  ${cameraComponentName},
  GlyphScene,
  GlyphMesh,
  GlyphOrbitControls,
${hasEffect ? "  GlyphEffectLayer,\n" : ""}${hasEffectClock ? "  type GlyphEffectLayerHandle,\n" : ""}} from "@glyphcss/react";${emitSolidWeightRamp ? weightRampImport : ""}
${effectImport}

const directionalLight = {
  direction: ${vec3(lightDir)},
  intensity: ${fmt(lightIntensity)},
  color: "${lightColor}",
};
const ambientLight = { intensity: ${fmt(ambientIntensity)}, color: "${ambientColor}" };
${emitSolidWeightRamp ? `\n${weightRampCompute}\n` : ""}
export function App() {
${reactEffectClock}
  return (
    ${cameraOpenTag}
      <GlyphScene
        mode="${mode}"
        autoSize
        style={{ width: "100%", height: "100%", fontSize: ${fontSizePx} }}
        glyphPalette="${palette}"${charModeProp}${junctionsPropReact}${hiddenLinesPropReact}${weightRampPropReact}
        useColors={${useColors}}
        lineHeight={${fmt(lineHeight)}}${featureEdgesProp}${targetReact}
        directionalLight={directionalLight}
        ambientLight={ambientLight}
      >
        <GlyphOrbitControls drag wheel />
        ${meshTagReact}${effectTagReact}
      </GlyphScene>
    ${cameraCloseTag}
  );
}`;

  // ── Vue ──────────────────────────────────────────────────────────────
  const cameraOpenTagVue = isOrtho
    ? `<GlyphOrthographicCamera :rot-x="${fmt(rotX)}" :rot-y="${fmt(rotY)}" :zoom="${fmt(zoom)}">`
    : `<GlyphPerspectiveCamera :rot-x="${fmt(rotX)}" :rot-y="${fmt(rotY)}" :zoom="${fmt(zoom)}" :distance="${fmt(distance)}">`;
  const cameraCloseTagVue = isOrtho ? `</GlyphOrthographicCamera>` : `</GlyphPerspectiveCamera>`;
  const featureEdgesVue = mode === "wireframe" ? `\n    :feature-edges="${fmt(featureEdges)}"` : "";
  const charModeVue = emitCharMode ? `\n      char-mode="${charMode}"` : "";
  const junctionsPropVue = emitWireframeJunctions ? `\n      wireframe-junctions` : "";
  const hiddenLinesPropVue = emitHiddenLines ? `\n      hidden-lines="hide"` : "";
  const weightRampPropVue = emitSolidWeightRamp ? `\n      :solid-weight-ramp="solidWeightRamp"` : "";
  const targetVue = hasTarget ? `\n    :target="${vec3(target)}"` : "";
  const meshTagVue = isPrimitive
    ? `<GlyphMesh geometry="${geometryName}" :size="${fmt(primitiveSize)}"${needsUpright ? ` :rotation="${vec3(uprightRotation)}"` : ""}${centerKebab} />`
    : `<GlyphMesh src="${url}"${centerKebab} />`;
  const effectTagVue = hasEffect
    ? `\n      <GlyphEffectLayer${hasEffectClock ? ` ref="effectLayer"` : ""} :effect="GlyphEffects.${effectName}" :params="effectParams" blend="${effectState.blend}" />`
    : "";
  const vueEffectClock = hasEffectClock
    ? `
const effectLayer = ref<any>(null);
let effectRaf = 0;
onMounted(() => {
  let time = 0;
  let previous = performance.now();
  const frame = (now: number) => {
    time += Math.min((now - previous) / 1000, 0.1) * ${fmt(effectState.timeScale)};
    previous = now;
    if (effectLayer.value) effectLayer.value.params.time = time;
    effectRaf = requestAnimationFrame(frame);
  };
  effectRaf = requestAnimationFrame(frame);
});
onBeforeUnmount(() => cancelAnimationFrame(effectRaf));
`
    : "";

  const vue = `<template>
  ${cameraOpenTagVue}
    <GlyphScene
      mode="${mode}"
      auto-size
      :style="{ width: '100%', height: '100%', fontSize: '${fontSizePx}px' }"
      glyphPalette="${palette}"${charModeVue}${junctionsPropVue}${hiddenLinesPropVue}${weightRampPropVue}
      :use-colors="${useColors}"
      :line-height="${fmt(lineHeight)}"${featureEdgesVue}${targetVue}
      :directional-light="directionalLight"
      :ambient-light="ambientLight"
    >
      <GlyphOrbitControls drag wheel />
      ${meshTagVue}${effectTagVue}
    </GlyphScene>
  ${cameraCloseTagVue}
</template>

<script setup lang="ts">
${hasEffectClock ? `import { onBeforeUnmount, onMounted, ref } from "vue";\n` : ""}import {
  ${cameraComponentName},
  GlyphScene,
  GlyphMesh,
  GlyphOrbitControls,
${hasEffect ? "  GlyphEffectLayer,\n" : ""}} from "@glyphcss/vue";${emitSolidWeightRamp ? weightRampImport : ""}
${effectImport}
${hasEffect ? `\nconst effectParams = ${effectParams};` : ""}
${vueEffectClock}
${emitSolidWeightRamp ? `\n${weightRampCompute}\n` : ""}
const directionalLight = {
  direction: ${vec3(lightDir)},
  intensity: ${fmt(lightIntensity)},
  color: "${lightColor}",
};
const ambientLight = { intensity: ${fmt(ambientIntensity)}, color: "${ambientColor}" };
</script>`;

  // ── Vanilla JS ───────────────────────────────────────────────────────
  const createCameraCall = isOrtho
    ? `createGlyphOrthographicCamera({ rotX: ${fmt(rotX)}, rotY: ${fmt(rotY)}, zoom: ${fmt(zoom)} })`
    : `createGlyphPerspectiveCamera({\n  rotX: ${fmt(rotX)},\n  rotY: ${fmt(rotY)},\n  zoom: ${fmt(zoom)},\n  distance: ${fmt(distance)},\n})`;
  const cameraImport = isOrtho ? "createGlyphOrthographicCamera" : "createGlyphPerspectiveCamera";
  const featureEdgesV = mode === "wireframe" ? `\n  featureEdges: ${fmt(featureEdges)},` : "";
  const charModeV = emitCharMode ? `\n  charMode: "${charMode}",` : "";
  const junctionsPropV = emitWireframeJunctions ? `\n  wireframeJunctions: true,` : "";
  const hiddenLinesPropV = emitHiddenLines ? `\n  hiddenLines: "hide",` : "";
  const weightRampPropV = emitSolidWeightRamp ? `\n  solidWeightRamp,` : "";
  const targetV = hasTarget ? `\ncamera.target = ${vec3(target)};` : "";
  const meshImportV = isPrimitive ? "" : "\n  loadMesh,";
  const fitImportV = autoCenter ? "\n  recenterPolygons," : "";
  const polygonsImportV = isPrimitive ? '\nimport { resolveGeometry } from "@glyphcss/core";' : "";
  const addArgV = autoCenter ? "recenterPolygons(polygons)" : "polygons";
  const meshLoadV = isPrimitive
    ? `const polygons = resolveGeometry("${geometryName}", { size: ${fmt(primitiveSize)} });
scene.add(${addArgV}${needsUpright ? `, { rotation: ${vec3(uprightRotation)} }` : ""});`
    : `const { polygons } = await loadMesh("${url}");
scene.add(${addArgV});`;
  const effectVanilla = hasEffect
    ? `\n\nconst effectLayer = scene.addEffectLayer({\n  effect: GlyphEffects.${effectName},\n  params: ${effectParams},\n  target: "surfaces",\n  blend: "${effectState.blend}",\n});${
        hasEffectClock
          ? `

let effectTime = 0;
let effectPrevious = performance.now();
function animateEffect(now: number) {
  effectTime += Math.min((now - effectPrevious) / 1000, 0.1) * ${fmt(effectState.timeScale)};
  effectPrevious = now;
  effectLayer.params.time = effectTime;
  requestAnimationFrame(animateEffect);
}
requestAnimationFrame(animateEffect);`
          : ""
      }`
    : "";

  const vanilla = `import {
  ${cameraImport},
  createGlyphScene,
  createGlyphOrbitControls,${meshImportV}${fitImportV}
} from "glyphcss";${polygonsImportV}${emitSolidWeightRamp ? weightRampImport : ""}
${effectImport}

const host = document.querySelector<HTMLElement>("#scene")!;
// Cell font-size sets the ASCII resolution; autoSize fills the host's box.
host.style.fontSize = "${fontSizePx}px";
${emitSolidWeightRamp ? `\n${weightRampCompute}\n` : ""}
const camera = ${createCameraCall};${targetV}

const scene = createGlyphScene(host, {
  camera,
  mode: "${mode}",
  autoSize: true,
  glyphPalette: "${palette}",${charModeV}${junctionsPropV}${hiddenLinesPropV}${weightRampPropV}
  useColors: ${useColors},
  lineHeight: ${fmt(lineHeight)},${featureEdgesV}
  directionalLight: {
    direction: ${vec3(lightDir)},
    intensity: ${fmt(lightIntensity)},
    color: "${lightColor}",
  },
  ambientLight: { intensity: ${fmt(ambientIntensity)}, color: "${ambientColor}" },
});

${meshLoadV}${effectVanilla}

createGlyphOrbitControls(scene, { drag: true, wheel: true });`;

  // ── HTML (custom elements) ──────────────────────────────────────────
  const cameraHtmlTag = isOrtho ? "glyph-orthographic-camera" : "glyph-perspective-camera";
  const cameraOpenHtml = isOrtho
    ? `<glyph-orthographic-camera rot-x="${fmt(rotX)}" rot-y="${fmt(rotY)}" zoom="${fmt(zoom)}">`
    : `<glyph-perspective-camera rot-x="${fmt(rotX)}" rot-y="${fmt(rotY)}" zoom="${fmt(zoom)}" distance="${fmt(distance)}">`;
  const cameraCloseHtml = `</${cameraHtmlTag}>`;
  const featureEdgesHtml = mode === "wireframe" ? ` feature-edges="${fmt(featureEdges)}"` : "";
  const charModeHtml = emitCharMode ? `\n        char-mode="${charMode}"` : "";
  const junctionsPropHtml = emitWireframeJunctions ? `\n        wireframe-junctions="true"` : "";
  const hiddenLinesPropHtml = emitHiddenLines ? `\n        hidden-lines="hide"` : "";
  // `solidWeightRamp` is data (a `(glyph, weight)[]` step list), not a string
  // attribute — same "JS property, not attribute" rule the custom element
  // uses for `sceneManifest`/`dictionary`. Set it via script, gated on the
  // scene being ready (mirrors the effect-layer script below).
  const weightRampScriptHtml = emitSolidWeightRamp
    ? `\n    <script type="module">\n      import { calibrateWeightedGlyphRamp } from "https://esm.sh/@glyphcss/effects";\n\n      const weightSceneElement = document.querySelector("glyph-scene");\n      const applyWeightRamp = () => {\n        weightSceneElement.solidWeightRamp = calibrateWeightedGlyphRamp({\n          font: { family: "ui-monospace, monospace", size: 32 },\n          steps: 24,\n          weights: [400, 700],\n        }).steps.map(({ glyph, weight }) => ({ glyph, weight: Number(weight) }));\n      };\n      if (weightSceneElement.getScene()) applyWeightRamp();\n      else weightSceneElement.addEventListener("glyphcss:scene-ready", applyWeightRamp, { once: true });\n    </script>`
    : "";
  const meshTagHtml = isPrimitive
    ? `<glyph-mesh geometry="${geometryName}" size="${fmt(primitiveSize)}"${needsUpright ? ` rotation="${fmt(uprightRotation[0])},${fmt(uprightRotation[1])},${fmt(uprightRotation[2])}"` : ""}${centerKebab}></glyph-mesh>`
    : `<glyph-mesh src="${url}"${centerKebab}></glyph-mesh>`;
  const effectScriptHtml = hasEffect
    ? `\n    <script type="module">\n      import { GlyphEffects } from "https://esm.sh/@glyphcss/effects";\n\n      const sceneElement = document.querySelector("glyph-scene");\n      const addEffect = () => {\n        const effectLayer = sceneElement.getScene().addEffectLayer({\n          effect: GlyphEffects.${effectName},\n          params: ${effectParams},\n          target: "surfaces",\n          blend: "${effectState.blend}",\n        });${hasEffectClock ? `\n\n        let effectTime = 0;\n        let effectPrevious = performance.now();\n        const animateEffect = (now) => {\n          effectTime += Math.min((now - effectPrevious) / 1000, 0.1) * ${fmt(effectState.timeScale)};\n          effectPrevious = now;\n          effectLayer.params.time = effectTime;\n          requestAnimationFrame(animateEffect);\n        };\n        requestAnimationFrame(animateEffect);` : ""}\n      };\n      if (sceneElement.getScene()) addEffect();\n      else sceneElement.addEventListener("glyphcss:scene-ready", addEffect, { once: true });\n    </script>`
    : "";

  const html = `<!DOCTYPE html>
<html>
  <head>
    <script type="module" src="https://esm.sh/glyphcss/elements"></script>
    <style>
      /* Cell font-size sets the ASCII resolution; auto-size fills the box. */
      glyph-scene { display: block; width: 100%; height: 100vh; font-size: ${fontSizePx}px; }
    </style>
  </head>
  <body>
    ${cameraOpenHtml}
      <glyph-scene
        mode="${mode}"
        auto-size
        glyph-palette="${palette}"${charModeHtml}${junctionsPropHtml}${hiddenLinesPropHtml}
        use-colors="${useColors}"
        line-height="${fmt(lineHeight)}"${featureEdgesHtml}
        light-direction="${fmt(lightDir[0])},${fmt(lightDir[1])},${fmt(lightDir[2])}"
        light-intensity="${fmt(lightIntensity)}"
        light-color="${lightColor}"
        ambient-intensity="${fmt(ambientIntensity)}"
        ambient-color="${ambientColor}"
      >
        <glyph-orbit-controls drag wheel></glyph-orbit-controls>
        ${meshTagHtml}
      </glyph-scene>
    ${cameraCloseHtml}${weightRampScriptHtml}${effectScriptHtml}
  </body>
</html>`;

  return { html, vanilla, react, vue };
}
