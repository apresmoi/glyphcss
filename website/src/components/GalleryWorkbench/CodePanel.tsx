import { useCallback, useMemo, useState } from "react";
import { loadMesh, bakeSolidTextureSampledPolygons } from "@glyphcss/core";
import type { Polygon, Vec2, Vec3 } from "@glyphcss/core";
import { buildGlyphInteractiveExport, glyphCodepenPrefill } from "glyphcss";
import type { GlyphInteraction } from "glyphcss";
import type { PresetModel, SceneOptionsState } from "./types";

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

/** Spherical (azimuth/elevation in degrees) → cartesian direction Vec3.
 * Returns the "shines TOWARD" vector (three.js convention): the direction
 * the light travels, i.e. the negated subsolar unit vector. */
function dirFromSpherical(azimuthDeg: number, elevationDeg: number): [number, number, number] {
  const az = (azimuthDeg * Math.PI) / 180;
  const el = (elevationDeg * Math.PI) / 180;
  return [-Math.cos(el) * Math.cos(az), -Math.cos(el) * Math.sin(az), -Math.sin(el)];
}

function vec3(v: [number, number, number]): string {
  return `[${fmt(v[0])}, ${fmt(v[1])}, ${fmt(v[2])}]`;
}

function generateSnippets({ meshUrl, options, selectedPreset }: CodePanelProps): Record<Tab, string> {
  const url = absoluteMeshUrl(meshUrl);
  const isPrimitive = selectedPreset.kind === "primitive";
  const geometryName = isPrimitive ? primitiveGeometryName(selectedPreset.id) : "";
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
  const featureEdges = options.featureEdges ?? 0;
  const rotX = options.rotX ?? 0;
  const rotY = options.rotY ?? 0;
  const zoom = options.zoom ?? 1.3;
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
    ? `<GlyphMesh geometry="${geometryName}"${needsUpright ? ` rotation={${vec3(uprightRotation)}}` : ""}${centerJsx} />`
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
        style={{ width: "100%", height: "100%", fontSize: 13 }}
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
    ? `<GlyphMesh geometry="${geometryName}"${needsUpright ? ` :rotation="${vec3(uprightRotation)}"` : ""}${centerKebab} />`
    : `<GlyphMesh src="${url}"${centerKebab} />`;

  const vue = `<template>
  ${cameraOpenTagVue}
    <GlyphScene
      mode="${mode}"
      auto-size
      :style="{ width: '100%', height: '100%', fontSize: '13px' }"
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
    ? `const polygons = resolveGeometry("${geometryName}", { size: 1 });
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
host.style.fontSize = "13px";

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
    ? `<glyph-mesh geometry="${geometryName}"${needsUpright ? ` rotation="${fmt(uprightRotation[0])},${fmt(uprightRotation[1])},${fmt(uprightRotation[2])}"` : ""}${centerKebab}></glyph-mesh>`
    : `<glyph-mesh src="${url}"${centerKebab}></glyph-mesh>`;

  const html = `<!DOCTYPE html>
<html>
  <head>
    <script type="module" src="https://esm.sh/glyphcss/elements"></script>
    <style>
      /* Cell font-size sets the ASCII resolution; auto-size fills the box. */
      glyph-scene { display: block; width: 100%; height: 100vh; font-size: 13px; }
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

export function CodePanel({ meshUrl, options, selectedPreset }: CodePanelProps) {
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
  const [exporting, setExporting] = useState(false);
  const toggleInteraction = useCallback((k: GlyphInteraction) => {
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
      // Use the SAME polygons the gallery renders: primitives carry the
      // `uprightAlongZ` rotation via their preset generator (so e.g. the cone
      // matches on-screen orientation); URL models load from their source.
      // A self-contained snippet can't ship the texture image. For textured
      // meshes, subdivide each face then bake each piece to its average color
      // (colorTolerance: 255 forces averaging) so the export captures sub-face
      // color detail — and skip decimation so that detail isn't re-merged away.
      let polygons: Polygon[];
      let decimateGrid: number | undefined;
      if (selectedPreset.kind === "primitive") {
        polygons = selectedPreset.generatePolygons();
      } else {
        const parsed = await loadMesh(selectedPreset.url, {
          mtlUrl: selectedPreset.mtlUrl,
          solidTextureSamples: false,
        });
        const texturedTris = parsed.polygons.reduce((n, p) => n + (p.textureTriangles?.length ?? 0), 0);
        if (texturedTris > 0) {
          // Adapt subdivision depth to keep the inlined payload reasonable
          // (~6k triangles max): more levels for low-poly meshes, fewer for dense.
          let levels = 2;
          while (levels > 0 && texturedTris * 4 ** levels > 6000) levels--;
          const sub = subdivideTexturedPolygons(parsed.polygons, levels);
          polygons = await bakeSolidTextureSampledPolygons(sub, { colorTolerance: 255 });
          decimateGrid = 100000; // preserve the per-region color detail
        } else {
          polygons = parsed.polygons;
        }
      }
      const result = buildGlyphInteractiveExport(polygons, {
        interactions: [...interactions],
        rotX: options.rotX,
        rotY: options.rotY,
        zoom: options.zoom,
        // Match the gallery's projection (it defaults to orthographic) so the
        // export frames identically and map-controls pan tracks correctly.
        projection: options.perspective === false ? "orthographic" : "perspective",
        perspectivePx: options.perspective === false ? undefined : options.perspective,
        autoCenter: true,
        mode: options.renderMode === "wireframe" ? "wireframe" : "solid",
        useColors: options.useColors,
        decimateGrid,
      });
      postToCodepen(glyphCodepenPrefill(result, (selectedPreset as { label?: string }).label ?? "glyphcss"));
    } catch (err) {
      console.error("glyphcss: CodePen export failed", err);
    } finally {
      setExporting(false);
    }
  }, [meshUrl, selectedPreset, options, interactions]);

  return (
    <aside className={`gw-code-panel${collapsed ? " gw-code-panel--collapsed" : ""}`}>
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
          <div className="gw-code-panel__float" title="Interactions to compile into the CodePen export">
            <span className="gw-code-panel__float-label">interactions</span>
            {INTERACTION_LIST.map(({ key, label }) => (
              <label key={key} className={`gw-code-panel__chip${interactions.has(key) ? " is-active" : ""}`}>
                <input
                  type="checkbox"
                  checked={interactions.has(key)}
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
