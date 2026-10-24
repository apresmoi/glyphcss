import { DEMO_BASE_FONT_SIZE, DEMO_GEOMETRY_SIZE, type Tunables } from "./types";

export interface DemoSource {
  mesh?: string;
  polygonsUrl?: string;
  hotspot?: boolean;
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
  const sceneValues = {
    ...(t.charMode && t.charMode !== "ascii" ? { charMode: t.charMode } : {}),
    ...(t.hiddenLines ? { hiddenLines: t.hiddenLines } : {}),
    ...(t.wireframeJunctions !== undefined ? { wireframeJunctions: t.wireframeJunctions } : {}),
    ...(t.colorEncoding ? { colorEncoding: t.colorEncoding } : {}),
    ...(t.colorTolerance !== undefined ? { colorTolerance: t.colorTolerance } : {}),
    ...(t.smoothShading !== undefined ? { smoothShading: t.smoothShading } : {}),
    ...(t.glyphPalette ? { glyphPalette: t.glyphPalette } : {}),
    ...(t.useColors !== undefined ? { useColors: t.useColors } : {}),
  };
  const sceneJs = Object.entries(sceneValues)
    .map(([key, value]) => `, ${key}: ${quote(value)}`)
    .join("");
  const sceneReact = Object.entries(sceneValues)
    .map(([key, value]) => (typeof value === "string" ? ` ${key}=${quote(value)}` : ` ${key}={${quote(value)}}`))
    .join("");
  const sceneVue = Object.entries(sceneValues)
    .map(([key, value]) => {
      const name = key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
      return typeof value === "string" ? ` ${name}="${attr(value)}"` : ` :${name}="${value}"`;
    })
    .join("");
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
      `const scene = createGlyphScene(host, { camera, autoSize: true, mode: "${mode}"${sceneJs} });`,
      `scene.output.style.fontSize = "${fontSize}px";`,
      `scene.output.style.lineHeight = "${t.lineHeight}";`,
      "scene.fit();",
      ...load,
      `scene.add(${source.mesh || source.polygonsUrl ? "recenterPolygons(polygons)" : "polygons"});`,
      ...(source.hotspot
        ? [
            'const anchor = scene.addHotspot({ id: "anchor", at: [50, 50, 50], size: [14, 3] });',
            'const button = document.createElement("button");',
            'button.type = "button";',
            'button.textContent = "Select anchor";',
            'button.setAttribute("aria-pressed", "false");',
            'button.addEventListener("pointerdown", event => event.stopPropagation());',
            'button.addEventListener("click", () => {',
            '  const selected = button.getAttribute("aria-pressed") !== "true";',
            '  button.setAttribute("aria-pressed", String(selected));',
            '  button.textContent = selected ? "Selected" : "Select anchor";',
            "});",
            "anchor.el.append(button);",
          ]
        : []),
      "createGlyphOrbitControls(scene, { drag: true, wheel: true });",
    ].join("\n"),
    react: [
      ...(source.hotspot ? ['import { useState } from "react";'] : []),
      `import { GlyphPerspectiveCamera, GlyphScene, GlyphOrbitControls, GlyphMesh${source.hotspot ? ", GlyphHotspot" : ""} } from "@glyphcss/react";`,
      ...indexedLoader,
      "",
      "export function App() {",
      ...(source.hotspot ? ["  const [selected, setSelected] = useState(false);"] : []),
      "  return (",
      `    <GlyphPerspectiveCamera ${cameraReact}>`,
      `      <GlyphScene mode="${mode}"${sceneReact} autoSize style={{ width: "100%", height: "100%", fontSize: ${fontSize}, lineHeight: ${t.lineHeight} }}>`,
      "        <GlyphOrbitControls drag wheel />",
      `        ${meshReact}`,
      ...(source.hotspot
        ? [
            '        <GlyphHotspot id="anchor" at={[50, 50, 50]} size={[14, 3]}>',
            '          <button type="button" aria-pressed={selected} onPointerDown={event => event.stopPropagation()} onClick={() => setSelected(value => !value)}>',
            '            {selected ? "Selected" : "Select anchor"}',
            "          </button>",
            "        </GlyphHotspot>",
          ]
        : []),
      "      </GlyphScene>",
      "    </GlyphPerspectiveCamera>",
      "  );",
      "}",
    ].join("\n"),
    vue: [
      "<script setup>",
      ...(source.hotspot ? ['import { ref } from "vue";', "const selected = ref(false);"] : []),
      `import { GlyphPerspectiveCamera, GlyphScene, GlyphOrbitControls, GlyphMesh${source.hotspot ? ", GlyphHotspot" : ""} } from "@glyphcss/vue";`,
      ...indexedLoader,
      "</script>",
      "",
      "<template>",
      `  <GlyphPerspectiveCamera ${cameraVue}>`,
      `    <GlyphScene mode="${mode}"${sceneVue} auto-size :style="{ width: '100%', height: '100%', fontSize: '${fontSize}px', lineHeight: ${t.lineHeight} }">`,
      "      <GlyphOrbitControls drag wheel />",
      `      ${meshVue}`,
      ...(source.hotspot
        ? [
            '      <GlyphHotspot id="anchor" :at="[50, 50, 50]" :size="[14, 3]">',
            '        <button type="button" :aria-pressed="selected" @pointerdown.stop @click="selected = !selected">',
            '          {{ selected ? "Selected" : "Select anchor" }}',
            "        </button>",
            "      </GlyphHotspot>",
          ]
        : []),
      "    </GlyphScene>",
      "  </GlyphPerspectiveCamera>",
      "</template>",
    ].join("\n"),
  };
}
