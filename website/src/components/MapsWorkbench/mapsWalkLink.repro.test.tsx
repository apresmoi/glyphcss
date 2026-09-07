// @vitest-environment happy-dom
/**
 * A shared `/maps` link that opens IN walk mode, driven against the real
 * `createGlyphMap`.
 *
 * `mapsUrlState.walk.test.ts` pins the wire format and `mapsWalk.link.test.ts`
 * pins the gate; both are pure. What neither can reach is the WIRING — that
 * the flag and the pose the link already carries actually put a walker on the
 * ground facing the right way — and that is where the three things this file
 * exists for live:
 *
 *  1. **The pose survives entry.** `setWalk` stands the walker up looking at
 *     the horizon (`tiltRequest = appliedTilt = 90`) and discards whatever
 *     pitch the camera had, so a link's pitch has to be handed back AFTER
 *     entry or it is silently lost — and lost invisibly, because the walker
 *     still appears at the right place facing the right way.
 *  2. **It survives the widget REBUILD.** `/maps` builds its widget when the
 *     terrain provider resolves and builds it AGAIN when the border provider
 *     does (`MapsWorkbench.tsx`'s construction effect, deps
 *     `[provider, vectorProvider]`). A rebuilt map is not walking, so the
 *     walk effect has to re-enter — and a pitch restored one-shot onto the
 *     FIRST map is restored onto a map that is about to be destroyed.
 *  3. **A forbidden view degrades, and the gate is what makes it safe.**
 *     `map.setWalk` throws a `RangeError` on a flat sheet; the last clause
 *     calls it directly to show the throw is real, so "degrades" is a
 *     property of the gate and not an accident of the fixture.
 *
 * Harness note, same as `mapsExaggerationRebuild.repro.test.tsx`':
 * `MapsWorkbench.tsx` cannot be mounted under this standalone vitest config
 * (it reaches `@glyphcss/core`, which `website/package.json` never declares),
 * so this reproduces the effect SHAPE at issue — the same state
 * initialisation, the same dependency arrays, the same effect bodies —
 * against the REAL widget. The two providers are sentinels rather than real
 * tile sources: what is under test is the rebuild SEQUENCE they cause, and
 * walk mode is deliberately independent of what is mounted (`mapsWalk.ts` —
 * the walker's height comes from the datum when no raster layer is there).
 *
 * happy-dom has no layout, so `stubMonospaceMetrics` gives the widget's
 * hidden cell probes a real advance — the same stub, for the same reason, as
 * every `widget.*.test` in `@glyphcss/maps`.
 */
import { act, useEffect, useMemo, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@glyphcss/effects", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@glyphcss/effects")>();
  return { ...actual, calibrateGlyphRamp: () => ({ ramp: " .:-=+*#%@", steps: [] }) };
});

import { createGlyphMap, type GlyphMapHandle } from "@glyphcss/maps";
import { buildMapProjection, MAP_SCENE_RENDER_MODE } from "./mapsKit";
import { MAPS_URL_DEFAULTS, mapsCodec, type MapsUrlState } from "./mapsUrlState";
import { mapWalkLinkEntry, mapWalkReason } from "./mapsWalk";

const COLS = 140, ROWS = 63, CELL_W = 8, CELL_H = 16, PROBE_FONT_PX = 16;

function rect(width: number, height: number): DOMRect {
  return { width, height, top: 0, left: 0, right: width, bottom: height, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
}
const EMPTY_RECT = rect(0, 0);
const stubbedHosts = new Set<HTMLElement>();
function stubMonospaceMetrics(host: HTMLElement): void {
  stubbedHosts.add(host);
  if (vi.isMockFunction(Element.prototype.getBoundingClientRect)) return;
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const el = this as HTMLElement;
    if (stubbedHosts.has(el)) return rect(COLS * CELL_W, ROWS * CELL_H);
    if (el.tagName !== "PRE" || !/visibility:\s*hidden/.test(el.style.cssText)) return EMPTY_RECT;
    const fontPx = parseFloat(/font-size:\s*([\d.]+)px/.exec(el.style.cssText)?.[1] ?? String(PROBE_FONT_PX));
    const k = fontPx / PROBE_FONT_PX;
    const lines = (el.textContent ?? "").split("\n").length || 1;
    return rect(CELL_W * k, CELL_H * k * lines);
  });
}

/**
 * `MapsWorkbench.tsx`'s walk wiring: the link-seeded `walkOn` state, the
 * link-pitch ref, the widget-construction effect and the walk effect, each
 * with its real dependency array.
 */
function Harness({ link, onMap }: { readonly link: MapsUrlState; readonly onMap: (map: GlyphMapHandle) => void }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<GlyphMapHandle | null>(null);
  // The two async providers, in the order `/maps` resolves them.
  const [provider, setProvider] = useState<string | null>(null);
  const [vectorProvider, setVectorProvider] = useState<string | null>(null);

  const walkLink = useMemo(
    () => mapWalkLinkEntry({ walk: link.walk, projectionId: link.projection, span: link.span, tilt: link.tilt }),
    [link],
  );
  const [walkOn, setWalkOn] = useState(walkLink.walking);
  const linkWalkTiltRef = useRef<number | null>(walkLink.tilt);
  const [tilt, setTilt] = useState(link.tilt);
  const walkGateReason = mapWalkReason({ projectionId: link.projection, span: link.span });

  useEffect(() => { setProvider("terrain"); }, []);
  useEffect(() => {
    const id = setTimeout(() => setVectorProvider("borders"), 0);
    return () => clearTimeout(id);
  }, []);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !provider) return;
    stubMonospaceMetrics(host);
    const map = createGlyphMap(host, {
      view: { center: [link.centerLon, link.centerLat], span: link.span, cols: COLS, rows: ROWS },
      projection: buildMapProjection(link.projection, link.exaggeration),
      tilt,
      bearing: link.bearing,
      layers: [{ type: "background", id: "bg", color: "#000000" }],
      scene: { mode: MAP_SCENE_RENDER_MODE, useColors: false },
    });
    mapRef.current = map;
    onMap(map);
    return () => { map.destroy(); mapRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider, vectorProvider]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (walkOn && walkGateReason === null) {
      if (!map.getWalk()) {
        map.setWalk({});
        const linkTilt = linkWalkTiltRef.current;
        if (linkTilt !== null) {
          map.setTilt(linkTilt);
          setTilt(map.getTilt());
        }
      }
      return;
    }
    linkWalkTiltRef.current = null;
    if (map.getWalk()) map.setWalk(null);
    if (walkOn) setWalkOn(false);
  }, [walkOn, walkGateReason, provider, vectorProvider]);

  return <div ref={hostRef} />;
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

/** Mount the harness on a decoded link and settle both provider builds. */
async function open(link: MapsUrlState): Promise<GlyphMapHandle> {
  container = document.createElement("div");
  document.body.appendChild(container);
  const seen: GlyphMapHandle[] = [];
  await act(async () => {
    root = createRoot(container!);
    root.render(<Harness link={link} onMap={(m) => seen.push(m)} />);
  });
  // The second (border-provider) build.
  await act(async () => { await new Promise((r) => setTimeout(r, 1)); });
  expect(seen.length).toBe(2); // the rebuild this file exists to survive
  return seen[seen.length - 1]!;
}

afterEach(() => {
  act(() => { root?.unmount(); });
  root = null;
  container?.remove();
  container = null;
  stubbedHosts.clear();
  vi.restoreAllMocks();
});

/** A real walk link: standing in Zurich at the walker's own footprint span, facing ESE, looking 16 degrees down. */
const WALK_LINK: MapsUrlState = {
  ...MAPS_URL_DEFAULTS,
  walk: true,
  projection: "globe",
  centerLon: 8.541694,
  centerLat: 47.376888,
  span: 0.0071944,
  tilt: 74,
  bearing: 113,
};

describe("/maps — a link that opens in walk mode", () => {
  it("puts the reader back where the walker stood, facing the same way, through the whole encode/decode round trip", async () => {
    const decoded = { ...MAPS_URL_DEFAULTS, ...mapsCodec.decode(mapsCodec.encode(WALK_LINK)) };
    const map = await open(decoded);

    const walk = map.getWalk();
    expect(walk).not.toBeNull();
    expect(walk!.center[0]).toBeCloseTo(WALK_LINK.centerLon, 5);
    expect(walk!.center[1]).toBeCloseTo(WALK_LINK.centerLat, 5);
    expect(walk!.heading).toBeCloseTo(WALK_LINK.bearing, 5);
    // The pitch, both as the widget reports it and as walk mode means it:
    // `getTilt()` is measured from the horizontal's 90.
    expect(map.getTilt()).toBeCloseTo(74, 5);
    expect(walk!.pitch).toBeCloseTo(-16, 5);
  });

  it("keeps the pitch across the widget rebuild the second provider causes", async () => {
    // The proof is that `open()` above asserts TWO maps were built and this
    // reads the LAST one: a pitch restored only onto the first is restored
    // onto a map that has already been destroyed.
    const map = await open(WALK_LINK);
    expect(map.getWalk()).not.toBeNull();
    expect(map.getTilt()).toBeCloseTo(74, 5);
  });

  it("opens level when the link carries no pitch of its own", async () => {
    // `tilt` at the schema default means the link says nothing about pitch —
    // and the default (40) is a legal walk pitch, so it is applied as one
    // rather than special-cased. What must NOT happen is a throw or a
    // refusal.
    const map = await open({ ...WALK_LINK, tilt: MAPS_URL_DEFAULTS.tilt });
    expect(map.getWalk()).not.toBeNull();
    expect(map.getTilt()).toBeCloseTo(MAPS_URL_DEFAULTS.tilt, 5);
  });

  it("degrades to the ordinary map when the link's view is too far out", async () => {
    const map = await open({ ...WALK_LINK, span: 140 });
    expect(map.getWalk()).toBeNull();
    expect(map.getView().span).toBeCloseTo(140, 3);
  });

  it("degrades on a flat sheet — where entering would THROW, not merely look wrong", async () => {
    const map = await open({ ...WALK_LINK, projection: "equirectangular" });
    expect(map.getWalk()).toBeNull();
    // The gate is load-bearing, not decorative: this is what the page would
    // have called without it.
    expect(() => map.setWalk({})).toThrow(RangeError);
  });
});
