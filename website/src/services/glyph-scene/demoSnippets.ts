import { DEMO_BASE_FONT_SIZE, DEMO_GEOMETRY_SIZE, type Tunables } from "./types";

export interface DemoSource {
  mesh?: string;
  polygonsUrl?: string;
}

export function demoSnippets(t: Tunables, source: DemoSource): Record<string, string> {
  const quote = JSON.stringify;
  const attr = (value: string) => value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
  const cameraValues = {
    rotX: t.rotX,
    rotY: t.rotY ?? 0,
    zoom: t.zoom,
    distance: t.distance,
    perspective: t.perspective,
    stretch: t.stretch,
  };
  const cameraJs = Object.entries(cameraValues)
    .map(([key, value]) => `${key}: ${Number(value.toFixed(2))}`)
    .join(", ");
  const cameraReact = Object.entries(cameraValues)
    .map(([key, value]) => `${key}={${Number(value.toFixed(2))}}`)
    .join(" ");
  const cameraVue = Object.entries(cameraValues)
    .map(([key, value]) => `:${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}="${Number(value.toFixed(2))}"`)
    .join(" ");
  const mode = t.renderMode ?? "wireframe";
  const fontSize = t.fontSize ?? DEMO_BASE_FONT_SIZE / t.density;
  const indexedLoader = source.polygonsUrl
    ? [
        `const data = await fetch(${quote(source.polygonsUrl)}).then(response => response.json());`,
        "const polygons = data.faces.map(face => ({",
        "  vertices: face.v.map(index => data.vertices[index]),",
        "  ...(face.c >= 0 ? { color: data.colors[face.c] } : {}),",
        "}));",
      ]
    : [];
  const meshReact = source.polygonsUrl
    ? "<GlyphMesh polygons={polygons} autoCenter />"
    : source.mesh
      ? `<GlyphMesh src={${quote(source.mesh)}} autoCenter />`
      : `<GlyphMesh geometry="${t.geometry}" size={${DEMO_GEOMETRY_SIZE}} />`;
  const meshVue = source.polygonsUrl
    ? '<GlyphMesh :polygons="polygons" auto-center />'
    : source.mesh
      ? `<GlyphMesh src="${attr(source.mesh)}" auto-center />`
      : `<GlyphMesh geometry="${t.geometry}" :size="${DEMO_GEOMETRY_SIZE}" />`;
  const load = source.polygonsUrl
    ? indexedLoader
    : source.mesh
      ? [`const { polygons } = await loadMesh(${quote(source.mesh)}, { solidTextureSamples: false });`]
      : [`const polygons = resolveGeometry("${t.geometry}", { size: ${DEMO_GEOMETRY_SIZE} });`];
  const sourceImport =
    source.mesh || source.polygonsUrl
      ? `import { ${source.polygonsUrl ? "" : "loadMesh, "}recenterPolygons } from "@glyphcss/core";`
      : 'import { resolveGeometry } from "@glyphcss/core";';
  return {
    vanilla: [
      'import { createGlyphPerspectiveCamera, createGlyphScene, createGlyphOrbitControls } from "glyphcss";',
      sourceImport,
      "",
      'const host = document.getElementById("scene");',
      `const camera = createGlyphPerspectiveCamera({ ${cameraJs} });`,
      `const scene = createGlyphScene(host, { camera, autoSize: true, mode: "${mode}" });`,
      `scene.output.style.fontSize = "${fontSize}px";`,
      `scene.output.style.lineHeight = "${t.lineHeight}";`,
      "scene.fit();",
      ...load,
      `scene.add(${source.mesh || source.polygonsUrl ? "recenterPolygons(polygons)" : "polygons"});`,
      "createGlyphOrbitControls(scene, { drag: true, wheel: true });",
    ].join("\n"),
    react: [
      'import { GlyphPerspectiveCamera, GlyphScene, GlyphOrbitControls, GlyphMesh } from "@glyphcss/react";',
      ...indexedLoader,
      "",
      "export function App() {",
      "  return (",
      `    <GlyphPerspectiveCamera ${cameraReact}>`,
      `      <GlyphScene mode="${mode}" autoSize style={{ width: "100%", height: "100%", fontSize: ${fontSize}, lineHeight: ${t.lineHeight} }}>`,
      "        <GlyphOrbitControls drag wheel />",
      `        ${meshReact}`,
      "      </GlyphScene>",
      "    </GlyphPerspectiveCamera>",
      "  );",
      "}",
    ].join("\n"),
    vue: [
      "<script setup>",
      'import { GlyphPerspectiveCamera, GlyphScene, GlyphOrbitControls, GlyphMesh } from "@glyphcss/vue";',
      ...indexedLoader,
      "</script>",
      "",
      "<template>",
      `  <GlyphPerspectiveCamera ${cameraVue}>`,
      `    <GlyphScene mode="${mode}" auto-size :style="{ width: '100%', height: '100%', fontSize: '${fontSize}px', lineHeight: ${t.lineHeight} }">`,
      "      <GlyphOrbitControls drag wheel />",
      `      ${meshVue}`,
      "    </GlyphScene>",
      "  </GlyphPerspectiveCamera>",
      "</template>",
    ].join("\n"),
  };
}
