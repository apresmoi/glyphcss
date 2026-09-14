/**
 * `@glyphcss/diagrams/3d` — the 3D graph subpath (PLAN-3d.md §2.2, §6). Pulls
 * in `glyphcss`'s scene-object/rasterizer surface, so the diagrams ROOT entry
 * (`src/index.ts`) must never import from here — a 2D/chat/CLI consumer of
 * `@glyphcss/diagrams` pays nothing for it (PLAN-3d.md §2.2's tree-shaking
 * rationale for the `./3d` subpath split).
 */
export {
  layout3d,
  GLYPH_DIAGRAM_3D_CAMERA_ROT_X,
  GLYPH_DIAGRAM_3D_CAMERA_ROT_Y,
  GLYPH_DIAGRAM_3D_GROUP_PAD,
} from "./layout3d";
export type {
  GlyphDiagram3dLayoutKind,
  GlyphDiagram3dNode,
  GlyphDiagram3dEdge,
  GlyphDiagram3dGroup,
  GlyphDiagram3dLayout,
  GlyphDiagram3dLayoutOptions,
} from "./layout3d";
export { glyphDiagramObject } from "./glyphDiagramObject";
export type { GlyphDiagramObjectOptions } from "./glyphDiagramObject";
export {
  renderGlyphDiagram3d,
  renderGlyphDiagram3dJson,
  resolveCharset,
  GLYPH_DIAGRAM_3D_LIGHT,
  GLYPH_DIAGRAM_3D_AMBIENT_LIGHT,
} from "./render3d";
export type {
  GlyphDiagram3dTarget,
  GlyphDiagram3dCharset,
  GlyphDiagram3dColorMode,
  GlyphDiagram3dCamera,
  GlyphDiagram3dRenderOptions,
  GlyphDiagram3dReport,
  GlyphDiagram3dResult,
  ResolvedCharset,
} from "./render3d";
