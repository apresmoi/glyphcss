/**
 * `@glyphcss/diagrams/3d` — the 3D graph subpath (PLAN-3d.md §2.2, §6). Pulls
 * in `glyphcss`'s scene-object/rasterizer surface, so the diagrams ROOT entry
 * (`src/index.ts`) must never import from here — a 2D/chat/CLI consumer of
 * `@glyphcss/diagrams` pays nothing for it (PLAN-3d.md §2.2's tree-shaking
 * rationale for the `./3d` subpath split).
 */
export {
  layout3d,
  GLYPH_DIAGRAM_3D_LAYER_HEIGHT,
  GLYPH_DIAGRAM_3D_NODE_HEIGHT,
  GLYPH_DIAGRAM_3D_GROUP_PAD,
} from "./layout3d";
export type {
  GlyphDiagram3dLayoutKind,
  GlyphDiagram3dZBy,
  GlyphDiagram3dNode,
  GlyphDiagram3dEdge,
  GlyphDiagram3dGroup,
  GlyphDiagram3dLayout,
  GlyphDiagram3dLayoutOptions,
} from "./layout3d";
export { glyphDiagramObject } from "./glyphDiagramObject";
export type { GlyphDiagramObjectOptions } from "./glyphDiagramObject";
