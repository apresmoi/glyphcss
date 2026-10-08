import type { GlyphCanvas } from "glyphcss";
import type { GlyphGraph } from "./types";
import type { GlyphDiagramLedgerEntry } from "./ledger";
import type { GlyphDiagramLayout, GlyphDiagramLayoutOptions } from "./pipeline";
import type { GlyphDiagramRoute } from "./route";
import type { GlyphDiagramPlacedLabel } from "./labels";
export type { GlyphDiagramLedgerEntry };
export type GlyphDiagramTarget = "chat" | "terminal" | "web";
export type GlyphDiagramCharset = "ascii" | "box" | "blocks" | "braille";
export type GlyphDiagramColorMode = "none" | "ansi16" | "ansi256" | "truecolor" | "css";
export type GlyphDiagramDetail = "auto" | "faithful" | "balanced" | "simplified";
export interface GlyphDiagramRenderOptions extends GlyphDiagramLayoutOptions {
  /** Allow a perpendicular orientation when the authored direction cannot fit. */
  readonly autoDirection?: boolean;
  /** Fixed-size pages by default; expand preserves a connected canvas for panning. */
  readonly overflow?: "paginate" | "expand";
  readonly target?: GlyphDiagramTarget; readonly charset?: GlyphDiagramCharset;
  readonly color?: GlyphDiagramColorMode; readonly width?: number; readonly height?: number;
  readonly detail?: GlyphDiagramDetail; readonly title?: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
  /**
   * Per-node override. Colours a node's own border/corners and its interior label text.
   * Additive only: with `color: "none"` (or omitted, `colored === false`)
   * this has no effect and the output stays byte-identical to before this
   * option existed. Shape, position and text already carry every node's
   * identity, so this never becomes the only way to tell two nodes apart.
   */
  readonly nodeColor?: string | ((node: GlyphDiagramLayout["nodes"][number]) => string);
  /**
   * Per-edge override, same shape, covering an edge's own route cells, its
   * target arrowhead, and its own label. Never affects group boundaries or
   * the title, and never affects `color: "none"` output.
   */
  readonly edgeColor?: string | ((edge: GlyphDiagramLayout["edges"][number]) => string);
}
export interface GlyphDiagramMeta { readonly nodes: GlyphGraph["nodes"]; readonly edges: GlyphGraph["edges"]; readonly groups: NonNullable<GlyphGraph["groups"]>; readonly description: string }
export interface GlyphDiagramReport { readonly ledger: readonly GlyphDiagramLedgerEntry[]; readonly unsupportedGlyphs: readonly string[]; readonly unroutable: readonly string[] }
export interface GlyphDiagramPage {
  readonly text: string; readonly html?: string;
  /** The canvas this page painted (Packet F1 — was `grid: GlyphCanvas["grid"]`); `canvas.grid` is the same `CellGrid` this field used to hold directly. */
  readonly canvas: GlyphCanvas;
  readonly layout: GlyphDiagramLayout; readonly routes: readonly GlyphDiagramRoute[]; readonly labels: readonly GlyphDiagramPlacedLabel[];
}
export interface GlyphDiagramResult extends GlyphDiagramPage {
  readonly meta: GlyphDiagramMeta; readonly report: GlyphDiagramReport;
  /** Every split panel, including the first. Text/HTML exits concatenate all panels; `canvas` is the first panel's. */
  readonly pages: readonly GlyphDiagramPage[];
}
