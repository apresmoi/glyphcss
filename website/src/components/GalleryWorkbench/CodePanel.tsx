import { useCallback, useMemo, useState } from "react";
import { loadMesh, bakeSolidTextureSampledPolygons } from "@glyphcss/core";
import type { Polygon, Vec2, Vec3 } from "@glyphcss/core";
import { buildGlyphInteractiveExport, buildGlyphFramesExport, glyphCodepenPrefill, encodeStaticGlyphHtml } from "glyphcss";
import type { GlyphInteraction, GlyphStaticEncoding } from "glyphcss";
import type { PresetModel, SceneOptionsState } from "./types";
import { primitiveGeometrySize } from "./presets/presetList";

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
    if (!tts || tts.length === 0) { out.push(p); continue; }
    for (const tt of tts) {
      let pieces: { v: [Vec3, Vec3, Vec3]; uv: [Vec2, Vec2, Vec2] }[] = [{ v: tt.vertices, uv: tt.uvs }];
      for (let l = 0; l < levels; l++) {
        const next: typeof pieces = [];
        for (const { v, uv } of pieces) {
          const m01 = midV(v[0], v[1]), m12 = midV(v[1], v[2]), m20 = midV(v[2], v[0]);
          const u01 = midU(uv[0], uv[1]), u12 = midU(uv[1], uv[2]), u20 = midU(uv[2], uv[0]);
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
        out.push({ ...p, vertices: v, uvs: undefined, textureTriangles: [{ vertices: v, uvs: uv, texture: tt.texture ?? p.texture }] });
      }
    }
  }
  return out;
}

type Tab = "html" | "vanilla" | "react" | "vue";

const INTERACTION_LIST: { key: GlyphInteraction; label: string }[] = [
  { key: "orbit", label: "Orbit" },
  { key: "zoom", label: "Zoom" },
  { key: "pan", label: "Pan" },
  { key: "fpv", label: "FPV" },
];
const GALLERY_ZOOM_COMPAT = 50;

function toRuntimeZoom(galleryZoom: number): number {
  return galleryZoom * GALLERY_ZOOM_COMPAT;
}

/**
 * Build a fully-static CodePen from the LIVE rendered `<pre>` — the exact ASCII
 * on screen (full per-cell color/texture detail), with ZERO runtime: no glyphcss,
 * no JS, just the baked `<pre>` + its font CSS.
 */
function buildStaticPen(mode: GlyphStaticEncoding): { html: string; css: string; js: string } | null {
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
      if (ctx) { ctx.font = `${cs.fontSize} ${cs.fontFamily}`; const w = ctx.measureText("0").width; if (w > 0) encOpts.colWidth = `${w}px`; }
    } catch { /* fall back to 1ch */ }
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
async function loadExportPolygons(preset: PresetModel): Promise<{ polygons: Polygon[]; textured: boolean }> {
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
function liveGridMetrics(): { cols: number; rows: number; lineHeightPx: number; fontSizePx: number } {
  const pre = document.querySelector("pre.glyph-output") as HTMLElement | null;
  const lines = (pre?.textContent ?? "").replace(/\s+$/, "").split("\n");
  const rows = Math.max(1, lines.length);
  const cols = lines.reduce((m, l) => Math.max(m, l.length), 1);
  const cs = pre ? getComputedStyle(pre) : null;
  const fontSizePx = cs ? parseFloat(cs.fontSize) || 13 : 13;
  const lineHeightPx = cs ? (cs.lineHeight === "normal" ? fontSizePx * 1.2 : parseFloat(cs.lineHeight) || fontSizePx) : fontSizePx;
  return { cols, rows, lineHeightPx, fontSizePx };
}

/** POST a CodePen prefill payload (opens a new pen in a new tab). */
function postToCodepen(prefill: { action: string; data: string }): void {
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

interface CodePanelProps {
  meshUrl: string;
  options: SceneOptionsState;
  selectedPreset: PresetModel;
  /** Extra classes (e.g. `is-mobile-open` to show the panel as a mobile drawer). */
  className?: string;
  id?: string;
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

/** Spherical (azimuth/elevation in degrees) → source vector toward the light. */
function dirFromSpherical(azimuthDeg: number, elevationDeg: number): [number, number, number] {
  const az = (azimuthDeg * Math.PI) / 180;
  const el = (elevationDeg * Math.PI) / 180;
  return [Math.cos(el) * Math.cos(az), Math.cos(el) * Math.sin(az), Math.sin(el)];
}

function vec3(v: [number, number, number]): string {
  return `[${fmt(v[0])}, ${fmt(v[1])}, ${fmt(v[2])}]`;
}

function generateSnippets({ meshUrl, options, selectedPreset }: CodePanelProps): Record<Tab, string> {
  const url = absoluteMeshUrl(meshUrl);
  const isPrimitive = selectedPreset.kind === "primitive";
  const geometryName = isPrimitive ? primitiveGeometryName(selectedPreset.id) : "";
  const primitiveSize = isPrimitive ? primitiveGeometrySize(geometryName) : 1;
  const needsUpright = isPrimitive && UPRIGHT_PRIMITIVES.has(selectedPreset.id);
  // 90° — uprightAlongZ maps Y-up geometry to Z-up screen convention.
  const uprightRotation: [number, number, number] = [90, 0, 0];
  const mode = options.renderMode ?? "solid";
  const palette = options.glyphPalette ?? "default";
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
  const targetReact = hasTarget ? `\n      target={${vec3(target)}}` : "";
  const meshTagReact = isPrimitive
    ? `<GlyphMesh geometry="${geometryName}" size={${fmt(primitiveSize)}}${needsUpright ? ` rotation={${vec3(uprightRotation)}}` : ""}${centerJsx} />`
    : `<GlyphMesh src="${url}"${centerJsx} />`;

  const react = `import {
  ${cameraComponentName},
  GlyphScene,
  GlyphMesh,
  GlyphOrbitControls,
} from "@glyphcss/react";

const directionalLight = {
  direction: ${vec3(lightDir)},
  intensity: ${fmt(lightIntensity)},
  color: "${lightColor}",
};
const ambientLight = { intensity: ${fmt(ambientIntensity)}, color: "${ambientColor}" };

export function App() {
  return (
    ${cameraOpenTag}
      <GlyphScene
        mode="${mode}"
        autoSize
        style={{ width: "100%", height: "100%", fontSize: ${fontSizePx} }}
        glyphPalette="${palette}"
        useColors={${useColors}}
        lineHeight={${fmt(lineHeight)}}${featureEdgesProp}${targetReact}
        directionalLight={directionalLight}
        ambientLight={ambientLight}
      >
        <GlyphOrbitControls drag wheel />
        ${meshTagReact}
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
  const targetVue = hasTarget ? `\n    :target="${vec3(target)}"` : "";
  const meshTagVue = isPrimitive
    ? `<GlyphMesh geometry="${geometryName}" :size="${fmt(primitiveSize)}"${needsUpright ? ` :rotation="${vec3(uprightRotation)}"` : ""}${centerKebab} />`
    : `<GlyphMesh src="${url}"${centerKebab} />`;

  const vue = `<template>
  ${cameraOpenTagVue}
    <GlyphScene
      mode="${mode}"
      auto-size
      :style="{ width: '100%', height: '100%', fontSize: '${fontSizePx}px' }"
      glyphPalette="${palette}"
      :use-colors="${useColors}"
      :line-height="${fmt(lineHeight)}"${featureEdgesVue}${targetVue}
      :directional-light="directionalLight"
      :ambient-light="ambientLight"
    >
      <GlyphOrbitControls drag wheel />
      ${meshTagVue}
    </GlyphScene>
  ${cameraCloseTagVue}
</template>

<script setup lang="ts">
import {
  ${cameraComponentName},
  GlyphScene,
  GlyphMesh,
  GlyphOrbitControls,
} from "@glyphcss/vue";

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

  const vanilla = `import {
  ${cameraImport},
  createGlyphScene,
  createGlyphOrbitControls,${meshImportV}${fitImportV}
} from "glyphcss";${polygonsImportV}

const host = document.querySelector<HTMLElement>("#scene")!;
// Cell font-size sets the ASCII resolution; autoSize fills the host's box.
host.style.fontSize = "${fontSizePx}px";

const camera = ${createCameraCall};${targetV}

const scene = createGlyphScene(host, {
  camera,
  mode: "${mode}",
  autoSize: true,
  glyphPalette: "${palette}",
  useColors: ${useColors},
  lineHeight: ${fmt(lineHeight)},${featureEdgesV}
  directionalLight: {
    direction: ${vec3(lightDir)},
    intensity: ${fmt(lightIntensity)},
    color: "${lightColor}",
  },
  ambientLight: { intensity: ${fmt(ambientIntensity)}, color: "${ambientColor}" },
});

${meshLoadV}

createGlyphOrbitControls(scene, { drag: true, wheel: true });`;

  // ── HTML (custom elements) ──────────────────────────────────────────
  const cameraHtmlTag = isOrtho ? "glyph-orthographic-camera" : "glyph-perspective-camera";
  const cameraOpenHtml = isOrtho
    ? `<glyph-orthographic-camera rot-x="${fmt(rotX)}" rot-y="${fmt(rotY)}" zoom="${fmt(zoom)}">`
    : `<glyph-perspective-camera rot-x="${fmt(rotX)}" rot-y="${fmt(rotY)}" zoom="${fmt(zoom)}" distance="${fmt(distance)}">`;
  const cameraCloseHtml = `</${cameraHtmlTag}>`;
  const featureEdgesHtml = mode === "wireframe" ? ` feature-edges="${fmt(featureEdges)}"` : "";
  const meshTagHtml = isPrimitive
    ? `<glyph-mesh geometry="${geometryName}" size="${fmt(primitiveSize)}"${needsUpright ? ` rotation="${fmt(uprightRotation[0])},${fmt(uprightRotation[1])},${fmt(uprightRotation[2])}"` : ""}${centerKebab}></glyph-mesh>`
    : `<glyph-mesh src="${url}"${centerKebab}></glyph-mesh>`;

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
        glyph-palette="${palette}"
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
    ${cameraCloseHtml}
  </body>
</html>`;

  return { html, vanilla, react, vue };
}

const TAB_LABEL: Record<Tab, string> = { html: "HTML", vanilla: "JS", react: "React", vue: "Vue" };
const TAB_ORDER: Tab[] = ["html", "vanilla", "react", "vue"];

export function CodePanel({ meshUrl, options, selectedPreset, className, id }: CodePanelProps) {
  const [tab, setTab] = useState<Tab>("react");
  const [copied, setCopied] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const snippets = useMemo(
    () => generateSnippets({ meshUrl, options, selectedPreset }),
    [meshUrl, options, selectedPreset],
  );

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(snippets[tab]);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* no-op */
    }
  }, [snippets, tab]);

  const [interactions, setInteractions] = useState<Set<GlyphInteraction>>(() => new Set(["orbit", "zoom"]));
  const [staticMode, setStaticMode] = useState(false);
  const [staticEncoding, setStaticEncoding] = useState<GlyphStaticEncoding>("classes");
  const [rotate, setRotate] = useState(false);
  const [exporting, setExporting] = useState(false);
  const toggleInteraction = useCallback((k: GlyphInteraction) => {
    setStaticMode(false); // choosing an interaction means it's not a static export
    setInteractions((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k); else next.add(k);
      return next;
    });
  }, []);

  // Compile the current model + chosen interactions into a self-contained,
  // decimated glyphcss snippet and open it as a new CodePen. Polygons are loaded
  // from the same source the gallery uses (URL mesh or built-in primitive).
  const handleCodepen = useCallback(async () => {
    setExporting(true);
    try {
      const title = (selectedPreset as { label?: string }).label ?? "glyphcss";
      const projection = options.perspective === false ? "orthographic" as const : "perspective" as const;
      const perspectivePx = options.perspective === false ? undefined : options.perspective;

      // Static mode.
      if (staticMode) {
        // Static + rotate: bake a turntable of frames → pure-CSS steps() loop.
        // No mesh, no glyphcss runtime — just pre-rendered text frames.
        if (rotate) {
          const { polygons } = await loadExportPolygons(selectedPreset);
          const g = liveGridMetrics();
          const frames = buildGlyphFramesExport(polygons, {
            frameCount: 36,
            rotX: options.rotX, rotY: options.rotY, zoom: toRuntimeZoom(options.zoom ?? 0.35),
            projection, perspectivePx,
            // pad the grid so the silhouette doesn't clip as it turns
            cols: Math.round(g.cols * 1.3), rows: Math.round(g.rows * 1.3),
            lineHeightPx: g.lineHeightPx, fontSizePx: g.fontSizePx,
            mode: options.renderMode === "wireframe" ? "wireframe" : "solid",
            useColors: options.useColors, autoCenter: true,
          });
          postToCodepen({ action: "https://codepen.io/pen/define", data: JSON.stringify({ title, ...frames.pen, editors: "110" }) });
          return;
        }
        // Static (single frame): ship the live-rendered <pre> as-is.
        const pen = buildStaticPen(staticEncoding);
        if (!pen) { console.warn("glyphcss: no rendered frame to export"); return; }
        postToCodepen({ action: "https://codepen.io/pen/define", data: JSON.stringify({ title, ...pen, editors: "100" }) });
        return;
      }

      const { polygons, textured } = await loadExportPolygons(selectedPreset);
      const decimateGrid = textured ? 100000 : undefined; // textured → keep baked color detail
      const result = buildGlyphInteractiveExport(polygons, {
        interactions: [...interactions],
        rotX: options.rotX,
        rotY: options.rotY,
        zoom: toRuntimeZoom(options.zoom ?? 0.35),
        // Match the gallery's projection (it defaults to orthographic) so the
        // export frames identically and map-controls pan tracks correctly.
        projection,
        perspectivePx,
        autoCenter: true,
        mode: options.renderMode === "wireframe" ? "wireframe" : "solid",
        useColors: options.useColors,
        decimateGrid,
      });
      postToCodepen(glyphCodepenPrefill(result, title));
    } catch (err) {
      console.error("glyphcss: CodePen export failed", err);
    } finally {
      setExporting(false);
    }
  }, [meshUrl, selectedPreset, options, interactions, staticMode, staticEncoding, rotate]);

  return (
    <aside id={id} className={`gw-code-panel${collapsed ? " gw-code-panel--collapsed" : ""}${className ? ` ${className}` : ""}`}>
      <header className="gw-code-panel__head">
        <span className="gw-code-panel__legend">[ CODE ]</span>
        <div className="gw-code-panel__tabs">
          {TAB_ORDER.map((t) => (
            <button
              key={t}
              type="button"
              className={`gw-code-panel__tab${tab === t ? " is-active" : ""}`}
              onClick={() => setTab(t)}
            >
              {TAB_LABEL[t]}
            </button>
          ))}
        </div>
        <div className="gw-code-panel__actions">
          <button
            type="button"
            className="gw-code-panel__action gw-code-panel__action--codepen"
            onClick={handleCodepen}
            disabled={exporting}
            title="Compile this model + chosen interactions into a new CodePen"
          >
            {exporting ? "Exporting…" : "CodePen"}
          </button>
          <button
            type="button"
            className="gw-code-panel__action"
            onClick={handleCopy}
            title="Copy current snippet"
          >
            {copied ? "Copied" : "Copy"}
          </button>
          <button
            type="button"
            className="gw-code-panel__action"
            onClick={() => setCollapsed((v) => !v)}
            title={collapsed ? "Expand code panel" : "Collapse code panel"}
            aria-label={collapsed ? "Expand" : "Collapse"}
          >
            {collapsed ? "▴" : "▾"}
          </button>
        </div>
      </header>
      {!collapsed && (
        <div className="gw-code-panel__body">
          <div className="gw-code-panel__float" title="What to compile into the CodePen export">
            <label
              className={`gw-code-panel__chip gw-code-panel__chip--static${staticMode ? " is-active" : ""}`}
              title="Export the rendered ASCII only — no glyphcss runtime, zero JS"
            >
              <input type="checkbox" checked={staticMode} onChange={() => setStaticMode((v) => !v)} />
              Static
            </label>
            {staticMode && (
              <label
                className={`gw-code-panel__chip gw-code-panel__chip--static${rotate ? " is-active" : ""}`}
                title="Bake a turntable of frames — pure-CSS rotation, still zero JS / no mesh"
              >
                <input type="checkbox" checked={rotate} onChange={() => setRotate((v) => !v)} />
                Auto-rotate
              </label>
            )}
            {staticMode && !rotate && (
              <select
                className="gw-code-panel__enc"
                value={staticEncoding}
                onChange={(e) => setStaticEncoding(e.target.value as GlyphStaticEncoding)}
                title="Static encoding: classes (smallest), grid (no literal spaces), inline (simplest)"
              >
                <option value="classes">classes</option>
                <option value="grid">grid</option>
                <option value="inline">inline</option>
              </select>
            )}
            <span className="gw-code-panel__float-sep" />
            {INTERACTION_LIST.map(({ key, label }) => (
              <label
                key={key}
                className={`gw-code-panel__chip${!staticMode && interactions.has(key) ? " is-active" : ""}${staticMode ? " is-disabled" : ""}`}
              >
                <input
                  type="checkbox"
                  disabled={staticMode}
                  checked={!staticMode && interactions.has(key)}
                  onChange={() => toggleInteraction(key)}
                />
                {label}
              </label>
            ))}
          </div>
          <pre className="gw-code-panel__code"><code>{snippets[tab]}</code></pre>
        </div>
      )}
    </aside>
  );
}
