import {
  createGlyphPerspectiveCamera,
  createGlyphScene,
  createGlyphOrbitControls,
  loadMesh,
  computeSceneBbox,
} from "glyphcss";
import type { Polygon, Vec3 } from "glyphcss";

/** Center and scale polygons to fit a 2-unit bounding box at origin. */
function fitToUnitBbox(polygons: Polygon[]): Polygon[] {
  const bbox = computeSceneBbox(polygons);
  const cx = (bbox.min[0] + bbox.max[0]) / 2;
  const cy = (bbox.min[1] + bbox.max[1]) / 2;
  const cz = (bbox.min[2] + bbox.max[2]) / 2;
  const size = Math.max(
    bbox.max[0] - bbox.min[0],
    bbox.max[1] - bbox.min[1],
    bbox.max[2] - bbox.min[2],
  ) || 1;
  const k = 2 / size;
  return polygons.map((p) => ({
    ...p,
    vertices: p.vertices.map((v): Vec3 => [
      (v[0] - cx) * k,
      (v[1] - cy) * k,
      (v[2] - cz) * k,
    ]),
  }));
}

const host = document.getElementById("host")!;
const camera = createGlyphPerspectiveCamera({ rotX: 0.5, rotY: 0.4, zoom: 0.35, distance: 100 });
const scene = createGlyphScene(host, { camera, autoSize: true });

createGlyphOrbitControls(scene, { drag: true, wheel: true });

loadMesh("/apple.glb").then((result) => {
  scene.add(fitToUnitBbox(result.polygons));
});
