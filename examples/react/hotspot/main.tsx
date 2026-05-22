import { createRoot } from "react-dom/client";
import {
  GlyphPerspectiveCamera,
  GlyphScene,
  GlyphOrbitControls,
  GlyphMesh,
  GlyphHotspot,
} from "@glyphcss/react";

function App() {
  return (
    <GlyphPerspectiveCamera rotX={1.13} rotY={0.785} zoom={0.25} distance={100} style={{ width: "100%", height: "100vh" }}>
      <GlyphScene>
        <GlyphOrbitControls drag wheel />
        <GlyphMesh geometry="cube" color="#4488ff" />
        <GlyphHotspot id="corner" at={[-0.5, -0.5, 0.5]} onClick={() => alert("corner")}>
          <span style={{ cursor: "pointer", background: "#ff6644", color: "#fff", padding: "2px 6px", borderRadius: 4, fontSize: 12, whiteSpace: "nowrap" }}>
            corner
          </span>
        </GlyphHotspot>
      </GlyphScene>
    </GlyphPerspectiveCamera>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
