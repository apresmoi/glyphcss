import { glyphDiagramError } from "./validate";

// Reserving the subpath does not make ELK a root-entry dependency.
export async function layoutGlyphGraphElk(): Promise<never> {
  return glyphDiagramError("GLYPH_DIAGRAM_ELK_NOT_INSTALLED", "The ELK layout adapter is reserved for phase 4; use engine: dagre.");
}
