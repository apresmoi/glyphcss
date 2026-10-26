// DOM text → ink: the element's own text, drawn with its computed font into a canvas at
// 2× and area-averaged onto the cell lattice. The element stays in the page (usually
// `color: transparent`) so its box keeps driving layout, selection and accessibility.
import { glyphFluidCoverageFromAlpha, mergeGlyphFluidCells } from "./raster";
import { elementRect, parseHexColor, resolveTargetOptions, type GlyphFluidCellBox, type GlyphFluidLayout, type GlyphFluidTargetImpl, type GlyphFluidTargetOptions } from "./types";
import type { GlyphFluidTargetFrame } from "./frame";

export interface GlyphFluidTextTargetOptions extends GlyphFluidTargetOptions {
  /** Ink colour, `#rrggbb`. Default: the fluid's field colour. */
  color?: string;
}

const SUPERSAMPLE = 2;

export class GlyphFluidTextTarget implements GlyphFluidTargetImpl {
  readonly options;
  readonly strengthOn = 0.5;
  readonly strengthOff = 0.9;
  private cellBox: GlyphFluidCellBox | null = null;
  private cov: Float32Array = new Float32Array(0);
  private rgb: [number, number, number] | null;

  constructor(private el: HTMLElement, opts: GlyphFluidTextTargetOptions = {}, private fieldColor: () => [number, number, number]) {
    this.options = resolveTargetOptions(opts);
    this.rgb = opts.color === undefined ? null : parseHexColor(opts.color, "text target color");
  }

  measure(layout: GlyphFluidLayout): void {
    const { cw, ch } = layout;
    const r = elementRect(this.el, layout);
    const i0 = Math.floor(r.x / cw),
      j0 = Math.floor(r.y / ch);
    const w = Math.max(1, Math.ceil((r.x + r.width) / cw) - i0),
      h = Math.max(1, Math.ceil((r.y + r.height) / ch) - j0);
    this.cellBox = { i0, j0, w, h };
    const cv = document.createElement("canvas");
    cv.width = Math.ceil(w * cw * SUPERSAMPLE);
    cv.height = Math.ceil(h * ch * SUPERSAMPLE);
    const g = cv.getContext("2d", { willReadFrequently: true });
    if (!g) {
      this.cov = new Float32Array(w * h);
      return;
    }
    const cs = getComputedStyle(this.el);
    g.scale(SUPERSAMPLE, SUPERSAMPLE);
    g.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    if ("letterSpacing" in g) (g as { letterSpacing: string }).letterSpacing = cs.letterSpacing;
    g.textBaseline = "alphabetic";
    g.fillStyle = "#fff";
    const text = this.el.textContent ?? "";
    const m = g.measureText(text);
    const asc = m.fontBoundingBoxAscent,
      desc = m.fontBoundingBoxDescent;
    const padL = parseFloat(cs.paddingLeft) || 0;
    g.fillText(text, r.x - i0 * cw + padL, r.y - j0 * ch + (r.height - (asc + desc)) / 2 + asc);
    const img = g.getImageData(0, 0, cv.width, cv.height);
    this.cov = glyphFluidCoverageFromAlpha(img.data, cv.width, cv.height, w, h, cw, ch, SUPERSAMPLE);
  }

  box(): GlyphFluidCellBox | null {
    return this.cellBox;
  }

  update(): void {}

  write(frame: GlyphFluidTargetFrame, r0: number): void {
    if (!this.cellBox) return;
    const [r, g, b] = this.rgb ?? this.fieldColor();
    mergeGlyphFluidCells(frame, this.cellBox, r0, 0, this.cov, r, g, b);
  }

  dispose(): void {}
}
