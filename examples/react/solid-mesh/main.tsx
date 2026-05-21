import { createRoot } from "react-dom/client";
import { useState, useEffect } from "react";
import {
  GlyphPerspectiveCamera,
  GlyphScene,
  GlyphOrbitControls,
  GlyphMesh,
  loadMesh,
} from "@glyphcss/react";
import type { Polygon } from "@glyphcss/react";

const GLB_URL = "https://glyphcss.com/gallery/glb/poly-pizza/human-dude-guy.glb";

function App() {
  const [polygons, setPolygons] = useState<Polygon[] | undefined>();

  useEffect(() => {
    loadMesh(GLB_URL).then(setPolygons);
  }, []);

  return (
    <GlyphPerspectiveCamera rotX={0.5} rotY={0.4} zoom={0.35} distance={100} style={{ width: "100%", height: "100vh" }}>
      <GlyphOrbitControls drag wheel />
      <GlyphScene>
        {polygons && <GlyphMesh polygons={polygons} />}
      </GlyphScene>
    </GlyphPerspectiveCamera>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
