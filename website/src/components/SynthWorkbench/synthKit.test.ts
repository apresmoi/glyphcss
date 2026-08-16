import { describe, expect, it, vi } from "vitest";
import { GlyphFieldSynthEffect as fieldSynth } from "@glyphcss/effects";
import { compileScene, createGlyphOrthographicCamera } from "glyphcss";
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
  isSdfField,
  isSdfIterField,
  resolveInkControlVisibility,
  resolveSpaceChange,
  shapePolys,
  shapeTransform,
  soloParams,
  stagePreviewShape,
  synthDefaults,
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
  it("rotates the apex above a ground-parallel base (world +Z) and centers the ROTATED shape's bbox near the origin, while object-space vertices (objectVertices) stay exactly the uncentered corner form", () => {
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

    // bbox center of the 4 (rotated, translated) vertices is within
    // floating-point epsilon of the origin.
    for (let axis = 0; axis < 3; axis++) {
      const vals = [worldO[axis]!, worldA[axis]!, worldB[axis]!, worldC[axis]!];
      const center = (Math.min(...vals) + Math.max(...vals)) / 2;
      expect(center).toBeCloseTo(0, 8);
    }
  });

  it("is the identity (no position/rotation) for every other stage shape", () => {
    for (const shape of SHAPES) {
      if (shape === "pyramid") continue;
      expect(shapeTransform(shape)).toEqual({});
    }
  });
});

// The arbiter for "does this actually look upright" cannot be the hand-rolled
// `rotateWorld` matrix reproduction above — that only proves the transform is
// internally self-consistent with its OWN re-derivation of `applyTransform`'s
// math, not that it renders correctly. A prior version of this fix (43026ff)
// shipped exactly that kind of test, targeted world +Y as "up", and passed —
// while the live page rendered an irregular, uncentered blob, because the
// camera every mesh is actually projected through
// (`createGlyphOrthographicCamera`, packages/glyphcss/src/api/
// createGlyphCamera.ts) does NOT treat +Y as its vertical axis; see
// `alignCornerTetraApexEuler`'s doc in synthKit.tsx for the full derivation.
//
// This suite instead runs the stage mesh through the REAL renderer: the real
// `createGlyphOrthographicCamera` (same package export the page itself uses)
// at the page's actual default stage camera (`STAGE_CAMERA_ROT_X/Y/ZOOM`,
// shared with SynthWorkbench.tsx so neither can drift from the other), and
// the real `compileScene` rasterizer for the rendered-silhouette assertion.
// `applyTransform` itself is a private, unexported function of
// `createGlyphScene.ts`, so `rotateWorld` above (already verified byte-for-
// byte matching its composition order) is reused to build WORLD vertices —
// but every assertion below runs those vertices through actual glyphcss
// renderer code, not further hand math.
describe("shapeTransform(\"pyramid\") through the real renderer (arbiter, not self-consistency)", () => {
  const s = PYRAMID_STAGE_SIZE;
  const transform = shapeTransform("pyramid");
  const rotation = transform.rotation as [number, number, number];
  const [px, py, pz] = transform.position as [number, number, number];
  const applyPoint = (v: readonly [number, number, number]): [number, number, number] => {
    const [rx, ry, rz] = rotateWorld(v, rotation);
    return [rx + px, ry + py, rz + pz];
  };
  const cols = 96, rows = 48, cellAspect = 2;

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

  it("renders a silhouette (through the real compileScene rasterizer) whose bbox center lands within ~1 cell of the grid center", () => {
    const camera = createGlyphOrthographicCamera({ rotX: STAGE_CAMERA_ROT_X, rotY: STAGE_CAMERA_ROT_Y, zoom: STAGE_CAMERA_ZOOM });
    const worldPolys = (shapePolys("pyramid") as unknown as { vertices: [number, number, number][] }[])
      .map((p) => ({ vertices: p.vertices.map(applyPoint) }));
    const result = compileScene({ polygons: worldPolys as never, camera, cols, rows, cellAspect, mode: "solid", useColors: false });

    const lines = result.inner.split("\n");
    expect(lines.length).toBe(rows);
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
    expect(Math.abs(bboxColCenter - cols / 2)).toBeLessThan(1);
    expect(Math.abs(bboxRowCenter - rows / 2)).toBeLessThan(1);
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
