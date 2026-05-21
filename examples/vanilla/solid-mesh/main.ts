import {
  createGlyphPerspectiveCamera,
  createGlyphScene,
  createGlyphOrbitControls,
  loadMesh,
} from "glyphcss";

const host = document.getElementById("host")!;
const camera = createGlyphPerspectiveCamera({ rotX: 0.5, rotY: 0.4, zoom: 0.35, distance: 100 });
const scene = createGlyphScene(host, { camera });

createGlyphOrbitControls(scene, { drag: true, wheel: true });

loadMesh("https://glyphcss.com/gallery/glb/poly-pizza/human-dude-guy.glb").then((result) => {
  scene.add(result);
});
