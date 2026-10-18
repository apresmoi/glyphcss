import type { GlyphCanvasTierName } from "glyphcss";
import type { GlyphGraphNodeShape } from "./types";

/** First kept candidates from the user-reviewed catalogue; alternatives are fixtures only. */
export const GLYPH_DIAGRAM_CATALOGUE_SHAPES = [
  "doc", "docs", "st-rect", "tag-doc", "notch-rect", "div-rect", "lin-rect", "tag-rect",
  "lean-r", "lean-l", "trap-t", "trap-b", "notch-pent", "delay", "bow-rect", "curv-trap",
  "tri", "flip-tri", "hourglass", "bolt", "flag", "dbl-circ", "cross-circ", "fr-circ",
  "f-circ", "sm-circ", "h-cyl", "lin-cyl", "datastore", "bucket", "text", "fork", "brace",
  "brace-r", "braces", "browser", "console", "person",
] as const satisfies readonly GlyphGraphNodeShape[];
type GlyphCatalogueShape = typeof GLYPH_DIAGRAM_CATALOGUE_SHAPES[number];
const shapes = new Set<string>(GLYPH_DIAGRAM_CATALOGUE_SHAPES);
export function glyphDiagramCatalogueShape(shape: string | undefined): shape is GlyphCatalogueShape { return shapes.has(shape ?? ""); }

const ASCII_GLYPHS: Readonly<Record<string, string>> = Object.fromEntries([
  ["─━═", "-"], ["│║", "|"], ["┌┐└┘├┤┬┴╭╮╰╯╔╗╚╝", "+"],
  ["╱", "/"], ["╲", "\\"], ["◠◡", "~"], ["◜◟", "("], ["◝◞", ")"],
  ["●", "*"], ["○", "o"], ["╳", "x"], ["◇", "o"],
].flatMap(([glyphs, ascii]) => [...glyphs!].map(glyph => [glyph, ascii!])));

export interface GlyphDiagramCatalogueArt {
  readonly width: number;
  readonly height: number;
  readonly rows: readonly string[];
  /** Legal side rows include the body, never a head, stack seam or title bar. */
  readonly portRows: readonly number[];
}

/** One geometry owner for measurement, legal ports and painting, including external labels. */
export function glyphDiagramCatalogueArt(shape: GlyphCatalogueShape, lines: readonly string[], charset: GlyphCanvasTierName = "box", minWidth = 0, minHeight = 0): GlyphDiagramCatalogueArt {
  const length = Math.max(0, ...lines.map(line => line.length));
  let w = Math.max(length + 4, minWidth), h = Math.max(lines.length + 2, minHeight), left = 2, top = 1;
  let content = length, alignLeft = false;
  if (["tag-doc", "tag-rect", "lin-rect", "bolt", "dbl-circ", "browser", "console"].includes(shape)) w = Math.max(length + (shape === "bolt" ? 7 : 6), minWidth);
  if (shape === "doc") w = Math.max(length + 6, minWidth);
  if (shape === "tag-doc") w = Math.max(length + 6, minWidth);
  if (shape === "lin-cyl") { w = Math.max(length + 6, minWidth); h = Math.max(lines.length + 4, minHeight); top = 2; alignLeft = true; }
  if (shape === "console" || shape === "person" || shape === "docs" || shape === "st-rect") { h = Math.max(lines.length + 3, minHeight); top = 2; }
  if (shape === "docs" || shape === "st-rect") w = Math.max(length + 5, minWidth);
  if (["trap-t", "trap-b", "notch-pent", "bucket"].includes(shape)) w = Math.max(length + 6, minWidth);
  if (shape === "lean-r" || shape === "lean-l") w = Math.max(length + h + 3, minWidth);
  if (shape === "bow-rect" || shape === "hourglass") { w = Math.max(length + 4, minWidth); left = 2; }
  if (shape === "cross-circ" || shape === "f-circ" || shape === "sm-circ" || shape === "text") {
    left = shape === "cross-circ" ? 4 : shape === "text" ? 1 : 2;
    w = Math.max(length + left, minWidth); h = Math.max(lines.length, minHeight); top = 0; alignLeft = true;
  }
  if (shape === "fr-circ") { left = 6; w = Math.max(length + left, minWidth); h = Math.max(lines.length + 2, minHeight); alignLeft = true; }
  if (shape === "brace") { left = 2; w = Math.max(length + 2, minWidth); alignLeft = true; }
  if (shape === "brace-r") { left = 1; w = Math.max(length + 3, minWidth); alignLeft = true; }
  if (shape === "braces") w = Math.max(length + 4, minWidth);
  if (shape === "fork") { w = Math.max(9, length + 4, minWidth); h = Math.max(length ? lines.length + 3 : 2, minHeight); top = 2; }
  if (shape === "tri" || shape === "flip-tri") {
    w = Math.max(length + 4 + 2 * (lines.length - 1), minWidth, 2 * (minHeight - 1));
    w += w % 2;
    h = w / 2 + 1;
    top = shape === "tri" ? h - 1 - lines.length : 1;
  }
  if (shape === "h-cyl") w = Math.max(length + 5, minWidth);
  content = w - 2 * left;
  if (["cross-circ", "f-circ", "sm-circ", "text", "fr-circ", "brace", "brace-r"].includes(shape)) content = length;
  const grid = Array.from({ length: h }, () => Array<string>(w).fill(" "));
  const put = (x: number, y: number, text: string) => { for (const [i, ch] of [...text].entries()) if (grid[y] && x + i >= 0 && x + i < w) grid[y]![x + i] = ch; };
  const rule = (y: number, a: string, b: string, glyph = "─", x = 0, width = w) => put(x, y, a + glyph.repeat(Math.max(0, width - 2)) + b);
  const sides = (a = "│", b = "│", y0 = 1, y1 = h - 2, x0 = 0, x1 = w - 1) => { for (let y = y0; y <= y1; y++) { put(x0, y, a); put(x1, y, b); } };
  const box = (corners = "┌┐└┘", y0 = 0, y1 = h - 1, width = w) => { rule(y0, corners[0]!, corners[1]!, "─", 0, width); rule(y1, corners[2]!, corners[3]!, "─", 0, width); sides("│", "│", y0 + 1, y1 - 1, 0, width - 1); };
  let portRows = Array.from({ length: Math.max(1, h - top - 1) }, (_, i) => top + i);
  if (shape === "tri" || shape === "flip-tri") portRows = Array.from({ length: h - 2 }, (_, i) => i + 1);
  switch (shape) {
    case "doc": case "tag-doc": case "tag-rect":
      box(); if (shape !== "tag-rect") rule(h - 1, "╰", "╯", "◡");
      if (shape !== "doc") { content = w - 6; for (let y = 1; y < h - 1; y++) put(w - 3, y, y === 1 ? "◇" : " "); }
      break;
    case "docs": case "st-rect":
      rule(0, "┌", "┐", "─", 1, w - 1); box("┌┐└┘", 1, h - 1, w - 1);
      sides("", "│", 1, h - 3); put(w - 1, h - 2, "┘");
      if (shape === "docs") rule(h - 1, "╰", "╯", "◡", 0, w - 1);
      content = w - 5; break;
    case "notch-rect": box(); put(0, 0, " ╱"); put(0, 1, "╱"); break;
    case "div-rect": box(); sides("├", "┤"); break;
    case "lin-rect": box(); put(2, 0, "┬"); put(2, h - 1, "┴"); for (let y = 1; y < h - 1; y++) put(2, y, "│"); left = 4; content = w - 6; break;
    case "lean-r": case "lean-l": {
      const right = shape === "lean-r";
      for (let y = 0; y < h; y++) {
        const x = right ? h - 1 - y : y, span = w - h + 1;
        if (y === 0 || y === h - 1) rule(y, right ? "╱" : "╲", right ? "╱" : "╲", "─", x, span);
        else { put(x, y, right ? "╱" : "╲"); put(x + span - 1, y, right ? "╱" : "╲"); }
      }
      content = w - h - 3; break;
    }
    case "trap-t": case "trap-b": case "bucket": {
      const down = shape !== "trap-b";
      if (shape === "bucket") rule(0, "◜", "◝", "◠");
      else if (down) put(0, 0, "─".repeat(w)); else rule(0, "╱", "╲", "─", 1, w - 2);
      sides(down ? "╲" : "╱", down ? "╱" : "╲");
      if (down) rule(h - 1, shape === "bucket" ? "╰" : "╲", shape === "bucket" ? "╯" : "╱", "─", 1, w - 2);
      else put(0, h - 1, "─".repeat(w));
      content = w - 6; left = 3; break;
    }
    case "notch-pent": box(); put(0, 0, " "); put(w - 1, 0, " "); put(1, 0, "╱"); put(w - 2, 0, "╲"); left = 3; content = w - 6; break;
    case "delay": box("┌╮└╯"); break;
    case "bow-rect": case "hourglass": rule(0, "╲", "╱"); rule(h - 1, "╱", "╲"); sides(")", "(", 1, h - 2, 1, w - 2); content = w - 4; break;
    case "curv-trap": box("╱╮╲╯"); put(0, 0, " ╱"); put(0, h - 1, " ╲"); sides("("); break;
    case "tri": case "flip-tri": {
      const flip = shape === "flip-tri";
      for (let y = 0; y < h - 1; y++) {
        const x = h - 2 - y, row = flip ? h - 1 - y : y;
        put(x, row, flip ? "╲" : "╱"); put(w - 1 - x, row, flip ? "╱" : "╲");
      }
      put(0, flip ? 0 : h - 1, "─".repeat(w)); content = length; break;
    }
    case "bolt": case "browser": case "console":
      box(); if (shape === "console") rule(1, "├", "┤");
      left = shape === "bolt" ? 5 : 4; content = w - left - 2;
      for (let y = top; y < h - 1; y++) put(2, y, y === top ? shape === "bolt" ? "╲╱" : shape === "browser" ? "○" : "$" : " ");
      break;
    case "flag": box("╭╮╰╯"); rule(0, "╭", "╮", "◠"); rule(h - 1, "╰", "╯", "◡"); break;
    case "dbl-circ": box("╔╗╚╝"); rule(0, "╔", "╗", "═"); rule(h - 1, "╚", "╝", "═"); sides("║", "║");
      for (let y = 1; y < h - 1; y++) { put(1, y, "("); put(w - 2, y, ")"); } left = 3; content = w - 6; break;
    case "cross-circ": case "f-circ": case "sm-circ":
      put(0, Math.floor((h - 1) / 2), shape === "cross-circ" ? "(╳)" : shape === "f-circ" ? "●" : "○"); portRows = Array.from({ length: h }, (_, i) => i); break;
    case "fr-circ":
      box("┌┐└┘", 0, h - 1, 5); put(2, Math.floor((h - 1) / 2), "○"); break;
    case "h-cyl": box("╭╮╰╯"); put(w - 2, 0, "┬"); put(w - 2, h - 1, "┴"); for (let y = 1; y < h - 1; y++) put(w - 2, y, "│"); content = w - 5; break;
    case "lin-cyl": box(); rule(1, "├", "┤"); rule(h - 2, "├", "┤"); portRows = Array.from({ length: h - 4 }, (_, i) => i + 2); break;
    case "datastore": put(0, 0, "─".repeat(w)); put(0, h - 1, "─".repeat(w)); break;
    case "text": portRows = Array.from({ length: h }, (_, i) => i); break;
    case "fork":
      put(0, 0, "━".repeat(w));
      for (let y = 1; y < (length ? 2 : h); y++) put(Math.floor((w - 2) / 2), y, "│");
      portRows = Array.from({ length: h - (length ? 2 : 1) }, (_, i) => i + (length ? 2 : 1)); break;
    case "brace": case "brace-r": case "braces":
      if (shape !== "brace-r") { put(0, 0, "╭"); put(0, h - 1, "╰"); sides("│", "", 1, h - 2, 0, w - 1); put(0, Math.floor((h - 1) / 2), "┤"); }
      if (shape !== "brace") { put(w - 1, 0, "╮"); put(w - 1, h - 1, "╯"); sides("", "│", 1, h - 2, 0, w - 1); put(w - 1, Math.floor((h - 1) / 2), "├"); }
      break;
    case "person": box("╭╮╰╯", 1); put(Math.floor((w - 1) / 2), 0, "○"); break;
  }
  const available = h - top - (shape === "text" || ["cross-circ", "f-circ", "sm-circ"].includes(shape) ? 0 : shape === "lin-cyl" ? 2 : 1);
  const labelTop = top + Math.max(0, Math.floor((available - lines.length) / 2));
  lines.forEach((line, i) => {
    let x = alignLeft ? left : left + Math.floor((content - line.length) / 2);
    if (shape === "lean-r" || shape === "lean-l") {
      const y = labelTop + i, start = shape === "lean-r" ? h - 1 - y : y;
      x = start + 2 + Math.floor((content - line.length) / 2);
    }
    if (shape === "tri" || shape === "flip-tri") x = Math.floor((w - line.length) / 2);
    put(x, labelTop + i, line);
  });
  return { width: w, height: h, portRows, rows: grid.map(row => row.map(ch => charset === "ascii" ? ASCII_GLYPHS[ch] ?? ch : ch).join("")) };
}
