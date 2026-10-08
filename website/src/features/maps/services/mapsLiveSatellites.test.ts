/**
 * The satellite row, against the real vendored CelesTrak `visual` capture.
 *
 * Two properties carry the row and both are pinned here: the elements parse
 * into a keyed object list (so a tick reconciles rather than rebuilding), and
 * propagating them produces sub-satellite points that MOVE — which is what
 * makes this the only genuinely moving layer on the page, and the only one
 * that costs nothing per frame.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MAP_LIVE_SATELLITE_TICK_MS, mapLiveSatelliteFeatures, parseMapLiveTles } from "./mapsLiveSatellites";

const CAPTURE = JSON.parse(
  readFileSync(path.resolve(__dirname, "fixtures/live/celestrak-visual-tle.json"), "utf8"),
) as { readonly url: string; readonly text: string };

/**
 * A fixed instant, inside the capture's own epoch window (the elements were
 * recorded at day 253.5 of 2026). SGP4 accuracy degrades away from epoch, and
 * a test propagating a recorded element set to `Date.now()` would drift a
 * little further out of the model every day it is run.
 */
const AT = new Date("2026-09-10T22:00:00Z");

describe("CelesTrak element sets", () => {
  it("parses the real capture into keyed objects", () => {
    const tles = parseMapLiveTles(CAPTURE.text);
    expect(tles.length).toBeGreaterThan(100);
    // Three lines per object, exactly.
    expect(tles.length).toBe(CAPTURE.text.trim().split(/\r?\n/).length / 3);
    expect(new Set(tles.map((t) => t.noradId)).size).toBe(tles.length);
    // The name line is PADDED to 24 characters in the wire format.
    expect(tles.every((t) => t.name === t.name.trim() && t.name.length > 0)).toBe(true);
    expect(tles[0]!.name).toBe("ATLAS CENTAUR 2");
    expect(tles[0]!.noradId).toBe("00694");
    expect(tles.every((t) => t.line1.startsWith("1 ") && t.line2.startsWith("2 "))).toBe(true);
  });

  it("survives a truncated download as a shorter list, never as a throw", () => {
    const whole = parseMapLiveTles(CAPTURE.text);
    const cut = CAPTURE.text.split(/\r?\n/).slice(0, 10).join("\n");
    const partial = parseMapLiveTles(cut);
    expect(partial.length).toBe(3);
    expect(partial.length).toBeLessThan(whole.length);
    expect(parseMapLiveTles("")).toEqual([]);
    expect(parseMapLiveTles("garbage\nmore garbage\n")).toEqual([]);
  });

  it("handles CRLF, which is what the service actually sends", () => {
    const crlf = CAPTURE.text.split("\n").join("\r\n");
    const tles = parseMapLiveTles(crlf);
    expect(tles.length).toBe(parseMapLiveTles(CAPTURE.text).length);
    // A stray carriage return would land in the checksum column of line 2 and
    // in the object's own name.
    expect(tles.some((t) => t.name.includes("\r") || t.line2.includes("\r"))).toBe(false);
  });
});

describe("propagation", () => {
  it("puts every object at a real sub-satellite point, keyed by NORAD id", () => {
    const collection = mapLiveSatelliteFeatures(parseMapLiveTles(CAPTURE.text), AT);
    const features = collection.features;
    expect(features.length).toBeGreaterThan(100);
    expect(new Set(features.map((f) => f.id)).size).toBe(features.length);
    expect(features.every((f) => f.id!.startsWith("sat-"))).toBe(true);
    for (const feature of features) {
      const [lon, lat] = feature.rings[0]![0]!;
      expect(Number.isFinite(lon)).toBe(true);
      expect(lat).toBeGreaterThanOrEqual(-90);
      expect(lat).toBeLessThanOrEqual(90);
    }
    expect(collection.attribution?.[0]?.name).toContain("Kelso");
  });

  it("moves them: one tick apart is a different set of positions, same set of objects", () => {
    const tles = parseMapLiveTles(CAPTURE.text);
    const before = mapLiveSatelliteFeatures(tles, AT);
    const after = mapLiveSatelliteFeatures(tles, new Date(AT.getTime() + MAP_LIVE_SATELLITE_TICK_MS * 60));
    // The IDENTITY set is unchanged — which is what makes a tick a reconcile
    // (every marker survives and moves) rather than a rebuild.
    expect(after.features.map((f) => f.id)).toEqual(before.features.map((f) => f.id));
    const moved = after.features.filter((f, i) => {
      const a = before.features[i]!.rings[0]![0]!;
      const b = f.rings[0]![0]!;
      return a[0] !== b[0] || a[1] !== b[1];
    });
    // Everything in orbit moves in a minute; nothing here is stationary.
    expect(moved.length).toBe(before.features.length);
  });

  it("drops one unusable element set without losing the rest", () => {
    const tles = parseMapLiveTles(CAPTURE.text);
    const poisoned = [
      { noradId: "99999", name: "NONSENSE", line1: `1 99999U 00000A   ${"x".repeat(50)}`, line2: `2 99999 ${"x".repeat(60)}` },
      ...tles.slice(0, 5),
    ];
    const collection = mapLiveSatelliteFeatures(poisoned, AT);
    expect(collection.features.some((f) => f.id === "sat-99999")).toBe(false);
    expect(collection.features.length).toBe(5);
  });

  it("costs nothing on the network: propagation takes elements and an instant, and nothing else", () => {
    // The signature IS the guarantee — there is no transport in this module
    // at all, so a tick cannot reach a service even by accident.
    expect(mapLiveSatelliteFeatures.length).toBe(2);
    expect(MAP_LIVE_SATELLITE_TICK_MS).toBe(1000);
  });
});
