import type { GlyphFluidTargetFrame } from "./frame";

/** The fluid's cell lattice in CSS px, as targets see it at measure time. */
export interface GlyphFluidLayout {
  /** Cell width / height in CSS px. */
  cw: number;
  ch: number;
  /** Client-px position of content cell (0, 0). */
  originX: number;
  originY: number;
}

/** A rectangle in the fluid's content space (CSS px from the content origin). */
export interface GlyphFluidRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A target's cell box in content cells. */
export interface GlyphFluidCellBox {
  i0: number;
  j0: number;
  w: number;
  h: number;
}

/** When a target is shown. */
export interface GlyphFluidTargetOptions {
  /** Seconds after the fluid starts before the target first condenses. Default 0. */
  delay?: number;
  /**
   * `"always"` (default) or `"viewport"`: shown only while its middle is between 7 % and
   * 95 % of the viewport height, so scrolling a heading in and out condenses and melts it.
   */
  visibility?: "always" | "viewport";
}

/** What `GlyphFluidTargets.*` return; `fluid.addTarget` turns it into a live target. */
export interface GlyphFluidTargetSpec {
  readonly kind: "text" | "image" | "mesh";
  /** Internal: builds the live target. */
  readonly create: (ctx: { fieldColor: () => [number, number, number] }) => GlyphFluidTargetImpl;
}

/** Internal contract every target kind implements. */
export interface GlyphFluidTargetImpl {
  readonly options: Required<GlyphFluidTargetOptions>;
  /** Kick strength when it condenses / melts. */
  readonly strengthOn: number;
  readonly strengthOff: number;
  /** Re-measure against a (new) layout; DOM reads happen here, never per frame. */
  measure(layout: GlyphFluidLayout): void;
  /** Cell box in content cells, or null before the first measure. */
  box(): GlyphFluidCellBox | null;
  /** Per-frame update (animated targets rasterise here). */
  update(dt: number): void;
  /** Max-merge into the frame; `r0` is the content row at frame row 0. */
  write(frame: GlyphFluidTargetFrame, r0: number, swell: number): void;
  dispose(): void;
}

export function resolveTargetOptions(o: GlyphFluidTargetOptions | undefined): Required<GlyphFluidTargetOptions> {
  return { delay: o?.delay ?? 0, visibility: o?.visibility ?? "always" };
}

/** Content-space rect of an element (client rect minus the layout origin). */
export function elementRect(el: Element, layout: GlyphFluidLayout): GlyphFluidRect {
  const r = el.getBoundingClientRect();
  return { x: r.left - layout.originX, y: r.top - layout.originY, width: r.width, height: r.height };
}

/** `#rrggbb` → 0..1 channels; throws on anything else (colours are validated at the API edge). */
export function parseHexColor(c: string, what: string): [number, number, number] {
  if (!/^#[\da-f]{6}$/i.test(c)) throw new TypeError(`@glyphcss/fluid: ${what} must be a #rrggbb colour (got ${JSON.stringify(c)}).`);
  return [parseInt(c.slice(1, 3), 16) / 255, parseInt(c.slice(3, 5), 16) / 255, parseInt(c.slice(5, 7), 16) / 255];
}
