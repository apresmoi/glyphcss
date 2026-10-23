import { readFile } from "node:fs/promises";
import { recenterPolygons, rotateVec3, type Polygon } from "@glyphcss/core";
import { composeText, parseFont } from "@glyphcss/fonts";
import { getGlyphEffect, GlyphFieldSynthEffect } from "@glyphcss/effects";
import { GlyphMapClassifiers, glyphMapDecodeGeoTileInt16, glyphMapGlobe, glyphMapPolygons } from "@glyphcss/maps";
import {
  buildCellGrid,
  compileScene,
  composeGlyphEffects,
  createGlyphOrthographicCamera,
  createGlyphPerspectiveCamera,
  encodeGlyphBuffers,
  type CellGrid,
  type GlyphEffectDefinition,
  type GlyphEffectLayerOptions,
  type GlyphEffectParamSchema,
} from "glyphcss";
import { PRESETS } from "../../features/gallery/data/presetList";
import { DEFAULT_LOADER, findLoader } from "../../features/loaders/model/loaders";
import { SYNTH_PARAM_DEFAULTS } from "../../features/synth/model/urlState";
import { WORD_ART_DEFAULTS } from "../../features/wordart/model/urlState";
import { fitWordArtZoom } from "../../features/wordart/model/parameters";
import { paletteColorsFor } from "../../features/maps/model/config";
import { MAPS_URL_DEFAULTS } from "../../features/maps/services/mapsUrlState";
import { DEFAULT_MAP_LIGHTING } from "../../features/maps/model/lighting";

function gridRender(grid: CellGrid) {
  return { text: gridText(grid), html: encodeGlyphBuffers(grid.char, grid.color, grid.cols, grid.rows, true) };
}

function gridText(grid: CellGrid): string {
  return Array.from({ length: grid.rows }, (_, row) =>
    grid.char.slice(row * grid.cols, (row + 1) * grid.cols).join(""),
  ).join("\n");
}

function meshRender(polygons: Polygon[], rotX: number, rotY: number) {
  const centered = recenterPolygons(polygons);
  const camera = createGlyphOrthographicCamera({ rotX, rotY, zoom: 1 });
  const points = centered.flatMap((polygon) => polygon.vertices.map((vertex) => camera.project(vertex, 80, 28, 2)));
  const xs = points.map((point) => point[0]);
  const ys = points.map((point) => point[1]);
  camera.zoom = 0.85 * Math.min(80 / (Math.max(...xs) - Math.min(...xs)), 28 / (Math.max(...ys) - Math.min(...ys)));
  const result = compileScene({ polygons: centered, camera, cols: 80, rows: 28, mode: "solid", useColors: true });
  if (!result.grid) throw new Error("Static scene did not return a cell grid.");
  return { text: gridText(result.grid), html: result.inner };
}

function fieldRender(layers: GlyphEffectLayerOptions[]) {
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
  return gridRender(composeGlyphEffects(grid, layers));
}

export function staticGallery() {
  const preset = PRESETS.find((entry) => entry.id === "primitive-tetrahedron")!;
  if (preset.kind !== "primitive") throw new Error("Static gallery preset must be a primitive.");
  return {
    title: `${preset.label} preset`,
    ...meshRender(preset.generatePolygons(), preset.rotX ?? 65, preset.rotY ?? 45),
  };
}

export function staticSynth() {
  return {
    title: "Initial field at time zero",
    ...fieldRender([
      {
        effect: GlyphFieldSynthEffect as GlyphEffectDefinition<GlyphEffectParamSchema, unknown>,
        params: { ...SYNTH_PARAM_DEFAULTS, time: 0 },
        blend: "replace",
      },
    ]),
  };
}

export function staticLoader(id = DEFAULT_LOADER, time = 0) {
  const loader = findLoader(id);
  return {
    title: `${loader.label} at time ${time === 0 ? "zero" : time}`,
    ...fieldRender(
      loader.layers.map((layer) => {
        const effect = getGlyphEffect(layer.effectId);
        if (!effect) throw new Error(`Unknown loader effect: ${layer.effectId}`);
        return {
          effect: effect as GlyphEffectDefinition<GlyphEffectParamSchema, unknown>,
          params: { ...layer.params, time },
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
    size: 100,
    depth: defaults.depth,
    lineHeight: defaults.lineHeight,
    align: defaults.align,
    curveSteps: defaults.curveSegments,
    simplify: defaults.simplify,
    profile: { edge: "bevel", segments: defaults.profileSegments },
    faces: {
      front: { color: defaults.color },
      sides: { color: defaults.sideColor },
      back: { color: defaults.backColor },
    },
  });
  const centered = recenterPolygons(polygons);
  // compileScene uses virtual 25×50 px cells; fit against those same metrics as the live stage.
  const camera = createGlyphPerspectiveCamera({
    rotX: 90,
    rotY: 0,
    zoom: fitWordArtZoom(centered, 80 * 25, 28 * 50) * defaults.zoomScale,
  });
  const a = (defaults.lightAz * Math.PI) / 180;
  const e = (defaults.lightEl * Math.PI) / 180;
  const result = compileScene({
    polygons: centered.map((polygon) => ({
      ...polygon,
      vertices: polygon.vertices.map((v) => rotateVec3(v, 0, defaults.tilt, defaults.turn)),
    })),
    camera,
    cols: 80,
    rows: 28,
    mode: defaults.renderMode,
    charMode: defaults.charMode,
    useColors: true,
    directionalLight: {
      direction: [Math.max(0.25, Math.cos(e)), -Math.sin(a) * Math.cos(e), -Math.sin(e)],
      intensity: defaults.lightIntensity,
      color: defaults.lightColor,
    },
    ambientLight: { intensity: defaults.ambient },
  });
  if (!result.grid) throw new Error("Static WordArt did not return a cell grid.");
  return { title: "Glyph CSS in the bundled font", text: gridText(result.grid), html: result.inner };
}

export async function staticMap(view: { centerLon?: number; centerLat?: number; cols?: number; rows?: number } = {}) {
  const base = "public/data/geo-tiles";
  const manifest = JSON.parse(await readFile(`${base}/manifest.json`, "utf8"));
  if (manifest.version !== 2 || manifest.format !== "int16" || manifest.byteOrder !== "little-endian") {
    throw new Error("Static map requires the same version 2 int16 terrain tiles as the live workbench.");
  }
  const level = manifest.zooms.find((entry: { z: number }) => entry.z === 0);
  const bytes = await readFile(`${base}/0/0_0.bin`);
  const bounds = { west: -180, east: 180, south: -90, north: 90 };
  const tile = glyphMapDecodeGeoTileInt16(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), {
    bounds,
    cols: level.tileCols,
    rows: level.tileRows,
    source: manifest.source,
    sampler: manifest.sampler,
  });
  const defaults = { ...MAPS_URL_DEFAULTS, ...view };
  const projection = glyphMapGlobe({ exaggeration: defaults.exaggeration });
  const pose = projection.cameraForCenter!(defaults.centerLon, defaults.centerLat);
  const { cols = 160, rows = 72 } = view;
  const camera = createGlyphOrthographicCamera({ ...pose, zoom: 1 });
  // Fit the globe into the same virtual cell metrics compileScene uses.
  const unitCamera = createGlyphOrthographicCamera({ rotX: 0, rotY: 0, zoom: 1 });
  const unit = unitCamera.project([0, 1, 0], cols, rows, 2);
  camera.zoom = (0.46 * Math.min(cols, rows * 2)) / Math.abs(unit[0] - cols / 2);
  const polygons = glyphMapPolygons(tile, projection, {
    color: paletteColorsFor(defaults.palette, GlyphMapClassifiers.etopo1V1),
  });
  const lon = (defaults.centerLon * Math.PI) / 180;
  const lat = (defaults.centerLat * Math.PI) / 180;
  const result = compileScene({
    polygons,
    camera,
    cols,
    rows,
    mode: "solid",
    useColors: true,
    directionalLight: {
      direction: [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)],
      intensity: DEFAULT_MAP_LIGHTING.lightIntensity,
    },
    ambientLight: { intensity: DEFAULT_MAP_LIGHTING.ambientIntensity },
  });
  if (!result.grid) throw new Error("Static map did not return a cell grid.");
  // Keep water identifiable in uncoloured copies of this no-JavaScript render.
  result.grid.char = result.grid.char.map((char, index) => {
    const color = result.grid!.color[index];
    if (!color || char === " ") return char;
    const rgb = color.startsWith("#")
      ? [1, 3, 5].map((start) => Number.parseInt(color.slice(start, start + 2), 16))
      : color.match(/\d+/g)?.map(Number);
    return rgb && rgb[2]! > rgb[0]! && rgb[2]! > rgb[1]! ? "~" : char;
  });
  return { title: "Earth · NOAA ETOPO1 terrain · default globe view", ...gridRender(result.grid) };
}
