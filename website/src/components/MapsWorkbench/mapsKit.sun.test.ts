import { describe, expect, it } from "vitest";
import { glyphMapGlobe, glyphMapSubsolarPoint, glyphMapSunDirection } from "@glyphcss/maps";
import { buildMapLighting, DEFAULT_MAP_LIGHTING, isOrbitProjectionId, mapDirectionLocked, mapKeyLightForSunMode, mapSunManualFields, mapSunManualInstant, SUN_MODE_TOGGLE, type MapProjectionId, type MapSunMode } from "./mapsKit";

/**
 * The page's half of real-sun lighting: `buildMapLighting` is the ONE writer
 * of the scene's `directionalLight`, so which direction it picks is what
 * decides whether the sliders or the sun are aiming the key light.
 */
describe("buildMapLighting — sun direction override", () => {
  it("uses azimuth/elevation when no sun direction is supplied (the default)", () => {
    const before = buildMapLighting(DEFAULT_MAP_LIGHTING);
    const withNull = buildMapLighting(DEFAULT_MAP_LIGHTING, null);
    const withUndefined = buildMapLighting(DEFAULT_MAP_LIGHTING, undefined);
    expect(withNull).toEqual(before);
    expect(withUndefined).toEqual(before);

    // The pre-sun formula exactly.
    const a = (DEFAULT_MAP_LIGHTING.lightAzimuth * Math.PI) / 180;
    const e = (DEFAULT_MAP_LIGHTING.lightElevation * Math.PI) / 180;
    expect(before.directionalLight.direction[0]).toBeCloseTo(Math.cos(e) * Math.cos(a), 12);
    expect(before.directionalLight.direction[1]).toBeCloseTo(Math.cos(e) * Math.sin(a), 12);
    expect(before.directionalLight.direction[2]).toBeCloseTo(Math.sin(e), 12);
  });

  it("takes the sun's direction when one is supplied, keeping intensity/colour and ambient", () => {
    const globe = glyphMapGlobe({ radius: 1, exaggeration: 0 });
    const at = Date.UTC(2024, 5, 21, 12, 0, 0);
    const dir = glyphMapSunDirection(globe, at)!;
    const built = buildMapLighting(DEFAULT_MAP_LIGHTING, dir);

    expect(built.directionalLight.direction).toEqual([dir[0], dir[1], dir[2]]);
    expect(built.directionalLight.intensity).toBe(DEFAULT_MAP_LIGHTING.lightIntensity);
    expect(built.directionalLight.color).toBe(DEFAULT_MAP_LIGHTING.lightColor);
    expect(built.ambientLight).toEqual({
      intensity: DEFAULT_MAP_LIGHTING.ambientIntensity,
      color: DEFAULT_MAP_LIGHTING.ambientColor,
    });
  });

  it("a direction one hour later is a genuinely different key light", () => {
    const globe = glyphMapGlobe({ radius: 1, exaggeration: 0 });
    const t0 = Date.UTC(2024, 5, 21, 12, 0, 0);
    const a = buildMapLighting(DEFAULT_MAP_LIGHTING, glyphMapSunDirection(globe, t0)).directionalLight.direction;
    const b = buildMapLighting(DEFAULT_MAP_LIGHTING, glyphMapSunDirection(globe, t0 + 3_600_000)).directionalLight.direction;
    expect(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])).toBeGreaterThan(0.2);
  });
});

describe("manual sun time <-> instant", () => {
  it("round-trips a day-of-year / UTC hour pair", () => {
    for (const [day, hour] of [[1, 0], [172, 12], [366, 23.75], [200, 6.25]] as const) {
      const at = mapSunManualInstant(day, hour, 2024);
      const back = mapSunManualFields(at);
      expect(back.day).toBe(day);
      expect(back.hour).toBeCloseTo(hour, 6);
    }
  });

  it("day 172 at hour 12 is the June solstice noon — a real +23 deg subsolar latitude", () => {
    const sun = glyphMapSubsolarPoint(mapSunManualInstant(172, 12, 2024));
    expect(sun.lat).toBeGreaterThan(23);
    expect(sun.lat).toBeLessThan(23.5);
  });

  it("the hour drives the subsolar longitude westward at 15 deg/hour", () => {
    const a = glyphMapSubsolarPoint(mapSunManualInstant(172, 6, 2024));
    const b = glyphMapSubsolarPoint(mapSunManualInstant(172, 7, 2024));
    expect(b.lon - a.lon).toBeGreaterThan(-15.05);
    expect(b.lon - a.lon).toBeLessThan(-14.95);
  });
});

describe("SUN_MODE_TOGGLE", () => {
  it("offers exactly the three widget modes, with 'off' (Full) first", () => {
    expect(SUN_MODE_TOGGLE.map((o) => o.value)).toEqual(["off", "realtime", "manual"]);
    expect(SUN_MODE_TOGGLE[0].label).toBe("Full");
    for (const option of SUN_MODE_TOGGLE) {
      expect(option.icon).toBeTruthy();
      expect(option.desc && option.desc.length).toBeGreaterThan(0);
    }
  });
});

describe("mapKeyLightForSunMode — what the page's 'Full' actually does", () => {
  const projections: MapProjectionId[] = ["equirectangular", "mercator", "globe"];
  const modes: MapSunMode[] = ["off", "realtime", "manual"];

  it("Full on a GLOBE is a headlight — not merely 'sun off'", () => {
    // The bug this fixes: `"off"` alone only stops the sun tracking. The
    // azimuth/elevation light stays fixed, so a globe keeps a lit half and a
    // dark half, which is not what "Full" promises.
    expect(mapKeyLightForSunMode("off", "globe")).toBe("headlight");
  });

  it("is the ONLY case that takes one — a sheet has no dark hemisphere, and the sun outranks it", () => {
    for (const p of projections) {
      for (const m of modes) {
        const expected = m === "off" && p === "globe" ? "headlight" : "fixed";
        expect(mapKeyLightForSunMode(m, p)).toBe(expected);
      }
    }
  });

  it("CAST SHADOWS drop it everywhere — a headlight hides every shadow behind its own caster", () => {
    // Not a preference. A headlight points down the camera's view axis, and
    // an orthographic camera's screen position is the component PERPENDICULAR
    // to that axis, so a caster displaced along it moves its shadow zero
    // columns and zero rows. `@glyphcss/maps`' `widget.shadow.test.ts`
    // measures what survives: 27 fringe cells against 535 under a fixed
    // light. This is why /maps at its own defaults — globe, Sun "Full" —
    // showed no shadow anywhere the moment the toggle went on.
    for (const p of projections) {
      for (const m of modes) {
        expect(mapKeyLightForSunMode(m, p, true)).toBe("fixed");
      }
    }
    // ...and turning them off gives the headlight straight back.
    expect(mapKeyLightForSunMode("off", "globe", false)).toBe("headlight");
  });

  /**
   * The honest-UI invariant, pinned as an equivalence rather than restated as
   * a second constant: the Dock dims Azimuth/Elev with
   * `directionLocked={isOrbitProjectionId(projectionId)}`, and that must be
   * true in EXACTLY the cases where something other than those sliders is
   * aiming the key light — the sun (orbit + sun on) or the headlight (orbit +
   * Full). A live-looking slider that changes nothing is the failure mode.
   */
  it("the Dock's dim rule matches, case for case, who actually owns the direction", () => {
    for (const p of projections) {
      for (const m of modes) {
        for (const shadows of [false, true]) {
          const headlightOwns = mapKeyLightForSunMode(m, p, shadows) === "headlight";
          // The sun writes a real directional light only on an orbit
          // projection; on a sheet its terminator is a per-cell colour term
          // that leaves the key light alone.
          const sunOwns = m !== "off" && isOrbitProjectionId(p);
          expect(mapDirectionLocked(p, m, shadows)).toBe(headlightOwns || sunOwns);
        }
      }
    }
  });

  it("the ONE case shadows un-dim is globe + Full — where the sliders become the only thing aiming the light", () => {
    // Everywhere else the rule is unchanged, so this is a targeted un-dim and
    // not a blanket "shadows enable the sliders".
    for (const p of projections) {
      for (const m of modes) {
        const changed = mapDirectionLocked(p, m, true) !== mapDirectionLocked(p, m, false);
        expect({ p, m, changed }).toEqual({ p, m, changed: p === "globe" && m === "off" });
      }
    }
    expect(mapDirectionLocked("globe", "off", true)).toBe(false);
    expect(mapDirectionLocked("globe", "off", false)).toBe(true);
  });
});
