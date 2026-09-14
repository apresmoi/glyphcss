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
  readonly target?: GlyphDiagramTarget; readonly charset?: GlyphDiagramCharset;
  readonly color?: GlyphDiagramColorMode; readonly width?: number; readonly height?: number;
  readonly detail?: GlyphDiagramDetail; readonly title?: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
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
  /** Every split panel, including the first. Text/HTML exits concatenate all panels; grid is the first panel. */
  readonly pages: readonly GlyphDiagramPage[];
}
