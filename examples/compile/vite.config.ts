import { defineConfig } from "vite";
import { glyphcssCompile } from "@glyphcss/compile/vite";

// Build-time compile: `import "*.glb?glyph"` becomes the static <pre> ASCII.
export default defineConfig({
  plugins: [glyphcssCompile()],
});
