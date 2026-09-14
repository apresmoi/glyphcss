export type GlyphGraphDirection = "TB" | "LR" | "BT" | "RL";
export type GlyphGraphNodeShape = "rect" | "rounded" | "diamond" | "circle" | "subroutine" | "asymmetric" | "stadium";
export type GlyphGraphEdgeStyle = "solid" | "dotted" | "thick" | "undirected";

export interface GlyphGraphNode {
  readonly id: string;
  readonly label: string;
  readonly kind?: string;
  readonly group?: string;
  readonly shape?: GlyphGraphNodeShape;
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
