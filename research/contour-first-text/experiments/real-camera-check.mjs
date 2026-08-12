import { createGlyphOrthographicCamera } from "../../../packages/glyphcss/src/api/createGlyphCamera.ts";

const cam0 = createGlyphOrthographicCamera({ rotX: 0, rotY: 0, zoom: 1 });
const cam90 = createGlyphOrthographicCamera({ rotX: 90, rotY: 0, zoom: 1 });

// OLD frame sample points (world X=height(neg p_y), Y=width(p_x), Z=depth)
const oldPts = [
  [-40, -20, 10], [-40, -20, -10], [40, 20, 10], [40, 20, -10], [0,0,10], [0,0,-10],
];
// NEW frame (candidate B): world X=depth(z), Y=width(p_x), Z=height(p_y)
const newPts = [
  [10, -20, 40], [-10, -20, 40], [10, 20, -40], [-10, 20, -40], [10,0,0], [-10,0,0],
];

console.log("OLD @ rotX=0:");
for (const p of oldPts) console.log(" ", p, "->", cam0.project(p, 100, 100, 1));

console.log("NEW @ rotX=90:");
for (const p of newPts) console.log(" ", p, "->", cam90.project(p, 100, 100, 1));
