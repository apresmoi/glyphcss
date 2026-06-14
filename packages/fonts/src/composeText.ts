/**
 * Compose styled, multi-line text into a 3D polygon mesh.
 *
 * Builds on the same type-plane → extrude pipeline as `textPolygons`, adding
 * line breaks (`\n`), per-line alignment, line height, underline /
 * strikethrough bars, and classic WordArt-style **warps** (arch / arc / wave /
 * bulge / slant). The warp deforms every point in the flat type plane before
 * extrusion, so the 3D walls follow the curve too. Bold/italic are chosen by
 * the caller by passing the appropriate weight/style `ParsedFont`.
 */
import type { Polygon } from "@glyphcss/core";
import type { ParsedFont } from "./parseFont";
import {
  dedupeContour,
  extrudeContours,
  groupShapes,
  shade,
  simplifyContour,
  type CubicBezier,
  type Contour,
  type ExtrudeProfile,
  type MaterialStop,
  type Pt,
  type Shape,
} from "./extrude";

/** Classic WordArt envelope shapes. */
export type WarpShape =
  | "none"
  | "arch"
  | "archDown"
  | "arc"
  | "wave"
  | "bulge"
  | "cone"
  | "slantUp"
  | "slantDown";

export interface WarpOptions {
  shape: WarpShape;
  /** Warp strength, 0..1. Defaults to 0.5. */
  amount?: number;
}

/** A paintable face: a solid color and/or an already-rendered texture. */
export interface Face {
  /** Solid color; also the fallback if the texture fails to load. */
  color?: string;
  /**
   * Texture URL / data URL — a gradient, rainbow, image, or block texture
   * already rendered (see `resolveFace` / `makeFillTexture`). UV-mapped across
   * the whole word so the fill flows over every glyph.
   */
  texture?: string;
  /** Tile the texture every N world units (block look); omit to stretch one copy. */
  tile?: number;
}

/** The back face, which can be offset for the flat WordArt drop shadow (depth 0). */
export interface BackFace extends Face {
  /** [rightward, upward] shift of the back relative to the front (world units). */
  offset?: [number, number];
}

/** A `Face` pinned at a position on the depth axis (`at`: 0 = front, 1 = back). */
export interface FaceStop extends Face {
  at: number;
}

/**
 * Extrusion cross-section / edge profile:
 * - `"flat"` — straight slab (no edge shaping).
 * - `{ edge }` — a bevel chamfer or round bullnose on the edge (mirrored
 *   front/back). `raised` flips a round to a convex dome.
 * - `{ curve }` — a custom edge whose cross-section is a CSS cubic-bezier easing.
 */
export type Profile =
  | "flat"
  | { edge: "bevel" | "round"; raised?: boolean; segments?: number }
  | { curve: CubicBezier; segments?: number };

export interface ComposeTextOptions {
  /** Cap-em size in world units. Defaults to 100. */
  size?: number;
  /** Extrusion depth (world units). 0 = a flat slab with no edges. Defaults to size*0.2. */
  depth?: number;
  /** Bézier flattening: segments per glyph curve. Higher = smoother. Defaults to 6. */
  curveSteps?: number;
  /** Extra space between glyphs (world units). */
  letterSpacing?: number;
  /** Line advance as a multiple of `size`. Defaults to 1.25. */
  lineHeight?: number;
  /** Horizontal alignment of each line within the block. Defaults to "center". */
  align?: "left" | "center" | "right";
  /** Non-uniform glyph stretch [x, y] (WordArt-style). Defaults to [1, 1]. */
  scale?: [number, number];
  /** Draw an underline / strikethrough bar under each line. */
  underline?: boolean;
  strike?: boolean;
  /** WordArt envelope warp applied to the whole block. */
  warp?: WarpOptions;
  /** Outline simplification tolerance (world units, 0 = exact; hole-less glyphs only). */
  simplify?: number;
  /** Extrusion cross-section / edge profile. Defaults to "flat". */
  profile?: Profile;
  /**
   * Material along the depth axis. Three shapes, simplest → most general:
   * - `{ front?, sides?, back? }` — the classic faces (sugar for 3 stops). Omit
   *   `sides` for no side band (front rounds into back), or set `sides` / `back`
   *   to `false` to skip that geometry entirely.
   * - a single `Face` — one material for the whole solid.
   * - `FaceStop[]` — N materials distributed down the axis (`at` 0→1).
   */
  faces?: Face | FaceStop[] | { front?: Face; sides?: Face | false; back?: BackFace | false };
  /** Outline stroke drawn as a halo around the front face. */
  outline?: { color: string; width: number };
}

function resolveProfile(p: Profile | undefined): {
  profile: ExtrudeProfile;
  roundConvex?: boolean;
  profileBezier?: CubicBezier;
  segments?: number;
} {
  if (!p || p === "flat") return { profile: "flat" };
  if ("edge" in p) return { profile: p.edge, roundConvex: p.raised, segments: p.segments };
  return { profile: "custom", profileBezier: p.curve, segments: p.segments };
}

/**
 * Fewest quarter-arc segments whose worst chord error (sagitta) stays under
 * `tol` world units, clamped to [2, 6]. For a radius-`r` quarter circle split
 * into N segments the sagitta is `r·(1 − cos(π/2N))`; solve that ≤ tol for N.
 */
function adaptiveRoundSegments(r: number, tol: number): number {
  if (r <= tol || r <= 1e-6) return 2;
  const n = Math.ceil(Math.PI / (2 * Math.acos(1 - tol / r)));
  return Math.min(6, Math.max(2, n));
}

/**
 * Normalize the `faces` option into sorted material stops. A face set to `false`
 * (or `sides` omitted) contributes no stop — the geometry is still rendered, but
 * the nearest remaining face covers it (no hole, just fewer colour bands). The
 * active faces split the depth axis evenly (stop i centered at `(i+½)/k`).
 */
function resolveStops(
  faces: ComposeTextOptions["faces"],
  defaultFront: string,
): { stops: MaterialStop[]; backOffset?: [number, number] } {
  const stop = (f: Face, at: number, color: string): MaterialStop => ({ at, color: f.color ?? color, texture: f.texture, tile: f.tile });
  if (Array.isArray(faces)) {
    return { stops: faces.length ? faces.map((f) => stop(f, f.at, defaultFront)) : [{ at: 0.5, color: defaultFront }] };
  }
  if (faces && ("front" in faces || "sides" in faces || "back" in faces)) {
    const front = faces.front ?? {};
    const fc = front.color ?? defaultFront;
    const items: { f: Face; color: string }[] = [{ f: front, color: fc }];
    if (faces.sides) items.push({ f: faces.sides, color: shade(fc, 0.72) });
    if (faces.back !== false) items.push({ f: faces.back ?? {}, color: fc });
    const k = items.length;
    const stops = items.map((it, i) => stop(it.f, (i + 0.5) / k, it.color));
    return { stops, backOffset: faces.back ? faces.back.offset : undefined };
  }
  if (faces) return { stops: [stop(faces as Face, 0.5, defaultFront)] }; // single Face → uniform
  // Default: the classic gold front / darker sides / matching back, even thirds.
  return { stops: [{ at: 1 / 6, color: defaultFront }, { at: 0.5, color: shade(defaultFront, 0.72) }, { at: 5 / 6, color: defaultFront }] };
}

type WarpFn = (p: Pt) => Pt;

export function composeText(font: ParsedFont, text: string, options: ComposeTextOptions = {}): Polygon[] {
  const size = options.size ?? 100;
  const depth = options.depth ?? size * 0.2;
  const curveSteps = Math.max(1, Math.round(options.curveSteps ?? 6));
  const letterSpacing = options.letterSpacing ?? 0;
  const lineHeight = (options.lineHeight ?? 1.25) * size;
  const align = options.align ?? "center";
  const simplify = Math.max(0, options.simplify ?? 0);
  const [scaleX, scaleY] = options.scale ?? [1, 1];

  const { stops, backOffset } = resolveStops(options.faces, "#d4a82a");

  const prof = resolveProfile(options.profile);
  // Ring count for the round edge. An explicit `segments` is honored; otherwise
  // pick the fewest segments whose chord (sagitta) error stays under ~0.4% of
  // the cap height — the round-over radius is capped at size*0.045, so a small
  // bevel never needs the full default. A custom curve keeps a fixed default
  // since its detail isn't a function of edge size.
  const roundEdge = Math.min(size * 0.045, depth / 2);
  const adaptive = prof.profile === "round"
    ? adaptiveRoundSegments(roundEdge, size * 0.004)
    : 6;
  const profileSegments = Math.max(1, Math.round(prof.segments ?? adaptive));
  // depth 0 → a flat slab with no side walls (and a place for the offset shadow).
  const flat = depth <= 0;

  const scale = size / font.unitsPerEm;
  const barThickness = size * 0.06;
  const underlineY = -size * 0.14;
  const strikeY = size * 0.26;

  const lines = text.split("\n");
  const measured = lines.map((line) => {
    const glyphs = [...line].map((ch) => font.glyph(ch.codePointAt(0) ?? 0, curveSteps));
    let width = 0;
    for (const g of glyphs) width += g.advanceWidth * scale * scaleX + letterSpacing;
    width = Math.max(0, width - letterSpacing);
    return { glyphs, width };
  });
  const blockWidth = Math.max(1, ...measured.map((m) => m.width));
  const n = measured.length;

  const warp = makeWarp(options.warp, -blockWidth / 2, blockWidth, size);
  const shapes: Shape[] = [];

  measured.forEach((line, lineIndex) => {
    const baselineY = ((n - 1) / 2 - lineIndex) * lineHeight - size * 0.34;
    let startX = -blockWidth / 2;
    if (align === "center") startX += (blockWidth - line.width) / 2;
    else if (align === "right") startX += blockWidth - line.width;

    let cursor = startX;
    for (const g of line.glyphs) {
      if (g.contours.length) {
        const placed = g.contours.map((c) =>
          dedupeContour(c.map(([x, y]): Pt => [x * scale * scaleX + cursor, y * scale * scaleY + baselineY])),
        );
        // Group on the accurate contours, then simplify — but ONLY glyphs with
        // no holes. Simplifying a holed glyph (P, o, e, a…) can move the outer
        // enough that the counter collapses or the offset cap overruns it,
        // filling the hole. Holed glyphs stay full-detail so holes never break.
        for (const shape of groupShapes(placed)) {
          const simplified: Shape = simplify > 0 && shape.holes.length === 0
            ? { outer: simplifyContour(shape.outer, simplify), holes: shape.holes }
            : shape;
          shapes.push(warpShape(simplified, warp));
        }
      }
      cursor += g.advanceWidth * scale * scaleX + letterSpacing;
    }

    if (line.width > 0) {
      const x0 = startX;
      const x1 = startX + line.width;
      if (options.underline) {
        shapes.push(warpShape(barShape(x0, x1, baselineY + underlineY - barThickness, baselineY + underlineY), warp));
      }
      if (options.strike) {
        shapes.push(warpShape(barShape(x0, x1, baselineY + strikeY - barThickness / 2, baselineY + strikeY + barThickness / 2), warp));
      }
    }
  });

  // Whole-word front-plane bounds, so the face fill UV-maps across every glyph.
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const s of shapes) {
    for (const [x, y] of s.outer) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  const faceUvBounds = shapes.length ? { minX, minY, maxX, maxY } : undefined;

  const polygons = extrudeContours(shapes, {
    depth,
    profile: prof.profile,
    roundConvex: prof.roundConvex,
    profileBezier: prof.profileBezier,
    profileSegments,
    maxInset: size * 0.045,
    stops,
    faceUvBounds,
    backOffset,
    layered: flat,
    outlineColor: options.outline?.color,
    outlineWidth: options.outline?.width,
  });
  return polygons;
}

function warpShape(shape: Shape, warp: WarpFn | null): Shape {
  if (!warp) return shape;
  return { outer: shape.outer.map(warp), holes: shape.holes.map((h) => h.map(warp)) };
}

/** A subdivided bar rectangle so decoration bars can curve under a warp. */
function barShape(x0: number, x1: number, yBot: number, yTop: number, segs = 24): Shape {
  const outer: Contour = [];
  for (let i = 0; i <= segs; i++) outer.push([x0 + ((x1 - x0) * i) / segs, yBot]);
  for (let i = segs; i >= 0; i--) outer.push([x0 + ((x1 - x0) * i) / segs, yTop]);
  return { outer, holes: [] };
}

/**
 * Build a point-warp for the type plane. `u` is the normalized position along
 * the block (0 at left, 1 at right); most shapes offset or scale y by a
 * function of u, while "arc" wraps the baseline around a circle (rotating the
 * letters with it). Returns null for "none".
 */
function makeWarp(opts: WarpOptions | undefined, left: number, width: number, size: number): WarpFn | null {
  if (!opts || opts.shape === "none") return null;
  const k = Math.max(0, Math.min(1, opts.amount ?? 0.5));
  if (k === 0) return null;
  const u = (x: number) => (x - left) / width;
  const bump = (t: number) => 1 - (2 * t - 1) * (2 * t - 1); // 0 at ends, 1 at center

  switch (opts.shape) {
    case "arch":
      return (p) => [p[0], p[1] + k * size * 0.7 * bump(u(p[0]))];
    case "archDown":
      return (p) => [p[0], p[1] - k * size * 0.7 * bump(u(p[0]))];
    case "wave":
      return (p) => [p[0], p[1] + k * size * 0.4 * Math.sin(2 * Math.PI * u(p[0]))];
    case "bulge":
      return (p) => [p[0], p[1] * (1 + k * bump(u(p[0])))];
    case "cone":
      return (p) => [p[0], p[1] * (1 - k * 0.75 * u(p[0]))];
    case "slantUp":
      return (p) => [p[0], p[1] + k * size * 0.6 * (u(p[0]) - 0.5)];
    case "slantDown":
      return (p) => [p[0], p[1] - k * size * 0.6 * (u(p[0]) - 0.5)];
    case "arc": {
      const span = Math.max(0.08, k) * Math.PI; // up to 180°
      const r = width / span;
      const cx = left + width / 2;
      return (p) => {
        const theta = (u(p[0]) - 0.5) * span;
        const rad = r + p[1];
        return [cx + rad * Math.sin(theta), -r + rad * Math.cos(theta)];
      };
    }
    default:
      return null;
  }
}
