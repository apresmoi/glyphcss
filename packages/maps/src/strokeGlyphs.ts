/** Experimental glyph selection; coverage and depth decisions belong to stroke.ts. */
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
  pathMask = -1,
): string {
  const { col, row, subRow, dx, dy } = sample;
  if (strategy === "dots") return "·";
  if (strategy === "bullets") return "•";
  if (strategy === "fine") return subRow < 1 / 3 ? "˙" : subRow < 2 / 3 ? "·" : ".";
  // A grid phase survives drape subdivisions, reversed arcs and tile cuts.
  // Every cell still inks: a blank dash gap would change coverage/occlusion.
  if (strategy === "dashdot") return (col + row) % 4 === 0 ? "·" : Math.abs(dx) >= Math.abs(dy) ? "-" : "|";

  const horizontal = Math.abs(dy) < Math.abs(dx) * 0.41421356237;
  const vertical = Math.abs(dx) < Math.abs(dy) * 0.41421356237;
  if (strategy === "box") {
    const junctions = ["", "│", "─", "└", "│", "│", "┌", "├", "─", "┘", "─", "┴", "┐", "┤", "┬", "┼"];
    return junctions[pathMask] || "·";
  }
  const idx = row * cols + col;
  const n = samples.has(idx - cols);
  const e = col + 1 < cols && samples.has(idx + 1);
  const s = samples.has(idx + cols);
  const w = col > 0 && samples.has(idx - 1);
  if ((n || s) && (e || w)) return "+";
  if (horizontal || ((e || w) && !(n || s))) return subRow < 1 / 3 ? "‾" : subRow < 2 / 3 ? "-" : "_";
  if (vertical) return "|";
  return subRow < 0.5 ? (dx * dy >= 0 ? "`" : "'") : (dx * dy >= 0 ? "," : ".");
}

/** Connectivity belongs to ordered paths, never to spatially adjacent ink. */
export function glyphMapStrokePathMasks(paths: readonly (readonly number[])[], cols: number): Map<number, number> {
  const masks = new Map<number, number>();
  const add = (idx: number, mask: number) => masks.set(idx, (masks.get(idx) ?? 0) | mask);
  for (const path of paths) {
    for (const idx of path) if (!masks.has(idx)) masks.set(idx, 0);
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1]!, b = path[i]!;
      const dx = b % cols - a % cols, dy = Math.floor(b / cols) - Math.floor(a / cols);
      if (dy === 0 && Math.abs(dx) === 1) { add(a, dx > 0 ? 2 : 8); add(b, dx > 0 ? 8 : 2); }
      else if (dx === 0 && Math.abs(dy) === 1) { add(a, dy > 0 ? 4 : 1); add(b, dy > 0 ? 1 : 4); }
    }
  }
  return masks;
}
