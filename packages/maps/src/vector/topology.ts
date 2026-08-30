/**
 * A minimal TopoJSON reader — decode + geometry resolution only (no writer,
 * no CLI). `@glyphcss/maps` builds its own tiles at bake time (`vector/
 * tile.ts`) rather than shipping TopoJSON topology to the browser, so this
 * module's only job is turning a Natural-Earth-shaped `.json` (e.g.
 * `world-atlas`'s `countries-*.json`) into { arcs, features } this package's
 * own pipeline (`vector/simplify.ts`, `vector/clip.ts`) can operate on.
 *
 * Deliberately supports only what admin boundary / river / route data
 * needs: `Polygon`, `MultiPolygon`, `LineString`, `MultiLineString`, and
 * `GeometryCollection` wrapping them. `Point`/`MultiPoint` (for a future
 * `symbol`/`circle` layer, slice 6) are not resolved here.
 */
import type { GlyphMapVectorFeature } from "./types";
import type { GlyphMapLonLat } from "./simplify";

export interface TopoJsonTransform {
  readonly scale: readonly [number, number];
  readonly translate: readonly [number, number];
}

interface TopoJsonGeometryBase {
  readonly type: string;
  readonly id?: string | number;
  readonly properties?: Readonly<Record<string, unknown>>;
}

interface TopoJsonPolygon extends TopoJsonGeometryBase {
  readonly type: "Polygon";
  readonly arcs: readonly (readonly number[])[];
}

interface TopoJsonMultiPolygon extends TopoJsonGeometryBase {
  readonly type: "MultiPolygon";
  readonly arcs: readonly (readonly (readonly number[])[])[];
}

interface TopoJsonLineString extends TopoJsonGeometryBase {
  readonly type: "LineString";
  readonly arcs: readonly number[];
}

interface TopoJsonMultiLineString extends TopoJsonGeometryBase {
  readonly type: "MultiLineString";
  readonly arcs: readonly (readonly number[])[];
}

interface TopoJsonGeometryCollection extends TopoJsonGeometryBase {
  readonly type: "GeometryCollection";
  readonly geometries: readonly TopoJsonGeometry[];
}

export type TopoJsonGeometry =
  | TopoJsonPolygon
  | TopoJsonMultiPolygon
  | TopoJsonLineString
  | TopoJsonMultiLineString
  | TopoJsonGeometryCollection
  | TopoJsonGeometryBase; // Point/MultiPoint/other — carried but not resolved

export interface TopoJsonTopology {
  readonly type: "Topology";
  readonly transform?: TopoJsonTransform;
  readonly arcs: readonly (readonly (readonly number[])[])[];
  readonly objects: Readonly<Record<string, TopoJsonGeometry>>;
}

/**
 * Decode every arc to absolute lon/lat. TopoJSON arcs are delta-encoded
 * (each point is the SUM of the previous point's coordinates) and, when
 * `transform` is present, additionally quantized integers needing
 * `scale`/`translate` to recover real units — both true of every
 * `world-atlas`/`mapshaper`-produced file this package targets.
 */
export function decodeGlyphMapTopoJsonArcs(topology: TopoJsonTopology): GlyphMapLonLat[][] {
  const { arcs, transform } = topology;
  if (!transform) {
    return arcs.map((arc) => arc.map((p) => [p[0], p[1]] as GlyphMapLonLat));
  }
  const [sx, sy] = transform.scale;
  const [tx, ty] = transform.translate;
  return arcs.map((arc) => {
    let x = 0;
    let y = 0;
    const out: GlyphMapLonLat[] = [];
    for (const [dx, dy] of arc) {
      x += dx;
      y += dy;
      out.push([x * sx + tx, y * sy + ty]);
    }
    return out;
  });
}

/**
 * Resolve one ring's arc-index list to a coordinate ring. Negative index `i`
 * means "arc `~i`, reversed" (TopoJSON's own convention — `~i` is
 * `-i - 1`, the standard bitwise-NOT trick so index `0` can still be
 * negated unambiguously as `-1`). Consecutive arcs share an endpoint (the
 * topology's whole point), so every arc after the first drops its own first
 * point.
 */
function resolveRing(indices: readonly number[], decodedArcs: readonly GlyphMapLonLat[][]): GlyphMapLonLat[] {
  const coords: GlyphMapLonLat[] = [];
  for (let k = 0; k < indices.length; k++) {
    const idx = indices[k];
    const i = idx < 0 ? ~idx : idx;
    const arc = decodedArcs[i];
    const seq = idx < 0 ? [...arc].reverse() : arc;
    const start = k > 0 ? 1 : 0;
    for (let j = start; j < seq.length; j++) coords.push(seq[j]);
  }
  return coords;
}

function pushGeometry(
  geom: TopoJsonGeometry,
  decodedArcs: readonly GlyphMapLonLat[][],
  out: GlyphMapVectorFeature[],
): void {
  switch (geom.type) {
    case "Polygon": {
      const p = geom as TopoJsonPolygon;
      out.push({
        id: p.id !== undefined ? String(p.id) : undefined,
        properties: p.properties,
        rings: p.arcs.map((ring) => resolveRing(ring, decodedArcs)),
      });
      return;
    }
    case "MultiPolygon": {
      const mp = geom as TopoJsonMultiPolygon;
      const rings: GlyphMapLonLat[][] = [];
      for (const poly of mp.arcs) for (const ring of poly) rings.push(resolveRing(ring, decodedArcs));
      out.push({ id: mp.id !== undefined ? String(mp.id) : undefined, properties: mp.properties, rings });
      return;
    }
    case "LineString": {
      const ls = geom as TopoJsonLineString;
      out.push({
        id: ls.id !== undefined ? String(ls.id) : undefined,
        properties: ls.properties,
        rings: [resolveRing(ls.arcs, decodedArcs)],
      });
      return;
    }
    case "MultiLineString": {
      const mls = geom as TopoJsonMultiLineString;
      out.push({
        id: mls.id !== undefined ? String(mls.id) : undefined,
        properties: mls.properties,
        rings: mls.arcs.map((line) => resolveRing(line, decodedArcs)),
      });
      return;
    }
    case "GeometryCollection": {
      const gc = geom as TopoJsonGeometryCollection;
      for (const g of gc.geometries) pushGeometry(g, decodedArcs, out);
      return;
    }
    default:
      // Point/MultiPoint/unrecognized — not resolved by this module.
      return;
  }
}

/** Resolve every feature in `topology.objects[objectName]` to `GlyphMapVectorFeature`s, using ALREADY-DECODED (and optionally already-simplified) arcs. */
export function glyphMapTopoJsonFeatures(
  topology: TopoJsonTopology,
  objectName: string,
  decodedArcs: readonly GlyphMapLonLat[][],
): GlyphMapVectorFeature[] {
  const object = topology.objects[objectName];
  if (!object) throw new RangeError(`glyphcss/maps: TopoJSON object "${objectName}" not found.`);
  const out: GlyphMapVectorFeature[] = [];
  pushGeometry(object, decodedArcs, out);
  return out;
}
