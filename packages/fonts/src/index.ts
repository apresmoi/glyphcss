// @glyphcss/fonts — fonts + text → extruded 3D Polygon[] for glyphcss.
//
// Two layers:
//   pure    — parseFont(bytes), textPolygons(font, text, config). No browser
//             globals; runs anywhere, returns plain Polygon[].
//   browser — listGoogleFonts(), googleFontUrl(), loadFont(url),
//             loadGoogleFont(), makeFillTexture(). The parts that touch
//             fetch / canvas.

export { parseFont } from "./parseFont";
export type { ParsedFont, FontGlyph } from "./parseFont";

export { textPolygons } from "./textPolygons";
export type { TextPolygonsOptions } from "./textPolygons";
export { cssCubicBezier } from "./extrude";
export type { ExtrudeProfile, CubicBezier, MaterialStop } from "./extrude";

export { composeText } from "./composeText";
export type { ComposeTextOptions, Profile, Face, BackFace, FaceStop, WarpShape, WarpOptions } from "./composeText";

export { makeFillTexture, resolveFace } from "./fill";
export type { FillSpec, FaceFillSpec } from "./fill";

export {
  listGoogleFonts,
  pickWeight,
  googleFontUrl,
  loadFont,
  loadGoogleFont,
} from "./googleFonts";
export type { FontEntry, FontStyle } from "./googleFonts";
