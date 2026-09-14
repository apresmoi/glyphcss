export type GlyphGraphDirection = "TB" | "LR" | "BT" | "RL";
export type GlyphGraphNodeShape = "rect" | "rounded" | "diamond" | "circle" | "subroutine" | "asymmetric" | "stadium" | "cylinder";
export type GlyphGraphEdgeStyle = "solid" | "dotted" | "thick" | "undirected";

export interface GlyphGraphNode {
  readonly id: string;
  readonly label: string;
  readonly kind?: string;
  readonly group?: string;
  readonly shape?: GlyphGraphNodeShape;
  /**
   * D2 round 3 — architecture objects: an explicit `[width, height, depth]`
   * in WORLD units (the SAME units the 3D layout already treats as roughly
   * one output cell — AGENTS.md's Diagrams 3D contract), JSON-only (Mermaid
   * has no syntax for it, so a Mermaid-sourced graph never sets this).
   * Lets a per-layer-sized diagram (a CNN's activation maps, a differently
   * sized agent tier) draw each node at its own true relative scale instead
   * of every node sharing one label-derived default. Absent (every
   * pre-existing graph, including every Mermaid one) falls back to that
   * default, byte-identical to before this field existed. Read only by
   * `@glyphcss/diagrams/3d`'s `layout3d` — the 2D pipeline never reads it.
   */
  readonly size?: readonly [number, number, number];
}

export interface GlyphGraphEdge {
  readonly id?: string;
  readonly from: string;
  readonly to: string;
  readonly label?: string;
  readonly style?: GlyphGraphEdgeStyle;
  readonly priority?: number;
}

export interface GlyphGraphGroup {
  readonly id: string;
  readonly label?: string;
  readonly members: readonly string[];
}

export interface GlyphGraph {
  readonly nodes: readonly GlyphGraphNode[];
  readonly edges: readonly GlyphGraphEdge[];
  readonly groups?: readonly GlyphGraphGroup[];
  readonly direction: GlyphGraphDirection;
}
