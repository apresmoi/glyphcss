import { readFile } from "node:fs/promises";
import { resolveGeometry, type Polygon, type Vec3 } from "@glyphcss/core";
import { compileScene, createGlyphOrthographicCamera } from "glyphcss";
import { renderGlyphDocs } from "../docs-render/glyphRender";
import { PRESETS } from "../../features/gallery/data/presetList";
import { CHART_PRESETS } from "../../features/charts/model/chartsSpec";
import { socialGrid } from "./docsCards";

export async function socialDiagram() {
  return socialGrid(
    await renderGlyphDocs({
      kind: "diagram",
      source:
        "flowchart TB; Start --> Check{Ready?}; Check -->|yes| Build; Check -->|no| Fix; Build --> Ship; Fix --> Ship",
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
    ["docs-start", "primitive-torus", ["#ffbf69", "#ff6b6b", "#ffd166"]],
    ["docs-components", "primitive-cube", ["#69e0db", "#80a7ff", "#c7a5ff"]],
    ["docs-guides", "primitive-icosahedron", ["#ff79c6", "#ffc56e", "#ba9cff"]],
    ["docs-api", "primitive-dodecahedron", ["#69e0db", "#a4e57e", "#ffd166"]],
  ] as const;
  return Object.fromEntries(
    sections.map(([key, id, palette]) => {
      const preset = PRESETS.find((entry) => entry.id === id)!;
      if (preset.kind !== "primitive") throw new Error("Social docs preset must be a primitive.");
      const polygons = preset.generatePolygons().map((polygon, index) => ({
        ...polygon,
        color: palette[index % palette.length],
      }));
      return [key, [socialScene(polygons, preset.rotX ?? 65, preset.rotY ?? 45)]];
    }),
  );
}

export async function socialEarth() {
  const data = JSON.parse(await readFile("public/data/landing-earth.json", "utf8")) as {
    vertices: Vec3[];
    colors: string[];
    faces: { v: number[]; c: number }[];
  };
  const polygons: Polygon[] = data.faces.map((face) => ({
    vertices: face.v.map((index) => data.vertices[index]!),
    color: data.colors[face.c],
  }));
  return socialScene(polygons, 70, 0);
}

export function socialBench() {
  return socialScene(resolveGeometry("icosahedron", { size: 1 }), 65, 45);
}

function socialScene(polygons: Polygon[], rotX: number, rotY: number) {
  const cols = 120,
    rows = 60;
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
    mode: "solid",
    useColors: true,
    directionalLight: { direction: [0.94, 0, 0.34], intensity: 1.1 },
    ambientLight: { intensity: 0.45 },
  });
  return { html: result.inner, cols, rows };
}
