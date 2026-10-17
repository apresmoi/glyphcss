import { GLYPH_MERMAID_STATE_FRAME, type GlyphMermaidStateFrame, GLYPH_MERMAID_STATE_REGION, type GlyphMermaidStateRegion } from "./layoutHints";
import { GLYPH_DIAGRAM_DIRECTIONS, glyphDiagramGroupRects, type GlyphDiagramLayout, type GlyphDiagramRect } from "./pipeline";

/** Shared geometry keeps border ports clear of the divider the painter actually draws. */
export function glyphDiagramStateDividers(layout: GlyphDiagramLayout, rects: ReadonlyMap<string, GlyphDiagramRect>) {
  return layout.groups.flatMap(parent => {
    const regions = layout.groups.filter(group => (group as GlyphMermaidStateRegion)[GLYPH_MERMAID_STATE_REGION]?.parent === parent.id)
      .map(group => rects.get(group.id)).filter((rect): rect is GlyphDiagramRect => !!rect)
      .sort((a, b) => layout.direction === "TB" || layout.direction === "BT" ? a.x0 - b.x0 : a.y0 - b.y0);
    return regions.slice(1).map((after, index) => {
      const before = regions[index]!;
      const vertical = before.x1 < after.x0 || after.x1 < before.x0;
      const horizontal = before.y1 < after.y0 || after.y1 < before.y0;
      return { parent: parent.id, vertical, valid: vertical || horizontal,
        position: vertical ? Math.floor((Math.min(before.x1, after.x1) + Math.max(before.x0, after.x0)) / 2)
          : Math.floor((Math.min(before.y1, after.y1) + Math.max(before.y0, after.y0)) / 2) };
    });
  });
}

/** Rebind after translation: frame bounds clamp to the actual viewport, not the raw engine extent. */
export function glyphDiagramStateFramePorts(layout: GlyphDiagramLayout, bounds: { cols: number; rows: number }): GlyphDiagramLayout {
  if (!layout.edges.some(edge => (edge as GlyphMermaidStateFrame)[GLYPH_MERMAID_STATE_FRAME])) return layout;
  const rects = glyphDiagramGroupRects(layout, bounds);
  const dividers = glyphDiagramStateDividers(layout, rects);
  return { ...layout, ports: layout.ports.map(port => {
    const edge = layout.edges.find(edge => edge.id === port.edgeId)!;
    const frame = (edge as GlyphMermaidStateFrame)[GLYPH_MERMAID_STATE_FRAME]?.[port.end];
    const rect = frame && rects.get(frame.group);
    if (!rect) return port;
    const vertical = port.side === "n" || port.side === "s";
    const anchor = vertical ? { x: Math.floor((rect.x0 + rect.x1) / 2), y: port.side === "n" ? rect.y0 : rect.y1 }
      : { x: port.side === "w" ? rect.x0 : rect.x1, y: Math.floor((rect.y0 + rect.y1) / 2) };
    const axis = vertical ? "x" : "y", low = vertical ? rect.x0 : rect.y0, high = vertical ? rect.x1 : rect.y1;
    const avoid = dividers.filter(divider => divider.parent === frame!.group && divider.valid && divider.vertical === vertical);
    const positions = Array.from({ length: Math.max(0, high - low - 1) }, (_, i) => low + 1 + i)
      .filter(position => avoid.every(divider => Math.abs(position - divider.position) >= 2))
      .sort((a, b) => Math.abs(a - anchor[axis]) - Math.abs(b - anchor[axis]) || a - b);
    if (positions.length) anchor[axis] = positions[0]!;
    const delta = GLYPH_DIAGRAM_DIRECTIONS[port.side];
    return { ...port, anchor, escape: { x: anchor.x + delta.x, y: anchor.y + delta.y } };
  }) };
}
