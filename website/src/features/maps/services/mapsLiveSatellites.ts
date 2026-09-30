/**
 * The /maps page's SATELLITE row: CelesTrak's named `visual` group, fetched
 * ONCE, and then moved entirely in the reader's own browser.
 *
 * ## Why this row costs one request and the others cost one per refresh
 *
 * A two-line element set is not a position — it is an ORBIT, valid for days.
 * The motion a reader sees comes from propagating those elements to the
 * current instant (SGP4), which is arithmetic, not a network call. So the
 * only live thing about this row is the clock: the elements are read once
 * per session and the dots then move continuously at zero network cost.
 *
 * That is also exactly the behaviour CelesTrak ask for. Their objection is to
 * automated bulk polling, and a design that fetches once and propagates
 * locally honours it by construction rather than by throttling — which is why
 * this is the shape of the row, and why "re-fetch the elements every minute"
 * is not.
 *
 * ## Why the `visual` group and not `active`
 *
 * Measured: `GROUP=active` is 16,560 objects and 7.0 MB, and `GROUP=starlink`
 * alone is 11,131. A `circle` layer runs no declutter arbiter — every point
 * it is handed is drawn at every zoom — so at 1440x900 even one continent's
 * worth of that is a solid sheet of dots, not a layer. `visual` is CelesTrak's
 * own curated list of the ~157 brightest objects, i.e. the ones actually
 * visible from the ground, which is both a hundredth of the volume and a
 * better answer to "what is up there right now".
 *
 * ## satellite.js lives HERE, in the website
 *
 * `packages/*` gains no dependency from this. SGP4 is a real, fiddly
 * propagator (drag terms, deep-space corrections above 225 minutes of
 * period) and re-implementing it would be a worse version of a library that
 * already exists; but it is also entirely a PAGE concern, so it is a website
 * dependency exactly as `lil-gui` and `highlight.js` are.
 *
 * PINNED TO 6.x, and not by preference. satellite.js 7 ships a WebAssembly
 * accelerator whose Emscripten glue uses TOP-LEVEL AWAIT, and it is reachable
 * from the package's only entry point (`export * from './wasm/index.js'`), so
 * Astro's static build fails outright: `Module format "iife" does not support
 * top-level await`. The deep pure-JS modules are not exported (the package's
 * `exports` map declares `"."` alone), so there is no way to import past it.
 * 6.0.2 is the last pure-JS release, has the identical surface for everything
 * used here, and is what this row propagates with.
 */
import type { GlyphMapVectorFeature, GlyphMapVectorFeatureCollection } from "@glyphcss/maps";
import { degreesLat, degreesLong, eciToGeodetic, gstime, propagate, twoline2satrec } from "satellite.js";
import { MAP_LIVE_CELESTRAK_ATTRIBUTION } from "./mapsLive";

/**
 * How often the positions are recomputed, milliseconds.
 *
 * One second. A low-Earth satellite covers ~7.7 km/s, which at this page's
 * default world view is well under one cell, so a faster tick would redraw
 * the same picture; a slower one makes the motion read as stepping. Nothing
 * leaves the machine on a tick — it is ~157 SGP4 evaluations and one
 * `setLayerSource`, and every marker survives it as the same element
 * (`@glyphcss/maps`' point reconcile), so the cost is a `setAt` per dot.
 */
export const MAP_LIVE_SATELLITE_TICK_MS = 1000;

/** One object's element set, as CelesTrak's plain-text format carries it. */
export interface MapLiveTle {
  /** NORAD catalogue number, read off line 1 columns 3-7 — the identity across refreshes and across ticks. */
  readonly noradId: string;
  readonly name: string;
  readonly line1: string;
  readonly line2: string;
}

/**
 * CelesTrak's `FORMAT=tle` body: repeating groups of a 24-character name line
 * and the two element lines.
 *
 * Written against the vendored capture, not against the format's prose spec.
 * Two things that capture shows and a spec reading would miss: the name line
 * is PADDED to 24 characters (`"ATLAS CENTAUR 2         "`), so it has to be
 * trimmed; and the file is `\r\n`-terminated in transit, so a naive
 * `split("\n")` leaves a carriage return on the end of every line — which
 * survives into a satellite's name and into the checksum column of line 2.
 *
 * A group whose element lines do not start with `1 ` and `2 ` is skipped
 * rather than throwing: a truncated download is a shorter list, not a broken
 * row.
 */
export function parseMapLiveTles(text: string): readonly MapLiveTle[] {
  const lines = text.split(/\r?\n/).map((line) => line.trimEnd());
  const out: MapLiveTle[] = [];
  for (let i = 0; i + 2 < lines.length; i++) {
    const name = lines[i]?.trim() ?? "";
    const line1 = lines[i + 1] ?? "";
    const line2 = lines[i + 2] ?? "";
    if (!name || !line1.startsWith("1 ") || !line2.startsWith("2 ")) continue;
    const noradId = line1.slice(2, 7).trim();
    if (!noradId) continue;
    out.push({ noradId, name, line1, line2 });
    i += 2;
  }
  return out;
}

/**
 * Every object's sub-satellite point at one instant.
 *
 * `propagate` answers `false`-ish or a non-finite vector for an element set
 * it cannot advance (a decayed object, an epoch too far behind, a deep-space
 * case outside its model), and `twoline2satrec` records a parse failure on
 * the record itself. Both are DROPPED, per object: one bad element set among
 * a hundred and fifty is one missing dot, never a failed layer.
 *
 * `id` is the NORAD catalogue number, so a tick RECONCILES — the same object
 * keeps the same marker element and simply moves (`handle.setAt`), which is
 * the whole reason a one-second tick is affordable at all.
 */
export function mapLiveSatelliteFeatures(tles: readonly MapLiveTle[], at: Date): GlyphMapVectorFeatureCollection {
  const gmst = gstime(at);
  const features: GlyphMapVectorFeature[] = [];
  for (const tle of tles) {
    let lon: number;
    let lat: number;
    let altKm: number;
    try {
      const rec = twoline2satrec(tle.line1, tle.line2);
      if (rec.error) continue;
      const state = propagate(rec, at);
      const position = state && typeof state === "object" ? (state as { position?: unknown }).position : null;
      if (!position || typeof position !== "object") continue;
      const geodetic = eciToGeodetic(position as never, gmst);
      lon = degreesLong(geodetic.longitude);
      lat = degreesLat(geodetic.latitude);
      altKm = geodetic.height;
    } catch {
      continue;
    }
    if (!Number.isFinite(lon) || !Number.isFinite(lat) || lat < -90 || lat > 90) continue;
    features.push({
      id: `sat-${tle.noradId}`,
      geometryType: "point",
      properties: {
        title: tle.name,
        norad: tle.noradId,
        altKm: Number.isFinite(altKm) ? Math.round(altKm) : null,
      },
      rings: [[[lon, lat]]],
    });
  }
  return { features, attribution: MAP_LIVE_CELESTRAK_ATTRIBUTION };
}
