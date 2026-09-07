// @vitest-environment happy-dom
/**
 * The /maps search overlay's REMOTE half, as a reader meets it: a landmark or
 * a street query reaching OpenStreetMap, the two halves of the list blended
 * and labelled, the disclosure and the credit, and — the part that matters
 * most — what happens when the geocoder is not there.
 *
 * The transport is injected in every test here. Nothing touches the network:
 * the bodies replayed are the recorded ones under `fixtures/photon/`, parsed
 * through the same `parseMapGeocodeBody` the page uses.
 *
 * `MapsWorkbench.tsx` cannot be mounted under this vitest config (`CodePanel`
 * pulls in `@glyphcss/core`, which `website/package.json` does not declare),
 * so the component is driven in isolation — the same split every other test in
 * this folder uses.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@glyphcss/effects", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@glyphcss/effects")>();
  return { ...actual, calibrateGlyphRamp: () => ({ ramp: " .:-=+*#%@", steps: [] }) };
});

import { MapSearchBox } from "./MapSearchBox";
import { buildMapSearchIndex, mapSearchFlyTarget, MAP_SEARCH_OSM_SPAN, type MapSearchResult } from "./mapsSearch";
import {
  MAP_GEOCODE_DEBOUNCE_MS,
  parseMapGeocodeBody,
  type MapGeocodeOutcome,
  type MapGeocodeRequest,
} from "./mapsGeocode";
import type { GlyphMapVectorFeature } from "@glyphcss/maps";

const FIXTURES = path.resolve(__dirname, "fixtures/photon");
function recordedResults(name: string): readonly MapSearchResult[] {
  const rec = JSON.parse(readFileSync(path.join(FIXTURES, `${name}.json`), "utf8")) as { body: unknown };
  return parseMapGeocodeBody(rec.body)!;
}

function point(name: string, lon: number, lat: number, props: Record<string, unknown>): GlyphMapVectorFeature {
  return { id: `${name}@${lon}`, geometryType: "point", properties: { name, ...props }, rings: [[[lon, lat]]] };
}

/** Two countries and two cities — enough that "paris" has an EXACT local answer and "eiffel tower" has none. */
const INDEX = buildMapSearchIndex({
  countries: [point("France", 2, 47, { label_priority: 7, iso_a3: "FRA", continent: "Europe" })],
  places: [
    point("Paris", 2.35, 48.86, { pop_max: 10_843_000, adm0name: "France" }),
    point("Buenos Aires", -58.4, -34.6, { pop_max: 12_795_000, adm0name: "Argentina" }),
  ],
  countryPolygons: [],
});

let container: HTMLDivElement | null = null;
let root: Root | null = null;

interface MountOptions {
  readonly geocode?: (request: MapGeocodeRequest) => Promise<MapGeocodeOutcome>;
  readonly getView?: () => { lon: number; lat: number; span: number } | null;
}

function mount(opts: MountOptions = {}) {
  const onSelect = vi.fn<(r: MapSearchResult) => void>();
  const geocode = vi.fn(opts.geocode ?? (async (): Promise<MapGeocodeOutcome> => ({ kind: "ok", results: [] })));
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <MapSearchBox loadIndex={async () => INDEX} onSelect={onSelect} geocode={geocode} getView={opts.getView} />,
    );
  });
  return { onSelect, geocode };
}

const input = () => container!.querySelector<HTMLInputElement>("input.maps-search-input")!;
const options = () => [...container!.querySelectorAll<HTMLElement>("[role='option']")];
const optionNames = () => options().map((o) => o.querySelector(".maps-search-name")?.textContent ?? "");
const note = () => container!.querySelector(".maps-search-note")?.textContent ?? "";
const egress = () => container!.querySelector(".maps-search-egress");
const groups = () => [...container!.querySelectorAll(".maps-search-group")].map((g) => g.textContent);

async function type(value: string) {
  const el = input();
  await act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** Let the debounce elapse and the injected promise settle. */
async function settle() {
  await act(async () => { await vi.advanceTimersByTimeAsync(MAP_GEOCODE_DEBOUNCE_MS + 10); });
  await act(async () => { await Promise.resolve(); });
}

/** Focus, wait for the lazy local index, then type. */
async function engage(query: string) {
  await act(async () => { input().focus(); });
  await type(query);
}

beforeEach(() => { vi.useFakeTimers(); });

afterEach(() => {
  act(() => { root?.unmount(); });
  container?.remove();
  container = null;
  root = null;
  vi.useRealTimers();
});

describe("a landmark the baked pyramids cannot know about", () => {
  it("finds the Eiffel Tower, under its own heading, and flies there", async () => {
    const { onSelect, geocode } = mount({
      geocode: async () => ({ kind: "ok", results: recordedResults("eiffel-tower-paris") }),
    });
    await engage("eiffel tower");
    // Local answers nothing, and says so — but only until the remote lands.
    expect(optionNames()).toEqual([]);
    await settle();

    expect(geocode).toHaveBeenCalledTimes(1);
    expect(geocode.mock.calls[0][0].query).toBe("eiffel tower");
    expect(groups()).toEqual(["OpenStreetMap"]);
    expect(optionNames()[0]).toBe("Eiffel Tower");
    expect(options()[0].querySelector(".maps-search-context")?.textContent).toBe("Paris, France");
    expect(options()[0].querySelector(".maps-search-metric")?.textContent).toBe("tower");

    act(() => { options()[0].dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(onSelect).toHaveBeenCalledTimes(1);
    const chosen = onSelect.mock.calls[0][0];
    expect(chosen.kind).toBe("osm");
    const target = mapSearchFlyTarget(chosen);
    expect(target.span).toBe(MAP_SEARCH_OSM_SPAN);
    expect(target.center?.[0]).toBeCloseTo(2.2945, 3);
    expect(target.center?.[1]).toBeCloseTo(48.8583, 3);
  });

  it("finds a street the same way", async () => {
    const { onSelect } = mount({
      geocode: async () => ({ kind: "ok", results: recordedResults("avenida-corrientes") }),
    });
    await engage("avenida corrientes");
    await settle();
    expect(optionNames()).toEqual(["Avenida Corrientes", "Avenida Corrientes"]);
    act(() => { options()[0].dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    const target = mapSearchFlyTarget(onSelect.mock.calls[0][0]);
    expect(target.span).toBe(MAP_SEARCH_OSM_SPAN);
    expect(target.center?.[0]).toBeCloseTo(-58.39, 2);
  });

  it("lists the local hits FIRST and appends the OSM ones, so the reader can tell them apart", async () => {
    mount({ geocode: async () => ({ kind: "ok", results: recordedResults("obelisco-buenos-aires") }) });
    // "buenos" is a PREFIX of the baked city, not its whole name, so the
    // remote half is not suppressed and both halves are on screen at once.
    await engage("buenos");
    await settle();
    // The baked city, then the divider, then whatever OSM had.
    expect(optionNames()[0]).toBe("Buenos Aires");
    expect(options()[0].querySelector(".maps-search-metric")?.className).toContain("--place");
    expect(groups()).toEqual(["OpenStreetMap"]);
    const list = container!.querySelector(".maps-search-list")!;
    const kids = [...list.children].map((c) => c.className);
    expect(kids.indexOf("maps-search-group")).toBe(1);
    expect(options().slice(1).every((o) => o.querySelector(".maps-search-metric")!.className.includes("--osm"))).toBe(true);
  });
});

describe("biasing by what the reader is looking at", () => {
  it("reads the view at REQUEST time, not at render time", async () => {
    let span = 360;
    const { geocode } = mount({
      geocode: async () => ({ kind: "ok", results: [] }),
      getView: () => ({ lon: -58.44, lat: -34.6, span }),
    });
    await engage("obelisco");
    span = 0.5; // the reader zoomed in while the debounce was still running
    await settle();
    expect(geocode.mock.calls[0][0].view).toEqual({ lon: -58.44, lat: -34.6, span: 0.5 });
  });
});

describe("failure leaves the local results standing", () => {
  it("keeps the baked rows and says so quietly when the geocoder is down", async () => {
    mount({ geocode: async () => ({ kind: "failed", reason: "OpenStreetMap search unavailable" }) });
    await engage("buenos");
    await settle();
    // The baked city is still there, and the list did not go blank or hang.
    expect(optionNames()).toEqual(["Buenos Aires"]);
    expect(groups()).toEqual([]);
    expect(note()).toMatch(/unavailable.*countries and cities only/i);
  });

  it("survives a transport that REJECTS rather than reporting, and still says so quietly", async () => {
    mount({
      geocode: async () => { throw new Error("this must never escape"); },
      getView: () => ({ lon: 2.35, lat: 48.86, span: 0.5 }),
    });
    await engage("eiffel tower");
    await settle();
    // No unhandled rejection, no spinner left running, no blank list — the
    // same quiet note a reported failure produces.
    expect(note()).toMatch(/unavailable.*countries and cities only/i);
  });
});

describe("being a good citizen of a free service", () => {
  it("sends nothing until the query is long enough", async () => {
    const { geocode } = mount();
    await engage("ei");
    await settle();
    expect(geocode).not.toHaveBeenCalled();
    await type("eif");
    await settle();
    expect(geocode).toHaveBeenCalledTimes(1);
  });

  it("sends nothing at all for a query the baked index already answers exactly", async () => {
    const { geocode } = mount();
    await engage("paris");
    await settle();
    expect(optionNames()).toEqual(["Paris"]);
    expect(geocode).not.toHaveBeenCalled();
  });

  it("sends ONE request for a phrase typed straight through, not one per keystroke", async () => {
    const { geocode } = mount();
    await act(async () => { input().focus(); });
    for (const q of ["obe", "obel", "obeli", "obelis", "obelisc", "obelisco"]) {
      await type(q);
      await act(async () => { await vi.advanceTimersByTimeAsync(MAP_GEOCODE_DEBOUNCE_MS - 60); });
    }
    await settle();
    expect(geocode).toHaveBeenCalledTimes(1);
    expect(geocode.mock.calls[0][0].query).toBe("obelisco");
  });

  it("ABORTS the in-flight request when the query changes", async () => {
    const signals: AbortSignal[] = [];
    const { geocode } = mount({
      geocode: async (request) => {
        signals.push(request.signal!);
        return new Promise<MapGeocodeOutcome>(() => {}); // never settles
      },
    });
    await engage("eiffel tower");
    await act(async () => { await vi.advanceTimersByTimeAsync(MAP_GEOCODE_DEBOUNCE_MS + 10); });
    expect(signals).toHaveLength(1);
    expect(signals[0].aborted).toBe(false);

    await type("obelisco");
    expect(signals[0].aborted).toBe(true);
    await settle();
    expect(geocode).toHaveBeenCalledTimes(2);
    expect(signals[1].aborted).toBe(false);
  });

  it("drops the in-flight request when the list closes", async () => {
    const signals: AbortSignal[] = [];
    mount({
      geocode: async (request) => { signals.push(request.signal!); return new Promise<MapGeocodeOutcome>(() => {}); },
    });
    await engage("eiffel tower");
    await act(async () => { await vi.advanceTimersByTimeAsync(MAP_GEOCODE_DEBOUNCE_MS + 10); });
    expect(signals[0].aborted).toBe(false);
    await act(async () => { input().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    expect(signals[0].aborted).toBe(true);
  });

  it("does not re-query the name it just filled in after a selection", async () => {
    const { geocode } = mount({
      geocode: async () => ({ kind: "ok", results: recordedResults("eiffel-tower-paris") }),
    });
    await engage("eiffel tower");
    await settle();
    expect(geocode).toHaveBeenCalledTimes(1);
    act(() => { options()[0].dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    await settle();
    expect(geocode).toHaveBeenCalledTimes(1);
  });
});

describe("saying that the query leaves the machine", () => {
  it("names the service and credits OpenStreetMap from the moment the box is focused", async () => {
    mount();
    expect(egress()).toBeNull();
    await act(async () => { input().focus(); });
    const line = egress()!;
    // Before a single keystroke — a disclosure that only appears after the
    // request has gone is not a disclosure.
    expect(input().value).toBe("");
    expect(line.textContent).toMatch(/what you type is sent there/i);
    const links = [...line.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(links).toContain("https://photon.komoot.io");
    expect(links).toContain("https://www.openstreetmap.org/copyright");
    expect(line.textContent).toContain("OpenStreetMap contributors (ODbL)");
  });

  it("says so in the field's own placeholder and title too", () => {
    mount();
    expect(input().placeholder).toMatch(/street|landmark/i);
    expect(input().title).toMatch(/photon\.komoot\.io/);
  });
});
