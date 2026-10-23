import { readFile } from "node:fs/promises";
import type { Polygon } from "@glyphcss/core";
import { composeText, parseFont } from "@glyphcss/fonts";
import { compileScene, createGlyphPerspectiveCamera } from "glyphcss";
import { fitWordArtZoom } from "../wordart/model/parameters";
import { glyphDocsInkBounds } from "../../services/docs-render/glyphRender";

// The landing wordmark: "glyphcss" extruded by @glyphcss/fonts and rasterised
// with the stars palette at build time, so it ships as text with no JS.
const COLS = 130;
const ROWS = 30;
const FACES = {
  glyph: { front: "#f97316", side: "#8a3f06" },
  css: { front: "#38bdf8", side: "#0e5a7e" },
};

export async function homeWordmark() {
  const bytes = await readFile("public/fonts/default.ttf");
  const font = parseFont(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  const options = (front: string, side: string) => ({
    size: 100,
    depth: 30,
    curveSteps: 6,
    simplify: 0.5,
    letterSpacing: -4,
    profile: { edge: "bevel" as const, segments: 3 },
    faces: { front: { color: front }, sides: { color: side }, back: { color: side } },
  });
  // One word keeps a shared baseline and kerning; text runs along +y, and
  // "glyph"'s own width marks where the blue "css" begins.
  const ys = (polygons: Polygon[]) => polygons.flatMap((polygon) => polygon.vertices.map((vertex) => vertex[1]!));
  const whole = composeText(font, "glyphcss", options(FACES.glyph.front, FACES.glyph.side));
  const glyph = ys(composeText(font, "glyph", options(FACES.glyph.front, FACES.glyph.side)));
  const split = Math.min(...ys(whole)) + Math.max(...glyph) - Math.min(...glyph);
  const polygons = whole.map((polygon) => {
    const y = polygon.vertices.reduce((sum, vertex) => sum + vertex[1]!, 0) / polygon.vertices.length;
    if (y < split) return polygon;
    return { ...polygon, color: polygon.color === FACES.glyph.front ? FACES.css.front : FACES.css.side };
  });
  const camera = createGlyphPerspectiveCamera({
    rotX: 90,
    rotY: 0,
    zoom: fitWordArtZoom(polygons, COLS * 25, ROWS * 50) * 0.95,
  });
  const result = compileScene({
    polygons,
    camera,
    cols: COLS,
    rows: ROWS,
    mode: "solid",
    useColors: true,
    glyphPalette: "stars",
    directionalLight: { direction: [0.7, 0.4, -0.6], intensity: 1.1 },
    ambientLight: { intensity: 0.5 },
  });
  if (!result.grid) throw new Error("The landing wordmark did not return a cell grid.");
  const grid = result.grid;
  const lines = Array.from({ length: grid.rows }, (_, row) =>
    grid.char.slice(row * grid.cols, (row + 1) * grid.cols).join(""),
  );
  const htmlLines = result.inner.split("\n");
  const inked = lines.map((line, row) => (/\S/.test(line) ? row : -1)).filter((row) => row >= 0);
  const [first, last] = [inked[0]!, inked.at(-1)!];
  const text = lines.slice(first, last + 1).join("\n");
  return { html: htmlLines.slice(first, last + 1).join("\n"), ...glyphDocsInkBounds(text) };
}
