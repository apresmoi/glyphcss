import {
  createGlyphPerspectiveCamera,
  createGlyphScene,
  createGlyphOrbitControls,
  dodecahedronPolygons,
} from "glyphcss";

const host = document.getElementById("host")!;
const camera = createGlyphPerspectiveCamera({ rotX: 0.5, rotY: 0.4, zoom: 0.4, distance: 100 });
const scene = createGlyphScene(host, { camera });

createGlyphOrbitControls(scene, { drag: true, wheel: true });
scene.add(dodecahedronPolygons({ center: [0, 0, 0], size: 1, color: "#ff6644" }));
