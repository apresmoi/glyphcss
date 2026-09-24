/**
 * `@glyphcss/diagrams/lanes` — the lane-DAG subpath. Its own entry point,
 * never imported by the diagrams ROOT (`src/index.ts`), `./3d`, or
 * `./sequence`: a caller who only wants one of the other forms pays nothing
 * for this one, and vice versa — mirrors the existing `./sequence` split
 * (`packages/diagrams/AGENTS.md`'s "Root vs ./3d vs ./sequence vs ./lanes").
 */
export type * from "./types";
export * from "./validate";
export * from "./schema";
export { glyphLaneDagFromGitLog } from "./git";
export {
  layoutGlyphLaneRows, applyGlyphLaneCap,
} from "./layout";
export type {
  GlyphLaneRow, GlyphLaneNodeRow, GlyphLaneConnectorRow, GlyphLaneRowsResult, GlyphLaneCapResult,
} from "./layout";
export { paintGlyphLaneDag, GLYPH_LANE_COLUMN_WIDTH, GLYPH_LANE_MIN_CONTENT_WIDTH } from "./paint";
export type { GlyphLanePaintResult } from "./paint";
export {
  renderGlyphLaneDag, renderGlyphLaneDagJson, GLYPH_LANE_TARGET_DEFAULTS,
} from "./render";
export type {
  GlyphLaneTarget, GlyphLaneCharset, GlyphLaneColorMode, GlyphLaneRenderOptions,
  GlyphLaneReport, GlyphLanePage, GlyphLaneMeta, GlyphLaneResult,
} from "./render";
