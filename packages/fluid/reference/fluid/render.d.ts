// Types for the vendored reference renderer (tests only; never shipped).
export class GlyphRenderer {
  constructor(canvas: { getContext(kind: string): unknown });
  scale: number;
  draw(sim: unknown, opt: Record<string, unknown>): number;
}
