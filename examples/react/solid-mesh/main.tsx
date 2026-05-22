import { createRoot } from "react-dom/client";
import { useState, useEffect } from "react";
import {
  GlyphPerspectiveCamera,
  GlyphScene,
  GlyphOrbitControls,
  GlyphMesh,
  loadMesh,
} from "@glyphcss/react";
import { computeSceneBbox } from "@glyphcss/react";
import type { Polygon, Vec3 } from "@glyphcss/react";

const GLB_URL = "/apple.glb";

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

function App() {
  const [polygons, setPolygons] = useState<Polygon[] | undefined>();

  useEffect(() => {
    loadMesh(GLB_URL).then((result) => setPolygons(fitToUnitBbox(result.polygons)));
  }, []);

  return (
    <GlyphPerspectiveCamera rotX={0.5} rotY={0.4} zoom={0.35} distance={100} style={{ width: "100%", height: "100vh" }}>
      <GlyphScene>
        <GlyphOrbitControls drag wheel />
        {polygons && <GlyphMesh polygons={polygons} />}
      </GlyphScene>
    </GlyphPerspectiveCamera>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
