// Visual proof for the finer sub-cell ink quantization: renders the four
// canonical cases (GLYPH head-on, GLYPH 3/4, sphere, cube) with mode: "ink".
// Run once against the built "before" dist, once against "after", diff by eye.
// Throwaway.
import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
import { compileScene } from "../../../packages/glyphcss/dist/index.js";
import { createGlyphOrthographicCamera, createGlyphPerspectiveCamera } from "../../../packages/glyphcss/dist/index.js";
import { cubePolygons, spherePolygons } from "../../../packages/core/dist/index.js";

const label = process.argv[2] ?? "out";
const glyphPolys = JSON.parse(readFileSync(resolve(process.cwd(), "research/contour-first-text/experiments/glyph-text.json"), "utf8"));

function render(polygons, camera, cols = 100, rows = 30) {
  return compileScene({ polygons, camera, cols, rows, cellAspect: 2.0, mode: "ink", useColors: false }).inner;
}

const headOn = render(glyphPolys, createGlyphOrthographicCamera({ zoom: 5, rotX: 0, rotY: 0 }), 160, 16);
writeFileSync(resolve(process.cwd(), `research/contour-first-text/experiments/${label}-headon.txt`), headOn);

const threeQuarter = render(glyphPolys, createGlyphOrthographicCamera({ zoom: 5, rotX: 20, rotY: 35 }), 160, 40);
writeFileSync(resolve(process.cwd(), `research/contour-first-text/experiments/${label}-3quarter.txt`), threeQuarter);

const sphere = render(spherePolygons({ center: [0, 0, 0], radius: 4, subdivisions: 3 }), createGlyphOrthographicCamera({ zoom: 20, rotX: 20, rotY: 35 }), 90, 45);
writeFileSync(resolve(process.cwd(), `research/contour-first-text/experiments/${label}-sphere.txt`), sphere);

const cube = render(cubePolygons({ center: [0, 0, 0], size: 4 }), createGlyphOrthographicCamera({ zoom: 20, rotX: 65, rotY: 45 }), 90, 45);
writeFileSync(resolve(process.cwd(), `research/contour-first-text/experiments/${label}-cube.txt`), cube);

console.log(`wrote ${label}-{headon,3quarter,sphere,cube}.txt`);
