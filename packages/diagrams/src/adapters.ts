import type { GlyphGraph } from "./types";
import { validateGlyphGraph } from "./validate";

export function glyphGraphFromJson(input: unknown): GlyphGraph {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return validateGlyphGraph(input);
  const graph = input as Record<string, unknown>;
  return validateGlyphGraph({ ...graph, direction: graph.direction === undefined ? "TB" : graph.direction });
}
