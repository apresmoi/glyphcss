import { createRoot } from "react-dom/client";
import {
  GlyphPerspectiveCamera,
  GlyphScene,
  GlyphOrbitControls,
  GlyphMesh,
} from "@glyphcss/react";

// `src` fetches + parses the mesh; `autoCenter` recenters it to the origin so it
// pivots around its own center. No manual loadMesh / recenter boilerplate.
function App() {
  return (
    <GlyphPerspectiveCamera rotX={25} rotY={25} zoom={0.35} distance={100} style={{ width: "100%", height: "100vh" }}>
      <GlyphScene autoSize>
        <GlyphOrbitControls drag wheel />
        <GlyphMesh src="/apple.glb" autoCenter />
      </GlyphScene>
    </GlyphPerspectiveCamera>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
