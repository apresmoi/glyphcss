import { readFile } from "node:fs/promises";
import { resolveGeometry, type Polygon, type Vec3 } from "@glyphcss/core";
import { compileScene, createGlyphOrthographicCamera } from "glyphcss";

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
