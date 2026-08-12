// Scale-invariance check for the identity-exemption ink HLR fix. A flat
// bias/epsilon rescued a size~3 sphere at zoom 150 but regressed a 10x-larger
// sphere at proportionally lower zoom by up to -60% — reproducing the
// original flat-bias failure one world scale away. This sweeps world size
// AND camera zoom/projection together so the residual `depthGradient`-scaled
// allowance (not a flat constant) has to hold across all of them.
import {
  createGlyphOrthographicCamera,
  createGlyphPerspectiveCamera,
  buildRasterizeContext,
  rasterize,
} from "../../../packages/glyphcss/dist/index.js";
import { spherePolygons } from "../../../packages/core/dist/index.js";

function countInked(txt) { return [...txt].filter((c) => c !== " " && c !== "\n").length; }
function render(polys, camera, cols, rows, hiddenLines) {
  const ctx = buildRasterizeContext({
    camera, grid: { cols, rows, cellAspect: 2 }, polygons: polys, mode: "ink", useColors: false,
    ...(hiddenLines ? { hiddenLines } : {}),
  });
  return rasterize(ctx);
}

const cases = [
  ["size 1, zoom 150 (orthographic)", spherePolygons({ center: [0, 0, 0], size: 1, subdivisions: 3 }), createGlyphOrthographicCamera({ rotX: 20, rotY: 25, zoom: 150 }), 60, 30],
  ["size 10, zoom 20 (orthographic)", spherePolygons({ center: [0, 0, 0], size: 10, subdivisions: 3 }), createGlyphOrthographicCamera({ rotX: 20, rotY: 25, zoom: 20 }), 60, 30],
  ["size 50, zoom 5 (orthographic)", spherePolygons({ center: [0, 0, 0], size: 50, subdivisions: 3 }), createGlyphOrthographicCamera({ rotX: 20, rotY: 25, zoom: 5 }), 60, 30],
  ["size 0.1, zoom 1500 (orthographic)", spherePolygons({ center: [0, 0, 0], size: 0.1, subdivisions: 3 }), createGlyphOrthographicCamera({ rotX: 20, rotY: 25, zoom: 1500 }), 60, 30],
  ["size 3, perspective distance 400", spherePolygons({ center: [0, 0, -10], size: 3, subdivisions: 3 }), createGlyphPerspectiveCamera({ rotX: 20, rotY: 25, distance: 400 }), 60, 30],
];

console.log("case | show | hide | delta | delta%");
console.log("---|---|---|---|---");
for (const [label, polys, cam, cols, rows] of cases) {
  const show = countInked(render(polys, cam, cols, rows, "show"));
  const hide = countInked(render(polys, cam, cols, rows, "hide"));
  const delta = hide - show;
  console.log(`${label} | ${show} | ${hide} | ${delta} | ${((delta / show) * 100).toFixed(1)}%`);
}
