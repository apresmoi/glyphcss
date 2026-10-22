/** Experimental comparison only; no coverage, colour, or depth decisions live here. */
export type GlyphMapStrokeGlyphStrategy = "baseline" | "ascii" | "box" | "dots" | "bullets" | "dashdot" | "fine";

export interface GlyphMapStrokeGlyphSample {
  readonly col: number;
  readonly row: number;
  readonly subCol: number;
  readonly subRow: number;
  readonly dx: number;
  readonly dy: number;
}

export function glyphMapExperimentalStrokeGlyph(
  strategy: GlyphMapStrokeGlyphStrategy,
  sample: GlyphMapStrokeGlyphSample,
  samples: ReadonlyMap<number, GlyphMapStrokeGlyphSample>,
  cols: number,
): string {
  const { col, row, subRow, dx, dy } = sample;
  if (strategy === "dots") return "·";
  if (strategy === "bullets") return "•";
  if (strategy === "fine") return subRow < 1 / 3 ? "˙" : subRow < 2 / 3 ? "·" : ".";
  // A grid phase survives drape subdivisions, reversed arcs and tile cuts.
  // Every cell still inks: a blank dash gap would change coverage/occlusion.
  if (strategy === "dashdot") return (col + row) % 4 === 0 ? "·" : Math.abs(dx) >= Math.abs(dy) ? "-" : "|";

  const idx = row * cols + col;
  const n = samples.has(idx - cols);
  const e = col + 1 < cols && samples.has(idx + 1);
  const s = samples.has(idx + cols);
  const w = col > 0 && samples.has(idx - 1);
  const mask = Number(n) | (Number(e) << 1) | (Number(s) << 2) | (Number(w) << 3);
  const horizontal = Math.abs(dy) < Math.abs(dx) * 0.41421356237;
  const vertical = Math.abs(dx) < Math.abs(dy) * 0.41421356237;
  if (strategy === "box") {
    // Diagonally touching cells cannot become orthogonally connected without
    // adding coverage, so retain slashes where no cardinal neighbour exists.
    const junctions = ["", "│", "─", "└", "│", "│", "┌", "├", "─", "┘", "─", "┴", "┐", "┤", "┬", "┼"];
    return junctions[mask] || (horizontal ? "─" : vertical ? "│" : dx * dy >= 0 ? "\\" : "/");
  }
  if ((n || s) && (e || w)) return "+";
  if (horizontal || ((e || w) && !(n || s))) return subRow < 1 / 3 ? "‾" : subRow < 2 / 3 ? "-" : "_";
  if (vertical) return "|";
  return subRow < 0.5 ? (dx * dy >= 0 ? "`" : "'") : (dx * dy >= 0 ? "," : ".");
}
