import { readFile } from "node:fs/promises";
import { recenterPolygons, type Polygon, type Vec3 } from "@glyphcss/core";
import { composeText, parseFont } from "@glyphcss/fonts";
import { getGlyphEffect, GlyphFieldSynthEffect } from "@glyphcss/effects";
import {
  classifyGlyphMapField,
  compileGlyphMap,
  GlyphMapClassifiers,
  glyphMapBounds,
  parseGlyphMapAsciiGrid,
  sampleGlyphMapField,
} from "@glyphcss/maps";
import {
  buildCellGrid,
  compileScene,
  composeGlyphEffects,
  createGlyphOrthographicCamera,
  type CellGrid,
  type GlyphEffectDefinition,
  type GlyphEffectLayerOptions,
  type GlyphEffectParamSchema,
} from "glyphcss";
import sampleRegion from "../../../../packages/maps/fixtures/sample-region.asc?raw";
import { PRESETS } from "../../features/gallery/data/presetList";
import { DEFAULT_LOADER, findLoader } from "../../features/loaders/model/loaders";
import { SYNTH_PARAM_DEFAULTS } from "../../features/synth/model/urlState";
import { WORD_ART_DEFAULTS } from "../../features/wordart/model/urlState";

function gridText(grid: CellGrid): string {
  return Array.from({ length: grid.rows }, (_, row) =>
    grid.char.slice(row * grid.cols, (row + 1) * grid.cols).join(""),
  ).join("\n");
}

function meshText(polygons: Polygon[], rotX: number, rotY: number): string {
  const centered = recenterPolygons(polygons);
  const camera = createGlyphOrthographicCamera({ rotX, rotY, zoom: 1 });
  const points = centered.flatMap((polygon) => polygon.vertices.map((vertex) => camera.project(vertex, 80, 28, 2)));
  const xs = points.map((point) => point[0]);
  const ys = points.map((point) => point[1]);
  camera.zoom = 0.85 * Math.min(80 / (Math.max(...xs) - Math.min(...xs)), 28 / (Math.max(...ys) - Math.min(...ys)));
  const result = compileScene({ polygons: centered, camera, cols: 80, rows: 28, mode: "solid", useColors: false });
  if (!result.grid) throw new Error("Static scene did not return a cell grid.");
  return gridText(result.grid);
}

function fieldText(layers: GlyphEffectLayerOptions[]): string {
  const cols = 80,
    rows = 28,
    count = cols * rows;
  const grid = buildCellGrid(new Array(count).fill(" "), new Array(count).fill(null), null, cols, rows);
  grid.shade = new Float32Array(count).fill(1);
  // The live plane supplies the same normalized UV domain to these flat effects.
  grid.surfaceUv = Float32Array.from({ length: count * 2 }, (_, index) => {
    const cell = Math.floor(index / 2);
    return index % 2 === 0 ? (cell % cols) / (cols - 1) : 1 - Math.floor(cell / cols) / (rows - 1);
  });
  return gridText(composeGlyphEffects(grid, layers));
}

export function staticGallery() {
  const preset = PRESETS.find((entry) => entry.id === "primitive-tetrahedron")!;
  if (preset.kind !== "primitive") throw new Error("Static gallery preset must be a primitive.");
  return {
    title: `${preset.label} preset`,
    text: meshText(preset.generatePolygons(), preset.rotX ?? 65, preset.rotY ?? 45),
  };
}

export function staticSynth() {
  return {
    title: "Initial field at time zero",
    text: fieldText([
      {
        effect: GlyphFieldSynthEffect as GlyphEffectDefinition<GlyphEffectParamSchema, unknown>,
        params: { ...SYNTH_PARAM_DEFAULTS, time: 0 },
        blend: "replace",
      },
    ]),
  };
}

export function staticLoader() {
  const loader = findLoader(DEFAULT_LOADER);
  return {
    title: `${loader.label} at time zero`,
    text: fieldText(
      loader.layers.map((layer) => {
        const effect = getGlyphEffect(layer.effectId);
        if (!effect) throw new Error(`Unknown loader effect: ${layer.effectId}`);
        return {
          effect: effect as GlyphEffectDefinition<GlyphEffectParamSchema, unknown>,
          params: { ...layer.params, time: 0 },
          blend: layer.blend,
        };
      }),
    ),
  };
}

export async function staticWordArt() {
  const defaults = WORD_ART_DEFAULTS;
  const bytes = await readFile("public/fonts/default.ttf");
  const font = parseFont(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  const polygons = composeText(font, defaults.text, {
    depth: defaults.depth,
    lineHeight: defaults.lineHeight,
    align: defaults.align,
    curveSteps: defaults.curveSegments,
    simplify: defaults.simplify,
    profile: { edge: "bevel", segments: defaults.profileSegments },
  }).map((polygon) => ({ ...polygon, vertices: polygon.vertices.map(([x, y, z]) => [x, -z, y] as Vec3) }));
  return { title: "Glyph CSS in the bundled font", text: meshText(polygons, 90, defaults.tilt) };
}

export async function staticMap() {
  const source = parseGlyphMapAsciiGrid(sampleRegion, { id: "sample-region-fixture-v1" });
  const field = await sampleGlyphMapField(source, glyphMapBounds({ ...source.bounds, cols: 60, rows: 30 }), {
    sampler: "max",
  });
  const bands = classifyGlyphMapField(field, GlyphMapClassifiers.etopo1V1);
  const { html } = compileGlyphMap(bands, { ramp: " .:-=+*#%@", water: "~" });
  return { title: "Synthetic terrain sample", text: html.replace(/<[^>]+>/g, "") };
}
