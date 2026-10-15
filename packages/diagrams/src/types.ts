export type GlyphGraphDirection = "TB" | "LR" | "BT" | "RL";
export type GlyphGraphNodeShape = "rect" | "rounded" | "diamond" | "circle" | "subroutine" | "asymmetric" | "stadium" | "cylinder" | "point" | "compartment";
export type GlyphGraphEdgeStyle = "solid" | "dotted" | "thick" | "undirected";

export interface GlyphGraphNode {
  readonly id: string;
  readonly label: string;
  readonly kind?: string;
  readonly group?: string;
  readonly shape?: GlyphGraphNodeShape;
  /** Member rows below the header, separated by rules; only for compartment nodes. */
  readonly compartments?: readonly (readonly string[])[];
}

export type GlyphGraphEdgeHead = "arrow" | "circle" | "cross" | "none" | "triangle" | "filled-diamond" | "open-diamond" | "er-one" | "er-zero-one" | "er-many" | "er-zero-many";

export interface GlyphGraphEdge {
  readonly id?: string;
  readonly from: string;
  readonly to: string;
  readonly label?: string;
  readonly style?: GlyphGraphEdgeStyle;
  readonly priority?: number;
  readonly startHead?: GlyphGraphEdgeHead;
  readonly endHead?: GlyphGraphEdgeHead;
  /** Participates in layout without reserving or painting a route. */
  readonly invisible?: boolean;
}

export interface GlyphGraphGroup {
  readonly id: string;
  readonly label?: string;
  readonly members: readonly string[];
  /** The group this one is drawn inside. Needed only when both list the same nodes; otherwise the smallest group holding all of this one's members is its parent. */
  readonly parent?: string;
}

export interface GlyphGraph {
  readonly nodes: readonly GlyphGraphNode[];
  readonly edges: readonly GlyphGraphEdge[];
  readonly groups?: readonly GlyphGraphGroup[];
  readonly direction: GlyphGraphDirection;
}
