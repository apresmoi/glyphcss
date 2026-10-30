import { GlyphFluidImageTarget, type GlyphFluidImageSource, type GlyphFluidImageTargetOptions } from "./image";
import { GlyphFluidMeshTarget, type GlyphFluidMeshTargetOptions } from "./mesh";
import { GlyphFluidTextTarget, type GlyphFluidTextTargetOptions } from "./text";
import type { GlyphFluidRect, GlyphFluidTargetSpec } from "./types";

/** Target factories. Pass the result to `fluid.addTarget`. */
export const GlyphFluidTargets = {
  /** The element's own text, in its computed font, at its laid-out position. */
  text(el: HTMLElement, opts: GlyphFluidTextTargetOptions = {}): GlyphFluidTargetSpec {
    return { kind: "text", create: (ctx) => new GlyphFluidTextTarget(el, opts, ctx.fieldColor) };
  },
  /** An image over `rect` (an element's box, or a content-space rect in CSS px). */
  image(src: GlyphFluidImageSource, rect: HTMLElement | GlyphFluidRect, opts: GlyphFluidImageTargetOptions = {}): GlyphFluidTargetSpec {
    return { kind: "image", create: () => new GlyphFluidImageTarget(src, rect, opts) };
  },
  /** Polygons rasterised by glyphcss into the element's box, re-read every frame. */
  mesh(el: HTMLElement, opts: GlyphFluidMeshTargetOptions): GlyphFluidTargetSpec {
    return { kind: "mesh", create: () => new GlyphFluidMeshTarget(el, opts) };
  },
};
