/**
 * Extrude a single line of text into a 3D polygon mesh glyphcss can render.
 * For multiline / styled / WordArt composition see `composeText`.
 *
 * parseFont emits glyph space as font units, y-up, baseline at 0. We place
 * each glyph into a flat "type plane" (x → right along the baseline, y → up),
 * centered on the origin, then hand the grouped shapes to `extrudeContours`.
 */
import type { Polygon } from "@glyphcss/core";
import type { ParsedFont } from "./parseFont";
import {
  dedupeContour,
  extrudeContours,
  groupShapes,
  shade,
  type ExtrudeProfile,
  type Pt,
  type Shape,
} from "./extrude";

export type { ExtrudeProfile };

export interface TextPolygonsOptions {
  /** Cap-em size in world units. Defaults to 100. */
  size?: number;
  /** Extrusion depth along the world Z axis, in world units. Defaults to size*0.2. */
  depth?: number;
  /** Bézier flattening: segments per curve. Higher = smoother, more polys. */
  curveSteps?: number;
  /** Extra space between glyphs, in world units. */
  letterSpacing?: number;
  /** Front/back cap color. */
  color?: string;
  /** Side-wall color. Defaults to a slightly darker shade of `color`. */
  sideColor?: string;
  /** Depth cross-section shape. Defaults to "flat". */
  profile?: ExtrudeProfile;
  /** Rings used to sample a round/bevel profile. Higher = smoother, more polys. */
  profileSegments?: number;
}

export function textPolygons(font: ParsedFont, text: string, options: TextPolygonsOptions = {}): Polygon[] {
  const size = options.size ?? 100;
  const depth = options.depth ?? size * 0.2;
  const curveSteps = Math.max(1, Math.round(options.curveSteps ?? 6));
  const letterSpacing = options.letterSpacing ?? 0;
  const color = options.color ?? "#d4a82a";
  const sideColor = options.sideColor ?? shade(color, 0.72);
  const profile = options.profile ?? "flat";
  const profileSegments = Math.max(1, Math.round(options.profileSegments ?? 6));

  const scale = size / font.unitsPerEm;
  const chars = [...text];
  const glyphs = chars.map((ch) => {
    const cp = ch.codePointAt(0) ?? 0;
    return { cp, g: font.glyph(cp, curveSteps) };
  });

  let totalAdvance = 0;
  glyphs.forEach(({ cp, g }, i) => {
    if (i > 0) totalAdvance += font.kerning(glyphs[i - 1].cp, cp) * scale;
    totalAdvance += g.advanceWidth * scale + letterSpacing;
  });
  let cursor = -totalAdvance / 2;

  const shapes: Shape[] = [];
  glyphs.forEach(({ cp, g }, i) => {
    if (i > 0) cursor += font.kerning(glyphs[i - 1].cp, cp) * scale;
    if (g.contours.length) {
      const placed = g.contours.map((c) =>
        dedupeContour(c.map(([x, y]): Pt => [x * scale + cursor, y * scale])),
      );
      shapes.push(...groupShapes(placed));
    }
    cursor += g.advanceWidth * scale + letterSpacing;
  });

  return extrudeContours(shapes, {
    depth,
    profile,
    profileSegments,
    maxInset: size * 0.045,
    stops: [
      { at: 0, color },
      { at: 0.5, color: sideColor },
      { at: 1, color },
    ],
  });
}
