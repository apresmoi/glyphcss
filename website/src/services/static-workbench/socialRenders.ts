import { resolveGeometry, type Polygon } from "@glyphcss/core";
import { compileScene, createGlyphOrthographicCamera } from "glyphcss";
import { renderGlyphDocs } from "../docs-render/glyphRender";
import { PRESETS } from "../../features/gallery/data/presetList";
import { CHART_PRESETS } from "../../features/charts/model/chartsSpec";
import { socialGrid } from "./docsCards";
import { staticLoader, staticMap } from "./scenes";

export async function socialDiagram() {
  return socialGrid(
    await renderGlyphDocs({
      kind: "diagram",
      source:
        "flowchart LR; Push[Push commit] --> Build[Build app]; Build --> Test{Tests pass?}; Test -->|yes| Stage[Deploy staging]; Stage --> Smoke[Smoke tests]; Smoke --> Prod[Deploy prod]; Test -->|no| Fix[Fix build]",
      options: {
        target: "web",
        width: 72,
        height: 19,
        charset: "box",
        overflow: "expand",
        nodeColor: "#69e0db",
        edgeColor: "#ffd166",
      },
    }),
  );
}

export async function socialCharts() {
  return Promise.all(
    ["bar", "donut"].map(async (id) =>
      socialGrid(
        await renderGlyphDocs({
          kind: "chart",
          source: CHART_PRESETS.find((preset) => preset.id === id)!.spec,
          options: { target: "web", width: 64, height: 20, charset: "blocks" },
        }),
      ),
    ),
  );
}

export function socialDocsSections() {
  const sections = [
    ["docs-start", "primitive-torus", ["#ffbf69", "#ff6b6b", "#ffd166"], "hide"],
    ["docs-components", "primitive-cube", ["#69e0db", "#80a7ff", "#c7a5ff"], "show"],
    ["docs-guides", "primitive-icosahedron", ["#ff79c6", "#ffc56e", "#ba9cff"], "show"],
    ["docs-api", "primitive-dodecahedron", ["#69e0db", "#a4e57e", "#ffd166"], "show"],
  ] as const;
  return Object.fromEntries(
    // The torus's many faces only read as a ring with its back lines hidden.
    sections.map(([key, id, palette, hiddenLines]) => {
      const preset = PRESETS.find((entry) => entry.id === id)!;
      if (preset.kind !== "primitive") throw new Error("Social docs preset must be a primitive.");
      const polygons = preset.generatePolygons().map((polygon, index) => ({
        ...polygon,
        color: palette[index % palette.length],
      }));
      return [key, [socialScene(polygons, preset.rotX ?? 65, preset.rotY ?? 45, hiddenLines)]];
    }),
  );
}

// Atlantic-centred so the card shows the Americas, Europe and Africa, at the
// landing globe's coarse density so its glyphs read as text.
export async function socialEarth() {
  return socialGrid(await staticMap({ centerLon: -38, centerLat: -8, cols: 80, rows: 36 }));
}

export function socialLoaders() {
  return ["rings", "matrix"].map((id) => socialGrid(staticLoader(id, 1.6)));
}

export async function socialAgents() {
  return socialGrid(
    await renderGlyphDocs({
      kind: "diagram",
      source:
        "flowchart TB; You[You ask for a diagram] --> Agent[Coding agent]; Agent -->|loads| Skill[glyphcss skill]; Skill -->|Mermaid or JSON| CLI[glyphcss CLI]; CLI -->|aligned text| Chat[Diagram in chat]",
      options: {
        target: "web",
        width: 64,
        height: 40,
        charset: "box",
        overflow: "expand",
        nodeColor: "#69e0db",
        edgeColor: "#ffd166",
      },
    }),
  );
}

export function socialBench() {
  return socialScene(resolveGeometry("icosahedron", { size: 1 }), 65, 45);
}

function socialScene(polygons: Polygon[], rotX: number, rotY: number, hiddenLines: "show" | "hide" = "show") {
  // A coarse grid keeps braille dots and glyphs legible at card size.
  const cols = 60,
    rows = 30;
  const camera = createGlyphOrthographicCamera({ rotX, rotY, zoom: 1 });
  const points = polygons.flatMap((polygon) => polygon.vertices.map((vertex) => camera.project(vertex, cols, rows, 2)));
  const xs = points.map((point) => point[0]);
  const ys = points.map((point) => point[1]);
  camera.zoom = 0.9 * Math.min(cols / (Math.max(...xs) - Math.min(...xs)), rows / (Math.max(...ys) - Math.min(...ys)));
  const result = compileScene({
    polygons,
    camera,
    cols,
    rows,
    // Braille outlines read as a mesh at card size; solid faces read as flat blocks.
    mode: "wireframe",
    charMode: "braille",
    hiddenLines,
    useColors: true,
    ambientLight: { intensity: 1 },
  });
  return { html: result.inner, cols, rows };
}
