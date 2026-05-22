import { createRoot } from "react-dom/client";
import {
  GlyphPerspectiveCamera,
  GlyphScene,
  GlyphOrbitControls,
  GlyphMesh,
} from "@glyphcss/react";

function App() {
  return (
    <GlyphPerspectiveCamera rotX={0.5} rotY={0.4} zoom={0.4} distance={100} style={{ width: "100%", height: "100vh" }}>
      <GlyphScene>
        <GlyphOrbitControls drag wheel />
        <GlyphMesh geometry="dodecahedron" color="#ff6644" />
      </GlyphScene>
    </GlyphPerspectiveCamera>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
