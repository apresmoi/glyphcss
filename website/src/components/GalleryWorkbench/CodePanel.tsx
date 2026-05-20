import { useCallback, useMemo, useState } from "react";
import type { SceneOptionsState } from "./types";

type Tab = "html" | "vanilla" | "react" | "vue";

interface CodePanelProps {
  meshUrl: string;
  options: SceneOptionsState;
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

/** Spherical (azimuth/elevation in degrees) → cartesian direction Vec3. */
function dirFromSpherical(azimuthDeg: number, elevationDeg: number): [number, number, number] {
  const az = (azimuthDeg * Math.PI) / 180;
  const el = (elevationDeg * Math.PI) / 180;
  return [Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)];
}

function vec3(v: [number, number, number]): string {
  return `[${fmt(v[0])}, ${fmt(v[1])}, ${fmt(v[2])}]`;
}

function generateSnippets({ meshUrl, options }: CodePanelProps): Record<Tab, string> {
  const url = absoluteMeshUrl(meshUrl);
  const mode = options.renderMode ?? "solid";
  const palette = options.glyphPalette ?? "default";
  const useColors = options.useColors !== false;
  const autoCenter = options.autoCenter !== false;
  const lineHeight = options.lineHeight ?? 1;
  const featureEdges = options.featureEdges ?? 0;
  const rotX = options.rotX ?? 0;
  const rotY = options.rotY ?? 0;
  const zoom = options.zoom ?? 0.4;
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
        cols={100}
        rows={30}
        glyphPalette="${palette}"
        useColors={${useColors}}
        autoCenter={${autoCenter}}
        lineHeight={${fmt(lineHeight)}}${featureEdgesProp}${targetReact}
        directionalLight={directionalLight}
        ambientLight={ambientLight}
      >
        <GlyphOrbitControls drag wheel />
        <GlyphMesh src="${url}" />
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

  const vue = `<template>
  ${cameraOpenTagVue}
    <GlyphScene
      mode="${mode}"
      :cols="100"
      :rows="30"
      glyphPalette="${palette}"
      :use-colors="${useColors}"
      :auto-center="${autoCenter}"
      :line-height="${fmt(lineHeight)}"${featureEdgesVue}${targetVue}
      :directional-light="directionalLight"
      :ambient-light="ambientLight"
    >
      <GlyphOrbitControls drag wheel />
      <GlyphMesh src="${url}" />
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

  const vanilla = `import {
  ${cameraImport},
  createGlyphScene,
  createGlyphOrbitControls,
  loadMesh,
} from "glyphcss";

const host = document.querySelector<HTMLElement>("#scene")!;

const camera = ${createCameraCall};${targetV}

const scene = createGlyphScene(host, {
  camera,
  mode: "${mode}",
  cols: 100,
  rows: 30,
  glyphPalette: "${palette}",
  useColors: ${useColors},
  autoCenter: ${autoCenter},
  lineHeight: ${fmt(lineHeight)},${featureEdgesV}
  directionalLight: {
    direction: ${vec3(lightDir)},
    intensity: ${fmt(lightIntensity)},
    color: "${lightColor}",
  },
  ambientLight: { intensity: ${fmt(ambientIntensity)}, color: "${ambientColor}" },
});

const { polygons } = await loadMesh("${url}");
scene.add(polygons);

createGlyphOrbitControls(scene, { drag: true, wheel: true });`;

  // ── HTML (custom elements) ──────────────────────────────────────────
  const cameraHtmlTag = isOrtho ? "glyph-orthographic-camera" : "glyph-perspective-camera";
  const cameraOpenHtml = isOrtho
    ? `<glyph-orthographic-camera rot-x="${fmt(rotX)}" rot-y="${fmt(rotY)}" zoom="${fmt(zoom)}">`
    : `<glyph-perspective-camera rot-x="${fmt(rotX)}" rot-y="${fmt(rotY)}" zoom="${fmt(zoom)}" distance="${fmt(distance)}">`;
  const cameraCloseHtml = `</${cameraHtmlTag}>`;
  const featureEdgesHtml = mode === "wireframe" ? ` feature-edges="${fmt(featureEdges)}"` : "";

  const html = `<!DOCTYPE html>
<html>
  <head>
    <script type="module" src="https://esm.sh/glyphcss/elements"></script>
  </head>
  <body>
    ${cameraOpenHtml}
      <glyph-scene
        mode="${mode}"
        cols="100"
        rows="30"
        glyph-palette="${palette}"
        use-colors="${useColors}"
        auto-center="${autoCenter}"
        line-height="${fmt(lineHeight)}"${featureEdgesHtml}
        light-direction="${fmt(lightDir[0])},${fmt(lightDir[1])},${fmt(lightDir[2])}"
        light-intensity="${fmt(lightIntensity)}"
        light-color="${lightColor}"
        ambient-intensity="${fmt(ambientIntensity)}"
        ambient-color="${ambientColor}"
      >
        <glyph-orbit-controls drag wheel></glyph-orbit-controls>
        <glyph-mesh src="${url}"></glyph-mesh>
      </glyph-scene>
    ${cameraCloseHtml}
  </body>
</html>`;

  return { html, vanilla, react, vue };
}

const TAB_LABEL: Record<Tab, string> = { html: "HTML", vanilla: "JS", react: "React", vue: "Vue" };
const TAB_ORDER: Tab[] = ["html", "vanilla", "react", "vue"];

export function CodePanel({ meshUrl, options }: CodePanelProps) {
  const [tab, setTab] = useState<Tab>("react");
  const [copied, setCopied] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const snippets = useMemo(() => generateSnippets({ meshUrl, options }), [meshUrl, options]);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(snippets[tab]);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* no-op */
    }
  }, [snippets, tab]);

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
        <pre className="gw-code-panel__code"><code>{snippets[tab]}</code></pre>
      )}
    </aside>
  );
}
