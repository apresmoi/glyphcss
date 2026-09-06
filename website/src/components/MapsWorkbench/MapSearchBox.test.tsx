// @vitest-environment happy-dom
/**
 * The /maps search overlay's own behaviour: lazy loading, type-ahead ranking
 * as the reader sees it, the keyboard model, and selection.
 *
 * `MapsWorkbench.tsx` cannot be mounted under this vitest config (`CodePanel`
 * pulls in `@glyphcss/core`, which `website/package.json` does not declare),
 * so the component is driven in isolation here — the same split every other
 * test in this folder uses.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// The same import-time canvas-measurement stub every LayersPanel test
// installs: the box reuses `mapsKit`'s own `formatPeople`, so that module —
// and through it the Dock's ramp calibration — is loaded here too.
vi.mock("@glyphcss/effects", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@glyphcss/effects")>();
  return { ...actual, calibrateGlyphRamp: () => ({ ramp: " .:-=+*#%@", steps: [] }) };
});

import { MapSearchBox } from "./MapSearchBox";
import { buildMapSearchIndex, type MapSearchIndex, type MapSearchResult } from "./mapsSearch";
import type { GlyphMapVectorFeature } from "@glyphcss/maps";

function point(name: string, lon: number, lat: number, props: Record<string, unknown>): GlyphMapVectorFeature {
  return { id: `${name}@${lon}`, geometryType: "point", properties: { name, ...props }, rings: [[[lon, lat]]] };
}

const INDEX: MapSearchIndex = buildMapSearchIndex({
  countries: [
    point("Japan", 138, 36, { label_priority: 7, iso_a3: "JPN", continent: "Asia" }),
    point("India", 79, 22, { label_priority: 8, iso_a3: "IND", continent: "Asia" }),
  ],
  places: [
    point("Tokyo", 139.75, 35.69, { pop_max: 35_676_000, adm0name: "Japan" }),
    point("Hyderabad", 78.47, 17.4, { pop_max: 6_376_000, adm0name: "India" }),
    point("Hyderabad", 68.37, 25.38, { pop_max: 1_459_000, adm0name: "Pakistan" }),
  ],
  countryPolygons: [],
});

let container: HTMLDivElement | null = null;
let root: Root | null = null;

function mount(props: { loadIndex?: () => Promise<MapSearchIndex> } = {}) {
  const onSelect = vi.fn<(r: MapSearchResult) => void>();
  const loadIndex = props.loadIndex ?? vi.fn(async () => INDEX);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => { root!.render(<MapSearchBox loadIndex={loadIndex} onSelect={onSelect} />); });
  return { onSelect, loadIndex };
}

const input = () => container!.querySelector<HTMLInputElement>("input.maps-search-input")!;
const options = () => [...container!.querySelectorAll<HTMLElement>("[role='option']")];
const optionNames = () => options().map((o) => o.querySelector(".maps-search-name")?.textContent ?? "");

function key(el: HTMLElement, k: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const ev = new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true, ...init });
  act(() => { el.dispatchEvent(ev); });
  return ev;
}

async function type(value: string) {
  const el = input();
  await act(async () => {
    // React 19 tracks the DOM value node; set it through the descriptor so the
    // synthetic `change` event carries the new value.
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

afterEach(() => {
  act(() => { root?.unmount(); });
  container?.remove();
  container = null;
  root = null;
});

describe("MapSearchBox loading", () => {
  it("does not touch the index until the reader engages, and builds it once", async () => {
    const loadIndex = vi.fn(async () => INDEX);
    mount({ loadIndex });
    expect(loadIndex).not.toHaveBeenCalled();

    await act(async () => { input().focus(); });
    expect(loadIndex).toHaveBeenCalledTimes(1);

    await act(async () => { input().blur(); input().focus(); });
    await type("tok");
    expect(loadIndex).toHaveBeenCalledTimes(1);
  });

  it("still answers a query typed before the index resolved", async () => {
    let release!: (i: MapSearchIndex) => void;
    const loadIndex = vi.fn(() => new Promise<MapSearchIndex>((resolve) => { release = resolve; }));
    mount({ loadIndex });
    await type("tok");
    expect(options()).toHaveLength(0);
    await act(async () => { release(INDEX); });
    expect(optionNames()).toEqual(["Tokyo"]);
  });
});

describe("MapSearchBox type-ahead", () => {
  it("ranks the prominent match first and shows the context that disambiguates", async () => {
    mount();
    await type("hyder");
    expect(optionNames()).toEqual(["Hyderabad", "Hyderabad"]);
    const contexts = options().map((o) => o.querySelector(".maps-search-context")?.textContent);
    expect(contexts).toEqual(["India", "Pakistan"]);
  });

  it("puts the country above the city it contains", async () => {
    mount();
    await type("japan");
    expect(optionNames()[0]).toBe("Japan");
  });

  it("says so when nothing matches, instead of showing an empty list", async () => {
    mount();
    await type("zzzz");
    expect(options()).toHaveLength(0);
    expect(container!.querySelector(".maps-search-note")?.textContent).toMatch(/no match/i);
  });
});

describe("MapSearchBox keyboard", () => {
  it("moves through the list with the arrows and selects with Enter", async () => {
    const { onSelect } = mount();
    await type("hyder");
    key(input(), "ArrowDown");
    expect(options()[0].className).toContain("is-active");
    key(input(), "ArrowDown");
    expect(options()[1].className).toContain("is-active");
    key(input(), "ArrowUp");
    expect(options()[0].className).toContain("is-active");

    key(input(), "Enter");
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0][0].context).toBe("India");
  });

  it("wraps at both ends", async () => {
    mount();
    await type("hyder");
    key(input(), "ArrowUp");
    expect(options()[1].className).toContain("is-active");
    key(input(), "ArrowDown");
    expect(options()[0].className).toContain("is-active");
  });

  it("selects the top result when Enter is pressed with nothing highlighted", async () => {
    const { onSelect } = mount();
    await type("hyder");
    key(input(), "Enter");
    expect(onSelect.mock.calls[0][0].context).toBe("India");
  });

  it("closes the list on Escape, then clears the query on a second Escape", async () => {
    mount();
    await type("hyder");
    expect(options()).toHaveLength(2);
    key(input(), "Escape");
    expect(options()).toHaveLength(0);
    expect(input().value).toBe("hyder");
    key(input(), "Escape");
    expect(input().value).toBe("");
  });

  it("keeps its keystrokes to itself so nothing behind the overlay reacts", async () => {
    mount();
    await type("hyder");
    const seen: string[] = [];
    const spy = (e: Event) => seen.push((e as KeyboardEvent).key);
    document.addEventListener("keydown", spy);
    try {
      for (const k of ["ArrowDown", "Enter", "Escape", "/"]) key(input(), k);
    } finally {
      document.removeEventListener("keydown", spy);
    }
    expect(seen).toEqual([]);
  });
});

describe("MapSearchBox selection", () => {
  it("flies on click and closes the list", async () => {
    const { onSelect } = mount();
    await type("hyder");
    act(() => { options()[1].dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0][0].context).toBe("Pakistan");
    expect(options()).toHaveLength(0);
    // The chosen name stays in the field, so the reader can see where they went.
    expect(input().value).toBe("Hyderabad");
  });
});
