// @vitest-environment happy-dom
//
// This file's default `node` environment (see vitest.config.ts) has no
// `document` — fine for every pure-function test here, but the pyramid-stage
// arbiter suite below builds a REAL `createGlyphScene` (to run the actual
// `frameObject` + renderer, not a hand-rolled reproduction of them), which
// needs one to create its `<pre>`/host elements. happy-dom, not jsdom, to
// match the rest of the repo's DOM-environment tests (e.g.
// useSynthPreview.test.tsx).
import { describe, expect, it, vi } from "vitest";

// Importing synthKit.tsx transitively imports Dock/slots.tsx, whose
// useRenderingFolder module calls `ensureCalibratedPalette()` at IMPORT TIME
// (a real-browser-only canvas measurement). happy-dom has no canvas 2D
// context, so that module-load side effect throws before this file's own
// tests can run. Stub just `calibrateGlyphRamp` — the rest of
// `@glyphcss/effects` stays real — same pattern LayerGroup.test.tsx and
// useSynthPreview.test.tsx already use for the same reason. `vi.mock` calls
// are hoisted above every import in this file, so this takes effect before
// synthKit.tsx (and its Dock/slots.tsx import chain) loads.
vi.mock("@glyphcss/effects", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@glyphcss/effects")>();
  return {
    ...actual,
    calibrateGlyphRamp: () => ({ ramp: " .:-=+*#%@", steps: [] }),
  };
});

import { GlyphFieldSynthEffect as fieldSynth } from "@glyphcss/effects";
import { createGlyphOrthographicCamera, createGlyphScene } from "glyphcss";
import {
  FIELDS,
  FIELDS_3D,
  PYRAMID_STAGE_SIZE,
  RENDER_MODES,
  SHAPES,
  STAGE_CAMERA_ROT_X,
  STAGE_CAMERA_ROT_Y,
  STAGE_CAMERA_ZOOM,
  STAGE_HINTS,
  WAVES,
  buildWavePathD,
  computeSynthTickPlan,
  frameObject,
  isSdfField,
  isSdfIterField,
  isTimeInvariantPatch,
  resolveInkControlVisibility,
  resolveSpaceChange,
  shapePolys,
  shapeTransform,
  soloParams,
  stagePreviewShape,
  synthDefaults,
  wrapDrivenTime,
} from "./synthKit";

// P1-1 — solo previews used to lie for layered patches: soloParams() forced
// the previewed voice onto default layer 1 and default (unshaped) layer
// params, discarding layerN and layerCombine/Threshold/Invert/Blend/Amp. A
// thresholded/inverted layer previewed as if none of that shaping existed.
describe("soloParams", () => {
  it("copies the SOURCE layer's shaping (threshold+invert+blend+combine+amp) onto layer 1", () => {
    const params = {
      ...synthDefaults(),
      amp3: 0.7, field3: "radial", wave3: "sin", freq3: 4, speed3: 1, layer3: 3,
      layerCombine3: "add", layerThresholdOn3: true, layerThreshold3: 0.4,
      layerInvert3: true, layerBlend3: "min", layerAmp3: 0.6,
    };
    const solo = soloParams(params, 3);

    // The previewed voice always lands on layer 1 (a solo preview is a
    // single active voice — every layer folds identically for one voice).
    expect(solo.layer1).toBe(1);
    // ...but layer 1's own shaping must read like the SOURCE layer (3) did,
    // not the flat default a bare `layer1: 1` copy would leave in place.
    expect(solo.layerCombine1).toBe("add");
    expect(solo.layerThresholdOn1).toBe(true);
    expect(solo.layerThreshold1).toBe(0.4);
    expect(solo.layerInvert1).toBe(true);
    expect(solo.layerBlend1).toBe("min");
    expect(solo.layerAmp1).toBe(0.6);
    // The voice's own oscillator params still come along unchanged.
    expect(solo.field1).toBe("radial");
    expect(solo.amp1).toBe(1);
    // Layers 2/3 stay unpopulated — only voice 1 (amp 1) is active.
    expect(solo.amp2).toBe(0);
  });

  it("defaults to layer 1's own (unshaped) params when the source voice never left layer 1", () => {
    const params = { ...synthDefaults(), amp1: 1, field1: "angular" };
    const solo = soloParams(params, 1);
    expect(solo.layer1).toBe(1);
    expect(solo.layerThresholdOn1).toBe(false);
    expect(solo.layerInvert1).toBe(false);
    expect(solo.layerAmp1).toBe(1);
  });

  // Gate finding — soloParams never copied `iter${slot}`, so a menger/
  // sierpinski voice card always previewed the schema default (iter 3)
  // regardless of what the voice's own iter knob was set to.
  it("copies the voice's own iter (menger/sierpinski recursion depth) onto layer 1", () => {
    const params = { ...synthDefaults(), amp2: 0.5, field2: "menger", iter2: 1 };
    const solo = soloParams(params, 2);
    expect(solo.field1).toBe("menger");
    expect(solo.iter1).toBe(1);
  });
});

// P1-3 — the Mapping dropdown wrote `space` directly, bypassing the 2D/3D
// toggle's validity guard: from {space:"object", render:"carve"}, picking a
// 2D mapping persisted {space:"surface", render:"carve"}, which
// validateParams rejects (carve requires space:"object"). `resolveSpaceChange`
// is the single guard both the toggle and the dropdown now route through.
describe("resolveSpaceChange", () => {
  it("leaving \"object\" forces render back to \"paint\"", () => {
    expect(resolveSpaceChange("surface")).toEqual({ render: "paint" });
    expect(resolveSpaceChange("auto")).toEqual({ render: "paint" });
    expect(resolveSpaceChange("scene")).toEqual({ render: "paint" });
  });

  it("entering \"object\" syncs the stage to the cube shape, not render", () => {
    expect(resolveSpaceChange("object")).toEqual({ shape: "cube" });
  });

  // VOLUMETRIC-2.md §4: leaving "object" must also restore `render: "xray"`
  // back to "paint" (xray, like carve, only validates under `space:
  // "object"`) — `resolveSpaceChange` doesn't special-case xray because it
  // never inspects the CURRENT render value at all: leaving "object" always
  // resolves to `{ render: "paint" }` unconditionally, via the shared
  // `sanitizeCarveRenderForSpace` guard (extended in synthUrlState.ts to
  // check both "carve" and "xray").
  it("repro: object+xray, then Mapping dropdown -> surface yields params that pass validateParams", () => {
    const params = { ...synthDefaults(), space: "object", render: "xray" };
    const change = resolveSpaceChange("surface");
    const next = { ...params, space: "surface", ...(change.render ? { render: change.render } : {}) };

    expect(next.render).toBe("paint");
    expect(() => fieldSynth.program.validateParams?.(next as never)).not.toThrow();
  });

  it("repro: object+carve, then Mapping dropdown -> surface yields params that pass validateParams", () => {
    const params = { ...synthDefaults(), space: "object", render: "carve" };
    const change = resolveSpaceChange("surface");
    const next = { ...params, space: "surface", ...(change.render ? { render: change.render } : {}) };

    expect(next.render).toBe("paint");
    expect(() => fieldSynth.program.validateParams?.(next as never)).not.toThrow();
  });

  it("without the fix (writing space directly) the same repro fails validateParams", () => {
    const params = { ...synthDefaults(), space: "object", render: "carve" };
    const next = { ...params, space: "surface" };
    expect(() => fieldSynth.program.validateParams?.(next as never)).toThrow();
  });
});

// The /synth Output folder's "Ink levels" (2D field-synth ink)/"Ink spacing"
// (carve-ink, VOLUMETRIC-3.md §2) rows swap in place on `render`, exactly
// like the Volume folder's "March fade"/"Xray gain" pair already does —
// see `resolveInkControlVisibility`'s doc in synthKit.tsx.
describe("resolveInkControlVisibility", () => {
  it("subcellRes !== \"ink\" hides both rows regardless of render", () => {
    for (const render of RENDER_MODES) {
      expect(resolveInkControlVisibility("1x1", render)).toEqual({ showInkLevels: false, showInkSpacing: false });
      expect(resolveInkControlVisibility("2x4", render)).toEqual({ showInkLevels: false, showInkSpacing: false });
    }
  });

  it("subcellRes: \"ink\" + render: \"carve\" shows Ink spacing only — Ink levels is a documented no-op there", () => {
    expect(resolveInkControlVisibility("ink", "carve")).toEqual({ showInkLevels: false, showInkSpacing: true });
  });

  it("subcellRes: \"ink\" + render: \"paint\" (2D field-synth ink) shows Ink levels only", () => {
    expect(resolveInkControlVisibility("ink", "paint")).toEqual({ showInkLevels: true, showInkSpacing: false });
  });

  // render: "xray" always rejects subcellRes: "ink" at validation (carve
  // only), so this combination never reaches the live Dock — but the pure
  // function still resolves it the same way "paint" does (inkSpacing is a
  // carve-only concept), not a third state.
  it("subcellRes: \"ink\" + render: \"xray\" (unreachable in practice — validateParams rejects it) still resolves inkLevels, not inkSpacing", () => {
    expect(resolveInkControlVisibility("ink", "xray")).toEqual({ showInkLevels: true, showInkSpacing: false });
    expect(() => fieldSynth.program.validateParams?.(
      { ...synthDefaults(), space: "object", render: "xray", subcellRes: "ink" } as never,
    )).toThrow();
  });
});

// VOLUMETRIC-2.md §2: a non-periodic `step` wave swept across the old 0..1
// window (`raw * freq - time*speed + phase`, with `raw` in 0..1) never
// crosses zero for the common freq>0/time=0/phase=0 case, previewing as a
// constant line. `buildWavePathD` must use a symmetric sweep window for
// non-periodic waves instead, so the edge is visible.
describe("buildWavePathD", () => {
  function pathYValues(d: string): number[] {
    return d.trim().split(/\s+/)
      .filter((tok) => tok !== "")
      .map((tok) => Number(tok.replace(/^[ML]/, "")))
      .filter((_, i) => i % 2 === 1); // every other numeric token is a y coordinate (M x y L x y ...)
  }

  it("a step wave at default freq/time/phase is NOT a constant line (the regression this fix targets)", () => {
    const d = buildWavePathD("step", 3, 0, 1, 0, 100, 30);
    const ys = pathYValues(d);
    const distinct = new Set(ys.map((y) => Math.round(y * 100)));
    expect(distinct.size).toBeGreaterThan(1);
  });

  it("a step wave's preview shows both the low and high level (a real edge, not just noise)", () => {
    const d = buildWavePathD("step", 3, 0, 1, 0, 100, 30);
    const ys = pathYValues(d);
    const midY = 15;
    expect(Math.min(...ys)).toBeLessThan(midY - 5); // amp*(-1) side
    expect(Math.max(...ys)).toBeGreaterThan(midY + 5); // amp*(+1) side
  });

  it("a periodic wave (sin) keeps sweeping the un-shifted 0..1 window (unaffected by this fix)", () => {
    const withPhase = buildWavePathD("sin", 1, 0, 1, 0, 100, 30, 0.5, 0);
    // At raw=0 (the first sample), sin's argument is `0*freq - 0 + 0 = 0` ->
    // synthWave("sin", 0) = 0 -> y = midY. Confirms the window still starts
    // at raw=0, not -0.5, for a periodic wave.
    const ys = pathYValues(withPhase);
    expect(ys[0]).toBeCloseTo(15, 5);
  });
});

// VOLUMETRIC-2.md §3: STAGE_HINTS is keyed by the imported preset OBJECT's
// identity, not its display name — a name-keyed `Record<string, Hint>` (the
// old `PRESET_DENSITY` shape) would silently drop a hint the moment someone
// renames a preset's `.name`.
//
// P1-B fix: the map used to get to that object identity via a name-string
// LOOKUP at module load (`fieldSynth.presets.find(p => p.name === "Menger
// sponge")`, throwing if nothing matched) — rename-proof only AFTER
// construction, not rename-proof getting there. Renaming a shipped preset in
// `stock.ts` without updating that lookup's string crashed module
// evaluation itself. The fix removes the lookup: `STAGE_HINTS` is built
// directly from `GlyphMengerSpongePreset` etc. (named const exports —
// `stock.ts` — that are the literal same objects `fieldSynth.presets`
// holds), so there is no name string anywhere in this file to drift out of
// sync. These tests prove that at both the unit level (object identity
// survives a post-construction rename) and the module-init level (renaming
// a preset's display name AT THE SOURCE, before `synthKit`'s own
// `STAGE_HINTS` top-level runs, does not throw and the hint still applies)
// — the real rename scenario the old name-lookup test only simulated half of.
describe("STAGE_HINTS (VOLUMETRIC-2.md §3, object-keyed stage hints)", () => {
  it("looks up by preset object identity — renaming a preset's display name after the fact doesn't drop its hint", () => {
    const preset = (fieldSynth.presets ?? []).find((p) => p.name === "Menger sponge");
    expect(preset).toBeDefined();
    const before = STAGE_HINTS.get(preset!);
    expect(before).toBeDefined();
    expect(before?.shape).toBe("cube");

    const original = preset!.name;
    (preset as { name: string }).name = "Renamed sponge";
    try {
      // A `Record<string, Hint>` keyed on the OLD name would now miss.
      expect(STAGE_HINTS.get(preset!)).toBe(before);
      expect(stagePreviewShape(preset!)).toBe("cube");
    } finally {
      (preset as { name: string }).name = original;
    }
  });

  // The real rename scenario P1-B was about: the preset's `.name` changes AT
  // THE SOURCE (`@glyphcss/effects`) before `synthKit`'s own module-level
  // `STAGE_HINTS = new Map([...])` construction runs — i.e. the moment the
  // OLD `shippedPreset("Menger sponge")` name-lookup helper would have
  // thrown and taken the whole module (and every page importing it) down
  // with it. `vi.resetModules()` + a fresh dynamic `import()` re-runs that
  // top-level construction from scratch against the renamed object.
  it("module init never throws when a preset is renamed at the source before synthKit's own module load, and the hint still applies by identity", async () => {
    vi.resetModules();
    const effects = await import("@glyphcss/effects");
    const renamedPreset = effects.GlyphMengerSpongePreset as { name: string };
    const original = renamedPreset.name;
    renamedPreset.name = "Renamed sponge (module init)";
    try {
      const freshSynthKit = await import("./synthKit");
      const hint = freshSynthKit.STAGE_HINTS.get(renamedPreset as never);
      expect(hint).toBeDefined();
      expect(hint?.shape).toBe("cube");
      expect(freshSynthKit.stagePreviewShape(renamedPreset as never)).toBe("cube");
    } finally {
      renamedPreset.name = original;
      vi.resetModules();
    }
  });

  it("every shipped stage-hinted preset resolves through STAGE_HINTS, and an un-hinted preset falls back to the space-derived default", () => {
    const menger = (fieldSynth.presets ?? []).find((p) => p.name === "Menger sponge")!;
    const sierpinski = (fieldSynth.presets ?? []).find((p) => p.name === "Sierpinski pyramid")!;
    const gyroid = (fieldSynth.presets ?? []).find((p) => p.name === "Gyroid xray")!;
    const sunburst = (fieldSynth.presets ?? []).find((p) => p.name === "Sunburst")!;
    expect(stagePreviewShape(menger)).toBe("cube");
    expect(stagePreviewShape(sierpinski)).toBe("pyramid");
    expect(stagePreviewShape(gyroid)).toBe("cube");
    // Sunburst has no stage hint and isn't volumetric (`space` defaults away
    // from "object") — falls back to the flat plane.
    expect(STAGE_HINTS.get(sunburst)).toBeUndefined();
    expect(stagePreviewShape(sunburst)).toBe("plane");
  });

  // Perf packet follow-up: "SDF bloom" (stock.ts) is a one-way SDF erosion
  // (`wave: "step"`, non-periodic — required to stay sphere-tracing
  // eligible) that never returns to its start on its own. Its hint must
  // declare `loopSeconds` so the page replays the arc instead of playing it
  // once and sitting at the fully-eroded end state forever.
  it("declares loopSeconds on the SDF bloom preset's hint, and leaves every other preset unset (today's plain monotonic time)", () => {
    const bloom = (fieldSynth.presets ?? []).find((p) => p.name === "SDF bloom")!;
    expect(bloom).toBeDefined();
    expect(STAGE_HINTS.get(bloom)?.loopSeconds).toBe(15);

    const menger = (fieldSynth.presets ?? []).find((p) => p.name === "Menger sponge")!;
    const mengerSdf = (fieldSynth.presets ?? []).find((p) => p.name === "Menger SDF")!;
    const mengerFlow = (fieldSynth.presets ?? []).find((p) => p.name === "Menger flow")!;
    for (const preset of [menger, mengerSdf, mengerFlow]) {
      expect(STAGE_HINTS.get(preset)?.loopSeconds).toBeUndefined();
    }
  });
});

describe("isTimeInvariantPatch", () => {
  it("is true when every active (amp > 0) voice has speed 0 — the shipped Menger SDF preset's own case", () => {
    const mengerSdf = (fieldSynth.presets ?? []).find((p) => p.name === "Menger SDF")!;
    expect(isTimeInvariantPatch({ ...synthDefaults(), ...(mengerSdf.params as Record<string, unknown>) } as never)).toBe(true);
  });

  it("is false when an active voice has a nonzero speed — the shipped SDF bloom preset's own case", () => {
    const bloom = (fieldSynth.presets ?? []).find((p) => p.name === "SDF bloom")!;
    expect(isTimeInvariantPatch({ ...synthDefaults(), ...(bloom.params as Record<string, unknown>) } as never)).toBe(false);
  });

  it("ignores a nonzero speed on a MUTED voice (amp 0)", () => {
    const params = { ...synthDefaults(), amp1: 1, speed1: 0, amp2: 0, speed2: 7 } as never;
    expect(isTimeInvariantPatch(params)).toBe(true);
  });

  it("is false as soon as one of several active voices has nonzero speed", () => {
    const params = { ...synthDefaults(), amp1: 1, speed1: 0, amp2: 1, speed2: 0, amp3: 1, speed3: 2 } as never;
    expect(isTimeInvariantPatch(params)).toBe(false);
  });
});

// Regression coverage for the perf-packet report "orbit doesn't move the
// camera for time-invariant patches": `computeSynthTickPlan` is the single
// pure decision point the tick loop reads both `advanceTime` and `orbit`
// from, specifically so the two can never be accidentally coupled again (see
// the function's own doc in synthKit.tsx). Live-page verification (Playwright
// against the real /synth dev server, sampling the MAIN STAGE `<pre>` by a
// reference captured off the actual scene rather than a `.glyph-output`
// class selector — that class is shared by ~30 elements on the page,
// including preset-gallery tile and voice-card mini previews, and a naive
// `.first()`/`.glyph-output` query silently lands on one of those instead of
// the stage) confirmed the shipped tick loop already orbits correctly for a
// time-invariant patch; this suite pins the invariant at the level the rest
// of this file already tests tick-loop logic at.
describe("computeSynthTickPlan", () => {
  const mengerSdf = (fieldSynth.presets ?? []).find((p) => p.name === "Menger SDF")!;
  const mengerSdfParams = { ...synthDefaults(), ...(mengerSdf.params as Record<string, unknown>) } as never;

  it("orbits a time-invariant patch (the reported repro): advanceTime false, orbit true", () => {
    const plan = computeSynthTickPlan({
      paused: false, timeScale: 1, params: mengerSdfParams,
      flat: false, orbitAuto: true, orbitDragging: false,
    });
    expect(plan).toEqual({ advanceTime: false, orbit: true });
  });

  it("advances time for a time-variant patch regardless of orbit", () => {
    const bloom = (fieldSynth.presets ?? []).find((p) => p.name === "SDF bloom")!;
    const bloomParams = { ...synthDefaults(), ...(bloom.params as Record<string, unknown>) } as never;
    expect(computeSynthTickPlan({ paused: false, timeScale: 1, params: bloomParams, flat: false, orbitAuto: false, orbitDragging: false }).advanceTime).toBe(true);
    expect(computeSynthTickPlan({ paused: false, timeScale: 1, params: bloomParams, flat: false, orbitAuto: true, orbitDragging: false }).advanceTime).toBe(true);
  });

  it("orbit is independent of paused/timeScale (mesh spin stopping must not stop the camera)", () => {
    expect(computeSynthTickPlan({ paused: true, timeScale: 1, params: mengerSdfParams, flat: false, orbitAuto: true, orbitDragging: false }).orbit).toBe(true);
    expect(computeSynthTickPlan({ paused: false, timeScale: 0, params: mengerSdfParams, flat: false, orbitAuto: true, orbitDragging: false }).orbit).toBe(true);
  });

  it("orbit is off when orbitAuto is off, the stage is flat, or a drag is in progress", () => {
    expect(computeSynthTickPlan({ paused: false, timeScale: 1, params: mengerSdfParams, flat: false, orbitAuto: false, orbitDragging: false }).orbit).toBe(false);
    expect(computeSynthTickPlan({ paused: false, timeScale: 1, params: mengerSdfParams, flat: true, orbitAuto: true, orbitDragging: false }).orbit).toBe(false);
    expect(computeSynthTickPlan({ paused: false, timeScale: 1, params: mengerSdfParams, flat: false, orbitAuto: true, orbitDragging: true }).orbit).toBe(false);
  });

  it("neither advances nor orbits when idle (time-invariant, orbit off) — the perf win this packet shipped", () => {
    expect(computeSynthTickPlan({ paused: false, timeScale: 1, params: mengerSdfParams, flat: false, orbitAuto: false, orbitDragging: false })).toEqual({ advanceTime: false, orbit: false });
  });
});

describe("wrapDrivenTime", () => {
  it("is a no-op (returns t unchanged) when loopSeconds is absent/null/undefined/non-positive — today's plain monotonic time", () => {
    expect(wrapDrivenTime(47.3, undefined)).toBe(47.3);
    expect(wrapDrivenTime(47.3, null)).toBe(47.3);
    expect(wrapDrivenTime(47.3, 0)).toBe(47.3);
    expect(wrapDrivenTime(47.3, -5)).toBe(47.3);
  });

  it("wraps t into [0, loopSeconds)", () => {
    expect(wrapDrivenTime(0, 15)).toBe(0);
    expect(wrapDrivenTime(7, 15)).toBe(7);
    expect(wrapDrivenTime(15, 15)).toBe(0);
    expect(wrapDrivenTime(22, 15)).toBeCloseTo(7, 10);
    expect(wrapDrivenTime(150.5, 15)).toBeCloseTo(0.5, 10);
  });

  it("stays correct (mathematical modulo, not JS remainder) even for a t that were somehow negative", () => {
    expect(wrapDrivenTime(-3, 15)).toBeCloseTo(12, 10);
  });
});

// VOLUMETRIC-2.md §3: the `pyramid` stage is a binding contract, not
// cosmetics — its vertices must be EXACTLY the uncentered corner tetra
// (0,0,0), (s,0,0), (0,s,0), (0,0,s), not a centered variant (the "solid
// mass in the wrong octants" failure mode stock.test.ts's own stage-
// alignment counter-case pins on the effects side).
describe("shapePolys(\"pyramid\") (VOLUMETRIC-2.md §3, uncentered corner tetra)", () => {
  it("is appended at the END of the shape enum (append-only — URL-index-encoded)", () => {
    expect(SHAPES[SHAPES.length - 1]).toBe("pyramid");
  });

  it("produces exactly 4 triangular faces with vertices at the origin and the three axis corners at s = PYRAMID_STAGE_SIZE — not recentered", () => {
    const polys = shapePolys("pyramid") as unknown as { vertices: [number, number, number][] }[];
    expect(polys.length).toBe(4);
    const s = PYRAMID_STAGE_SIZE;
    const expected: [number, number, number][] = [[0, 0, 0], [s, 0, 0], [0, s, 0], [0, 0, s]];
    const seen = new Set<string>();
    for (const face of polys) {
      expect(face.vertices.length).toBe(3);
      for (const v of face.vertices) seen.add(v.join(","));
    }
    for (const v of expected) expect(seen.has(v.join(","))).toBe(true);
    expect(seen.size).toBe(4); // exactly these four points, no others

    // Uncentered: the bounding box spans [0, s] on every axis, not
    // [-s/2, s/2] — its centroid sits well away from the origin, unlike
    // every OTHER stage shape (which centers on `center`, default [0,0,0]).
    let minc = Infinity, maxc = -Infinity;
    for (const v of seen) for (const n of v.split(",").map(Number)) { if (n < minc) minc = n; if (n > maxc) maxc = n; }
    expect(minc).toBe(0);
    expect(maxc).toBe(s);
  });
});

// Upright reorientation: the uncentered corner tetra's own bounding-box
// centroid sits at (s/4, s/4, s/4), not the origin every other stage renders
// around, so left alone (and the OLD translation-only fix's own residual
// off-balance look) the stage renders lying on a right-angle face rather
// than reading as the classic apex-up Sierpinski pyramid. `shapeTransform
// ("pyramid")` now rotates AND translates it via the mesh's WORLD-space
// transform instead of touching its object-space vertices — the pyramid
// stage's field recipe (VOLUMETRIC-2.md §3) requires those to stay exactly
// the uncentered `[0,s]^3` corner form.
//
// `createGlyphScene.ts`'s `applyTransform` composes `Rx * Ry * Rz` (Rz acts
// first on the point), matching `rotateWorld` below exactly, then translates.
// `objectVertices` (the pre-transform `polygons[i].vertices` reference
// `applyTransform` aliases unmodified) is untouched by any of this — only the
// WORLD-space mesh transform changes, so the Sierpinski recipe's `[0,1]^3`-
// aligned field never sees the reorientation.
function rotateWorld([vx, vy, vz]: readonly [number, number, number], [rxDeg, ryDeg, rzDeg]: readonly [number, number, number]): [number, number, number] {
  const D = Math.PI / 180;
  const rx = rxDeg * D, ry = ryDeg * D, rz = rzDeg * D;
  const cosX = Math.cos(rx), sinX = Math.sin(rx);
  const cosY = Math.cos(ry), sinY = Math.sin(ry);
  const cosZ = Math.cos(rz), sinZ = Math.sin(rz);
  let x = vx, y = vy, z = vz;
  let nx = cosZ * x - sinZ * y;
  let ny = sinZ * x + cosZ * y;
  let nz = z;
  x = cosY * nx + sinY * nz;
  y = ny;
  z = -sinY * nx + cosY * nz;
  nx = x;
  ny = cosX * y - sinX * z;
  nz = sinX * y + cosX * z;
  return [nx, ny, nz];
}

describe("shapeTransform(\"pyramid\") (upright reorientation, world rotate + center via mesh transform)", () => {
  it("rotates the apex above a ground-parallel base (world +Z), while object-space vertices (objectVertices) stay exactly the uncentered corner form", () => {
    const s = PYRAMID_STAGE_SIZE;
    const raw = (shapePolys("pyramid") as unknown as { vertices: [number, number, number][] }[])
      .flatMap((face) => face.vertices);

    // Sanity: the raw (pre-transform / objectVertices) box is NOT already
    // centered — its own bounding-box centroid sits at (s/4, s/4, s/4).
    const rawCentroidPerAxis = (axis: number) => raw.reduce((sum, v) => sum + v[axis]!, 0) / raw.length;
    for (let axis = 0; axis < 3; axis++) expect(rawCentroidPerAxis(axis)).toBeCloseTo(s / 4, 10);

    // objectVertices stays exactly the uncentered corner form regardless.
    const expected: [number, number, number][] = [[0, 0, 0], [s, 0, 0], [0, s, 0], [0, 0, s]];
    const seenRaw = new Set(raw.map((v) => v.join(",")));
    for (const v of expected) expect(seenRaw.has(v.join(","))).toBe(true);
    expect(seenRaw.size).toBe(4);

    const transform = shapeTransform("pyramid");
    expect(transform.rotation).toBeDefined();
    expect(transform.scale).toBeUndefined();
    const rotation = transform.rotation as [number, number, number];
    const [px, py, pz] = transform.position as [number, number, number];

    // Apply the SAME rotate-then-translate `applyTransform` performs.
    const world = raw.map((v) => {
      const [rx, ry, rz] = rotateWorld(v, rotation);
      return [rx + px, ry + py, rz + pz] as const;
    });
    // Deduplicate back to the 4 logical vertices (O, A, B, C each appear on
    // multiple faces) by matching against the raw uncentered corner form's
    // index order — `raw`'s first occurrence of each of the 4 points anchors
    // which transformed point is which.
    const indexOfFirst = (needle: readonly [number, number, number]) =>
      raw.findIndex((v) => v[0] === needle[0] && v[1] === needle[1] && v[2] === needle[2]);
    const worldO = world[indexOfFirst([0, 0, 0])]!;
    const worldA = world[indexOfFirst([s, 0, 0])]!;
    const worldB = world[indexOfFirst([0, s, 0])]!;
    const worldC = world[indexOfFirst([0, 0, s])]!;

    // Base (A, B, C) is parallel to the ground: constant world Z. World Z —
    // not Y — is the axis `alignCornerTetraApexEuler` (synthKit.tsx) targets;
    // see that function's doc for why (Z is the one world axis whose screen
    // projection is invariant to the real camera's yaw under
    // `createGlyphOrthographicCamera`'s actual rotation convention).
    expect(worldA[2]).toBeCloseTo(worldB[2], 8);
    expect(worldB[2]).toBeCloseTo(worldC[2], 8);
    // Apex (O) sits ABOVE the base plane along world Z.
    expect(worldO[2]).toBeGreaterThan(worldA[2]);

    // Deliberately NOT asserted here: that the 4 vertices' world-space AABB
    // centers on the origin. A tetrahedron's 4 vertices are not centrally
    // symmetric about their own axis-aligned bbox center, so `position` no
    // longer targets that — it targets the SCREEN-projected silhouette
    // center under the real stage camera instead (see `shapeTransform`'s
    // doc in synthKit.tsx for the full derivation, and the "through the real
    // renderer" suite below for the arbiter that actually matters).
  });

  it("is the identity (no position/rotation) for every other stage shape", () => {
    for (const shape of SHAPES) {
      if (shape === "pyramid") continue;
      expect(shapeTransform(shape)).toEqual({});
    }
  });
});

// The arbiter for "does this actually look upright and centered" cannot be a
// hand-rolled matrix reproduction — that only proves a transform is
// internally self-consistent with its OWN re-derivation of `applyTransform`'s
// math, not that it renders correctly. THREE prior fixes each shipped
// exactly that kind of self-consistency test and passed while the LIVE PAGE
// still looked wrong:
//   - 43026ff targeted world +Y as "up" — passed a hand-rolled check, but
//     `createGlyphOrthographicCamera` doesn't treat +Y as vertical (see
//     `alignCornerTetraApexEuler`'s doc in synthKit.tsx).
//   - 529a09e centered the 4 rotated corners' 3D world-space bounding box —
//     passed a fixed-small-grid `compileScene` check (cols 96, zoom
//     `STAGE_CAMERA_ZOOM` 46), but a tetrahedron's 4 vertices aren't
//     centrally symmetric about that box's center, so the residual screen
//     offset is a FIXED WORLD-SPACE bias that scales linearly with zoom —
//     it stayed under that test's ~1-cell tolerance at zoom 46, then grew to
//     several cells off-center at the ~4x larger zoom `SynthWorkbench.tsx`'s
//     own `frameObject` actually computes to fill the real viewport
//     (confirmed live via Playwright against the running page).
//   - 783fa79 centered the rotated shape's screen-PROJECTED silhouette bbox
//     instead — exact at the ONE fixed pose it was solved at (verified live
//     via Playwright, and by the tight `<0.1`-cell version of the bbox test
//     below). But the solved translation has nonzero world X/Y components
//     (a tetrahedron's 4-vertex bbox center isn't ON its own 3-fold
//     symmetry axis), and `createGlyphOrthographicCamera` orbits around
//     `target` (world origin, never set by this stage) — so that lateral
//     offset makes the shape's screen position swing through an
//     ellipse as the camera's `rotY` (yaw — orbit auto-rotate, or a manual
//     drag) sweeps: the "rotates eccentrically" bug. Confirmed with a
//     pre-fix instrumentation sweep matching this suite's methodology: the
//     783fa79 translation drifts the shape's projected centroid by ~30
//     cells (of 135) across an 8-phase, 45°-apart `rotY` sweep — vs. <0.1
//     cells for the fix below.
//
// The fix constrains `position` to a PURE world-Z translation — i.e.
// translating the tetra ALONG its own 3-fold symmetry axis, which
// `alignCornerTetraApexEuler`'s rotation already places exactly on world Z
// through the origin (apex O is always at local (0,0,0), which `rotateOnly`
// fixes; the three base corners land 120° apart around that same line — see
// that function's doc). A translation along the axis leaves the axis
// exactly where it was (still the line x=0,y=0, through the camera's
// pivot), which `rotateVec3Voxcss` (createGlyphCamera.ts) makes provably
// invariant: a pure-Z world vector's rotated CSS-X/col component is
// IDENTICALLY zero for every `rotX`/`rotY` (`rotateZ(rotY)` never touches
// the Z-swapped `cz`; `rotateX(rotX)` only ever mixes `cy`/`cz`, never
// `cx`) — so centering along Z can never introduce lateral drift, at any
// camera angle, not just the one it's solved at. `pz` is still solved
// against the real camera (single remaining unknown: vertical placement),
// matching 783fa79's "ask the real camera, don't hand-derive it" approach.
//
// One consequence: the shape's raw PIXEL SILHOUETTE bbox (min/max covered
// cell) is no longer a valid "is this centered" oracle by itself. A
// tetrahedron has 3-fold rotational symmetry but — unlike a cube,
// icosahedron, or sphere — no CENTRAL INVERSION symmetry, so its rendered
// outline's left/right extent genuinely shifts a few percent of the grid
// width as true azimuth changes, even while the object rotates in perfect
// place about a correctly centered axis (this is real, expected behavior —
// a physical die-corner spun on its own axis under an oblique camera looks
// the same way). The provably-invariant quantity is the shape's own
// CENTROID (equivalently, any point on its symmetry axis): this suite
// tracks that under a spin sweep, and separately confirms — via the same
// sweep run against `cube`/`icosahedron`/`sphere` — that shapes WITH
// central symmetry show exactly zero silhouette-bbox drift, which the
// pyramid structurally cannot match.
//
// This suite builds the scene the way `SynthWorkbench.tsx` ACTUALLY does
// for the pyramid stage: the real `createGlyphScene` + real `frameObject`
// (imported from synthKit.tsx, not reimplemented here) + real
// `shapePolys(...)` + real `shapeTransform(...)`, at the page's real
// `STAGE_CAMERA_ROT_X/Y/ZOOM`. `cols`/`rows` are set directly (bypassing
// `autoSize`, which needs real browser layout unavailable under vitest).
// The spin sweep mutates `camera.rotY` directly after a SINGLE
// `frameObject` call, exactly matching `SynthWorkbench.tsx`'s orbit tick
// (`camera.zoom` is fixed once at scene build, never re-fit per frame).
describe("shapeTransform(\"pyramid\") through the real renderer (arbiter, page-config replica)", () => {
  const s = PYRAMID_STAGE_SIZE;
  const transform = shapeTransform("pyramid");
  const rotation = transform.rotation as [number, number, number];
  const [px, py, pz] = transform.position as [number, number, number];
  const applyPoint = (v: readonly [number, number, number]): [number, number, number] => {
    const [rx, ry, rz] = rotateWorld(v, rotation);
    return [rx + px, ry + py, rz + pz];
  };
  const cols = 96, rows = 48, cellAspect = 2;

  it("is a PURE world-Z translation — no lateral X/Y component (the axis-preserving fix)", () => {
    expect(px).toBeCloseTo(0, 10);
    expect(py).toBeCloseTo(0, 10);
  });

  it("projects the apex to a strictly smaller row (higher on screen) than every base vertex, and keeps the base vertices in one row band, through the real camera", () => {
    const camera = createGlyphOrthographicCamera({ rotX: STAGE_CAMERA_ROT_X, rotY: STAGE_CAMERA_ROT_Y, zoom: STAGE_CAMERA_ZOOM });
    const worldO = applyPoint([0, 0, 0]);
    const worldA = applyPoint([s, 0, 0]);
    const worldB = applyPoint([0, s, 0]);
    const worldC = applyPoint([0, 0, s]);

    const apexRow = camera.project(worldO, cols, rows, cellAspect)[1];
    const baseRows = [worldA, worldB, worldC].map((v) => camera.project(v, cols, rows, cellAspect)[1]);

    for (const baseRow of baseRows) expect(apexRow).toBeLessThan(baseRow);
    // "One row band": the three base corners don't have to land on the exact
    // same row (only their world-Z is exactly equal — screen row also picks
    // up their world X/Y spread once perspective/rotation is applied under
    // the camera's nonzero yaw), but the failure mode this guards against is
    // the ORIGINAL regression — a base corner landing ABOVE the apex, i.e. a
    // negative or near-zero gap. Asserting a comfortably positive minimum gap
    // (not a tight band vs. the total shape height, which the oblique default
    // camera angle spreads the base corners across regardless of a correct
    // orientation) is the actual regression guard.
    const apexToBaseSpan = Math.min(...baseRows) - apexRow;
    expect(apexToBaseSpan).toBeGreaterThan(0.2);
  });

  // Renders the pyramid stage through the SAME sequence SynthWorkbench.tsx
  // runs: `createGlyphScene` -> `scene.add(polys, transform)` -> `rerender()`
  // -> `frameObject(scene, camera, polys, fill, cover, transform)` ->
  // `rerender()`. `frameObject` needs the real `transform` passed through
  // (not just baked into `scene.add`) so its own internal zoom-fit
  // projection matches what actually renders — see `frameObject`'s doc.
  function renderPyramidStage(gridCols: number, gridRows: number): string {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const camera = createGlyphOrthographicCamera({ rotX: STAGE_CAMERA_ROT_X, rotY: STAGE_CAMERA_ROT_Y, zoom: STAGE_CAMERA_ZOOM });
    const scene = createGlyphScene(host, { camera, cols: gridCols, rows: gridRows, cellAspect: 2, mode: "solid", useColors: false });
    const polys = shapePolys("pyramid");
    const stageTransform = shapeTransform("pyramid");
    scene.add(polys, stageTransform);
    scene.rerender();
    frameObject(scene, camera, polys, 0.72, false, stageTransform);
    scene.rerender();
    const pre = scene.host.querySelector("pre.glyph-output") as HTMLPreElement;
    const text = pre.textContent ?? "";
    scene.destroy();
    return text;
  }

  it.each([
    { label: "the old arbiter's small fixed grid", gridCols: 96, gridRows: 48 },
    { label: "the live /synth page's measured stage grid (desktop viewport)", gridCols: 135, gridRows: 52 },
    { label: "a much larger grid — proves the fix isn't tuned to one size", gridCols: 260, gridRows: 96 },
  ])("renders a silhouette at the default pose whose bbox ROW centers exactly (solved directly) and whose bbox COL sits within the shape's own measured asymmetry, not several cells off — $label", ({ gridCols, gridRows }) => {
    const text = renderPyramidStage(gridCols, gridRows);
    const lines = text.split("\n");
    expect(lines.length).toBe(gridRows);
    let minCol = Infinity, maxCol = -Infinity, minRow = Infinity, maxRow = -Infinity, covered = 0;
    lines.forEach((line, r) => {
      for (let c = 0; c < line.length; c++) {
        if (line[c] === " ") continue;
        covered++;
        if (c < minCol) minCol = c; if (c > maxCol) maxCol = c;
        if (r < minRow) minRow = r; if (r > maxRow) maxRow = r;
      }
    });
    expect(covered).toBeGreaterThan(0); // the shape actually rendered something
    const bboxColCenter = (minCol + maxCol) / 2;
    const bboxRowCenter = (minRow + maxRow) / 2;
    // ROW: a pure-Z translation is solved to zero this out directly (see
    // `solveVerticalCenteringZ` in synthKit.tsx) — exact regardless of grid
    // size (any residual is float-precision only).
    expect(Math.abs(bboxRowCenter - gridRows / 2)).toBeLessThan(0.1);
    // COL: NOT solved to zero — see this describe block's doc for why a
    // tetrahedron's pixel-silhouette bbox center can't be exactly zeroed
    // without reintroducing lateral drift under orbit. Measured residual is
    // a steady ~4.4-4.8% of grid width across 96/135/260-col grids (a FIXED
    // world-space quantity, so it scales with zoom/grid size in cell terms)
    // — bounded here at 6% with headroom, which still catches a regression
    // to 529a09e/783fa79-style off-axis placement (which measured several
    // TIMES the grid width's worth of residual, not a fraction of it).
    expect(Math.abs(bboxColCenter - gridCols / 2)).toBeLessThan(0.06 * gridCols);
  });

  // The spin-phase sweep: what THIS bug report was actually about. Builds
  // the scene ONCE (one `frameObject` fit, fixing `camera.zoom` exactly like
  // `SynthWorkbench.tsx`'s scene-build effect), then only mutates
  // `camera.rotY` before each render — exactly what the page's orbit tick
  // does (`camera.rotY = camera.rotY + ORBIT_YAW_DEG_PER_SEC * dt * ...`).
  // Tracks the shape's PROJECTED CENTROID (mean of the 4 world vertices,
  // via the real camera's own `project`) rather than the rendered pixel
  // bbox — see this describe block's doc for why the pixel bbox is not a
  // valid stability oracle for a non-centrally-symmetric solid, and the
  // control-shape test below for the same sweep against shapes that ARE
  // centrally symmetric (where pixel bbox and centroid coincide exactly).
  function projectedCentroid(position: readonly [number, number, number], camera: ReturnType<typeof createGlyphOrthographicCamera>, cols: number, rows: number): { col: number; row: number } {
    const [px2, py2, pz2] = position;
    const world: [number, number, number][] = ([[0, 0, 0], [s, 0, 0], [0, s, 0], [0, 0, s]] as [number, number, number][])
      .map((v) => { const [rx, ry, rz] = rotateWorld(v, rotation); return [rx + px2, ry + py2, rz + pz2]; });
    const projected = world.map((v) => camera.project(v, cols, rows, cellAspect));
    return {
      col: projected.reduce((a, p) => a + p[0]!, 0) / 4,
      row: projected.reduce((a, p) => a + p[1]!, 0) / 4,
    };
  }

  it("spin-phase sweep: the pyramid's projected centroid stays within ~1 cell of a fixed point across a full rotY sweep (the fixed point within ~1.5 cells of grid center)", () => {
    const gridCols = 135, gridRows = 52;
    const camera = createGlyphOrthographicCamera({ rotX: STAGE_CAMERA_ROT_X, rotY: STAGE_CAMERA_ROT_Y, zoom: STAGE_CAMERA_ZOOM });
    const cols_: { col: number; row: number }[] = [];
    for (let i = 0; i < 8; i++) {
      camera.rotY = STAGE_CAMERA_ROT_Y + i * 45;
      cols_.push(projectedCentroid(transform.position as [number, number, number], camera, gridCols, gridRows));
    }
    const colValues = cols_.map((c) => c.col), rowValues = cols_.map((c) => c.row);
    const colDrift = Math.max(...colValues) - Math.min(...colValues);
    const rowDrift = Math.max(...rowValues) - Math.min(...rowValues);
    expect(colDrift).toBeLessThan(1);
    expect(rowDrift).toBeLessThan(1);
    const meanCol = colValues.reduce((a, b) => a + b, 0) / colValues.length;
    const meanRow = rowValues.reduce((a, b) => a + b, 0) / rowValues.length;
    expect(Math.abs(meanCol - gridCols / 2)).toBeLessThan(1.5);
    expect(Math.abs(meanRow - gridRows / 2)).toBeLessThan(1.5);
  });

  // Counter-case: pins the sweep test above as meaningful by reproducing
  // 783fa79's actual (pre-fix) solve — bbox-based, allows lateral world X/Y
  // — and confirming that translation FAILS the identical sweep. If a
  // future change to this counter-case ever passed, the sweep test above
  // would no longer be trustworthy.
  it("counter-case: the pre-fix (783fa79) bbox-centered translation FAILS the same spin sweep — the sweep test above is not vacuous", () => {
    const rotatedCorners: [number, number, number][] = ([[0, 0, 0], [s, 0, 0], [0, s, 0], [0, 0, s]] as [number, number, number][])
      .map((v) => rotateWorld(v, rotation));
    // Reproduces `solveScreenCenteringOffset` from 783fa79 exactly (removed
    // from synthKit.tsx by the fix above) — the OLD position, which centers
    // the rotated corners' PROJECTED BBOX at the single default camera pose.
    const probeCamera = createGlyphOrthographicCamera({ rotX: STAGE_CAMERA_ROT_X, rotY: STAGE_CAMERA_ROT_Y, zoom: 1 });
    const metrics = { cellWidth: 1, cellHeight: 1, centerCol: 0, centerRow: 0 };
    const projRaw = (v: [number, number, number]): [number, number, number] => {
      const [c, r, d] = probeCamera.project(v, 2, 2, 1, metrics);
      return [c, r, d ?? 0];
    };
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const v of rotatedCorners) {
      const [x, y] = projRaw(v);
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    const sVec: [number, number, number] = [-(minX + maxX) / 2, -(minY + maxY) / 2, 0];
    const dot = (a: [number, number, number], b: [number, number, number]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const c1 = projRaw([1, 0, 0]), c2 = projRaw([0, 1, 0]), c3 = projRaw([0, 0, 1]);
    const oldPosition: [number, number, number] = [dot(c1, sVec), dot(c2, sVec), dot(c3, sVec)];
    // Sanity: this really is the OLD off-axis translation (nonzero X/Y).
    expect(Math.abs(oldPosition[0])).toBeGreaterThan(0.01);

    const gridCols = 135, gridRows = 52;
    const camera = createGlyphOrthographicCamera({ rotX: STAGE_CAMERA_ROT_X, rotY: STAGE_CAMERA_ROT_Y, zoom: STAGE_CAMERA_ZOOM });
    const colValues: number[] = [];
    for (let i = 0; i < 8; i++) {
      camera.rotY = STAGE_CAMERA_ROT_Y + i * 45;
      colValues.push(projectedCentroid(oldPosition, camera, gridCols, gridRows).col);
    }
    const colDrift = Math.max(...colValues) - Math.min(...colValues);
    expect(colDrift).toBeGreaterThan(1); // fails the <1-cell bound the fix passes
  });

  // Control shapes: NOT `pyramid` (identity transform, no translation at
  // all — see the "is the identity ... for every other stage shape" test
  // above), and each has central inversion symmetry, so their rendered
  // PIXEL SILHOUETTE bbox (not just centroid) is exactly invariant under
  // the identical spin sweep — unchanged before and after this fix, and the
  // reason a full-precision pixel-bbox tolerance is achievable for these
  // shapes but structurally isn't for the pyramid (this describe block's
  // doc).
  it.each(["cube", "icosahedron", "sphere"])("control: %s's rendered pixel-silhouette bbox is exactly unchanged across the same 8-phase rotY sweep", (shape) => {
    const gridCols = 135, gridRows = 52;
    const host = document.createElement("div");
    document.body.appendChild(host);
    const camera = createGlyphOrthographicCamera({ rotX: STAGE_CAMERA_ROT_X, rotY: STAGE_CAMERA_ROT_Y, zoom: STAGE_CAMERA_ZOOM });
    const scene = createGlyphScene(host, { camera, cols: gridCols, rows: gridRows, cellAspect: 2, mode: "solid", useColors: false });
    const polys = shapePolys(shape);
    const stageTransform = shapeTransform(shape);
    expect(stageTransform).toEqual({}); // identity — sanity that this control isn't itself translated
    scene.add(polys, stageTransform);
    scene.rerender();
    frameObject(scene, camera, polys, 0.72, false, stageTransform);
    scene.rerender();

    function bboxCenter(): { col: number; row: number } {
      const pre = scene.host.querySelector("pre.glyph-output") as HTMLPreElement;
      const lines = (pre.textContent ?? "").split("\n");
      let minCol = Infinity, maxCol = -Infinity, minRow = Infinity, maxRow = -Infinity;
      lines.forEach((line, r) => {
        for (let c = 0; c < line.length; c++) {
          if (line[c] === " ") continue;
          if (c < minCol) minCol = c; if (c > maxCol) maxCol = c;
          if (r < minRow) minRow = r; if (r > maxRow) maxRow = r;
        }
      });
      return { col: (minCol + maxCol) / 2, row: (minRow + maxRow) / 2 };
    }

    const first = bboxCenter();
    for (let i = 1; i < 8; i++) {
      camera.rotY = STAGE_CAMERA_ROT_Y + i * 45;
      scene.rerender();
      const b = bboxCenter();
      expect(b.col).toBeCloseTo(first.col, 5);
      expect(b.row).toBeCloseTo(first.row, 5);
    }
    scene.destroy();
  });
});

// VOLUMETRIC-2.md §1: "xray" append-only in whatever list drives the Render
// dropdown.
describe("RENDER_MODES (VOLUMETRIC-2.md §1, new-control wiring)", () => {
  it("appends \"xray\" at the end of RENDER_MODES — append-only, matches the schema enum order in packages/effects/src/stock.ts", () => {
    expect(RENDER_MODES).toEqual(["paint", "carve", "xray"]);
  });
});

// VOLUMETRIC-2.md §2: `step` is selectable on every voice (wave toggle has
// no 2D/3D split), while the three SDF fields are 3D-mapping-only — offered
// via FIELDS_3D exactly like `linearZ` was, not the base 2D `FIELDS` list.
describe("WAVES / FIELDS / FIELDS_3D (VOLUMETRIC-2.md §2, new-control wiring)", () => {
  it("appends \"step\" at the end of WAVES — selectable everywhere, matches the schema enum order", () => {
    expect(WAVES).toEqual(["sin", "triangle", "saw", "square", "step"]);
  });

  it("the base 2D FIELDS list does NOT include the SDF family — they're 3D-mapping-only, like linearZ", () => {
    expect(FIELDS).not.toContain("gyroid");
    expect(FIELDS).not.toContain("menger");
    expect(FIELDS).not.toContain("sierpinski");
    expect(FIELDS).not.toContain("linearZ");
  });

  it("FIELDS_3D appends linearZ then the SDF family, in schema enum order", () => {
    expect(FIELDS_3D).toEqual([...FIELDS, "linearZ", "gyroid", "menger", "sierpinski"]);
  });
});

// VOLUMETRIC-2.md §2: `iter` (recursion depth) only means anything for the
// two fractal-union fields (menger/sierpinski) — gyroid is a smooth implicit
// with no iteration knob.
describe("isSdfField / isSdfIterField (VOLUMETRIC-2.md §2)", () => {
  it("isSdfField is true for gyroid/menger/sierpinski, false for every other field", () => {
    expect(isSdfField("gyroid")).toBe(true);
    expect(isSdfField("menger")).toBe(true);
    expect(isSdfField("sierpinski")).toBe(true);
    for (const field of FIELDS) expect(isSdfField(field)).toBe(false);
    expect(isSdfField("linearZ")).toBe(false);
  });

  it("isSdfIterField is true only for menger/sierpinski, not gyroid", () => {
    expect(isSdfIterField("menger")).toBe(true);
    expect(isSdfIterField("sierpinski")).toBe(true);
    expect(isSdfIterField("gyroid")).toBe(false);
  });
});
