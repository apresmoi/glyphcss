// An image → ink + colour: area-averaged onto the cells under `rect`. Bright, opaque
// pixels pull the most ink (a floor-lifted shading curve); colour is the pixel colour.
import { glyphFluidImageCells, glyphFluidShadeInk, mergeGlyphFluidCells, type GlyphFluidImageCells } from "./raster";
import { elementRect, resolveTargetOptions, type GlyphFluidCellBox, type GlyphFluidLayout, type GlyphFluidRect, type GlyphFluidTargetImpl, type GlyphFluidTargetOptions } from "./types";
import type { GlyphFluidTargetFrame } from "./frame";

/** Anything a 2D canvas can draw, or raw pixels. */
export type GlyphFluidImageSource = CanvasImageSource | ImageData;

export interface GlyphFluidImageTargetOptions extends GlyphFluidTargetOptions {
  /** `"luminance"` (default): ink follows brightness × alpha. `"alpha"`: ink is coverage alone. */
  ink?: "luminance" | "alpha";
}

export class GlyphFluidImageTarget implements GlyphFluidTargetImpl {
  readonly options;
  readonly strengthOn = 0.6;
  readonly strengthOff = 0.8;
  private cellBox: GlyphFluidCellBox | null = null;
  private ink = new Float32Array(0);
  private cells: GlyphFluidImageCells | null = null;
  private inkMode: "luminance" | "alpha";

  constructor(
    private src: GlyphFluidImageSource,
    private rect: HTMLElement | GlyphFluidRect,
    opts: GlyphFluidImageTargetOptions = {},
  ) {
    this.options = resolveTargetOptions(opts);
    this.inkMode = opts.ink ?? "luminance";
  }

  measure(layout: GlyphFluidLayout): void {
    const { cw, ch } = layout;
    const r = "getBoundingClientRect" in this.rect ? elementRect(this.rect, layout) : this.rect;
    const i0 = Math.round(r.x / cw),
      j0 = Math.round(r.y / ch);
    const w = Math.max(1, Math.round((r.x + r.width) / cw) - i0),
      h = Math.max(1, Math.round((r.y + r.height) / ch) - j0);
    this.cellBox = { i0, j0, w, h };
    const px = this.pixels(w, h);
    const cells = (this.cells = px ? glyphFluidImageCells(px.data, px.width, px.height, w, h) : null);
    this.ink = new Float32Array(w * h);
    if (cells)
      for (let k = 0; k < w * h; k++)
        this.ink[k] = this.inkMode === "alpha" ? cells.cov[k]! : glyphFluidShadeInk(cells.cov[k]!, cells.lum[k]!);
  }

  /** Raw pixels as given, or the source drawn at 4×4 px per cell. */
  private pixels(w: number, h: number): ImageData | null {
    // duck-typed: `ImageData` is not a global everywhere (happy-dom, some SSR shims)
    if ("data" in this.src && "width" in this.src) return this.src as ImageData;
    const cv = document.createElement("canvas");
    cv.width = w * 4;
    cv.height = h * 4;
    const g = cv.getContext("2d", { willReadFrequently: true });
    if (!g) return null;
    g.drawImage(this.src as CanvasImageSource, 0, 0, cv.width, cv.height);
    return g.getImageData(0, 0, cv.width, cv.height);
  }

  box(): GlyphFluidCellBox | null {
    return this.cellBox;
  }

  update(): void {}

  write(frame: GlyphFluidTargetFrame, r0: number): void {
    if (!this.cellBox || !this.cells) return;
    mergeGlyphFluidCells(frame, this.cellBox, r0, 0, this.ink, this.cells.r, this.cells.g, this.cells.b);
  }

  dispose(): void {}
}
