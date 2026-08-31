import type { Polygon, Vec3 } from "glyphcss";
import type { GlyphMapBounds, GlyphMapField } from "./types";
import type { GlyphMapProjection } from "./projection";
import type { GlyphMapVectorFeature } from "./vector/types";

export interface GlyphMapLabelCandidate { readonly id: string; readonly col: number; readonly row: number; readonly label: string; readonly priority: number }

/** Greedy, stable label declutter: priority descending, then input order. */
export function glyphMapDeclutterLabels(candidates: readonly GlyphMapLabelCandidate[], charWidth = 1, height = 1): readonly GlyphMapLabelCandidate[] {
  const placed: { x: number; y: number; w: number; h: number }[] = [];
  const out: GlyphMapLabelCandidate[] = [];
  for (const candidate of candidates.map((value, index) => ({ value, index })).sort((a, b) => b.value.priority - a.value.priority || a.index - b.index)) {
    const c = candidate.value;
    const w = Math.max(charWidth, c.label.length * charWidth);
    const box = { x: c.col - w / 2, y: c.row - height / 2, w, h: height };
    if (placed.some((p) => !(box.x + box.w <= p.x || box.x >= p.x + p.w || box.y + box.h <= p.y || box.y >= p.y + p.h))) continue;
    placed.push(box);
    out.push(c);
  }
  return out;
}

export function glyphMapPointHeatmap(features: readonly GlyphMapVectorFeature[], bounds: GlyphMapBounds, cols: number, rows: number, radius = 2, weightProperty?: string): GlyphMapField {
  if (!(cols > 0 && rows > 0 && radius >= 0)) throw new RangeError("glyphcss/maps: invalid heatmap dimensions or radius.");
  const values = new Float32Array(cols * rows);
  const sigma2 = Math.max(0.25, radius * radius / 2);
  for (const feature of features) for (const ring of feature.rings) for (const [lon, lat] of ring) {
    const cx = (lon - bounds.west) / (bounds.east - bounds.west) * cols;
    const cy = (bounds.north - lat) / (bounds.north - bounds.south) * rows;
    const weight = weightProperty ? Number(feature.properties?.[weightProperty] ?? 0) : 1;
    if (!Number.isFinite(weight)) continue;
    const reach = Math.ceil(radius * 2);
    for (let y = Math.max(0, Math.floor(cy - reach)); y < Math.min(rows, Math.ceil(cy + reach)); y++) for (let x = Math.max(0, Math.floor(cx - reach)); x < Math.min(cols, Math.ceil(cx + reach)); x++) {
      const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
      values[y * cols + x] += weight * Math.exp(-(dx * dx + dy * dy) / (2 * sigma2));
    }
  }
  let max = 0;
  for (const value of values) max = Math.max(max, value);
  return { bounds, cols, rows, values, noData: new Uint8Array(values.length), kind: "continuous", min: 0, max };
}

function finite(v: Vec3): boolean { return v.every(Number.isFinite); }

/** Convert grouped vector polygons to ordinary glyphcss faces; optional height adds roof and wall faces. */
export function glyphMapVectorPolygons(features: readonly GlyphMapVectorFeature[], projection: GlyphMapProjection, options: {
  readonly color?: (feature: GlyphMapVectorFeature) => string | undefined;
  readonly height?: (feature: GlyphMapVectorFeature) => number;
  readonly base?: (feature: GlyphMapVectorFeature) => number;
} = {}): Polygon[] {
  const out: Polygon[] = [];
  for (const feature of features) {
    const groups = feature.polygons ?? feature.rings.map((ring) => [ring]);
    for (const group of groups) {
      const outer = group[0];
      if (!outer || outer.length < 3) continue;
      const ring = outer.length > 3 && outer[0][0] === outer.at(-1)![0] && outer[0][1] === outer.at(-1)![1] ? outer.slice(0, -1) : outer;
      const base = options.base?.(feature) ?? 0;
      const height = options.height?.(feature) ?? 0;
      const bottom = ring.map(([lon, lat]) => projection.project(lon, lat, base));
      const top = ring.map(([lon, lat]) => projection.project(lon, lat, base + height));
      if (bottom.some((v) => !finite(v)) || top.some((v) => !finite(v))) continue;
      const color = options.color?.(feature);
      const roof: Polygon = { vertices: top as Vec3[] };
      if (color) roof.color = color;
      out.push(roof);
      if (height > 0) for (let i = 0; i < ring.length; i++) {
        const j = (i + 1) % ring.length;
        const wall: Polygon = { vertices: [bottom[i], bottom[j], top[j], top[i]] as Vec3[] };
        if (color) wall.color = color;
        out.push(wall);
      }
    }
  }
  return out;
}
