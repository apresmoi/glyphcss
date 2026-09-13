// @vitest-environment happy-dom
/**
 * The dataset search box's own behaviour in isolation — suggestions,
 * "Recent", the live-search debounce, a pasted URL/id short-circuiting the
 * search, and the keyboard model — mirroring
 * `MapsWorkbench/MapSearchBox.test.tsx`'s own structure and
 * `MapSearchBox.geocode.test.tsx`'s fake-timer debounce idiom. No network:
 * `search`/`suggestions`/`recent` are always injected.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChartsDatasetSearchBox, CHARTS_DATASET_SEARCH_DEBOUNCE_MS } from "./ChartsDatasetSearchBox";
import type { DatasetHit } from "../../lib/datasetSearch";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SUGGESTIONS: readonly DatasetHit[] = [
  { id: "mstz/titanic", kind: "hf", ref: "mstz/titanic", title: "Titanic survival", url: "https://huggingface.co/datasets/mstz/titanic" },
  { id: "mstz/wine", kind: "hf", ref: "mstz/wine", title: "Wine quality", url: "https://huggingface.co/datasets/mstz/wine" },
];

let container: HTMLDivElement | null = null;
let root: Root | null = null;

function mount(props: { search?: ReturnType<typeof vi.fn>; recent?: () => readonly DatasetHit[] } = {}) {
  const onSelect = vi.fn<(hit: DatasetHit) => void>();
  const search = props.search ?? vi.fn(async () => []);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(<ChartsDatasetSearchBox onSelect={onSelect} search={search} suggestions={SUGGESTIONS} recent={props.recent ?? (() => [])} />);
  });
  return { onSelect, search };
}

const input = () => container!.querySelector<HTMLInputElement>(".charts-dataset-search-input")!;
const options = () => [...container!.querySelectorAll<HTMLElement>("[role='option']")];
const optionNames = () => options().map((o) => o.querySelector(".charts-dataset-search-name")?.textContent ?? "");

function key(el: HTMLElement, k: string): void {
  act(() => { el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true })); });
}

async function type(value: string) {
  const el = input();
  await act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => {
  act(() => { root?.unmount(); });
  container?.remove();
  container = null;
  root = null;
  vi.useRealTimers();
});

describe("ChartsDatasetSearchBox — suggestions and Recent", () => {
  it("shows the curated suggestions on focus with an empty query, with no search call", async () => {
    const { search } = mount();
    await act(async () => { input().focus(); input().dispatchEvent(new Event("focus", { bubbles: true })); });
    expect(optionNames()).toEqual(["Titanic survival", "Wine quality"]);
    expect(search).not.toHaveBeenCalled();
  });

  it("lists Recent above Suggested, de-duplicated by ref", async () => {
    const recentHit: DatasetHit = { id: "mstz/wine", kind: "hf", ref: "mstz/wine", title: "Wine quality", url: "https://huggingface.co/datasets/mstz/wine" };
    mount({ recent: () => [recentHit] });
    await act(async () => { input().focus(); input().dispatchEvent(new Event("focus", { bubbles: true })); });
    // "Wine quality" appears once (as Recent), not twice (Recent + Suggested).
    expect(optionNames()).toEqual(["Wine quality", "Titanic survival"]);
    expect(container!.querySelector(".charts-dataset-search-group")?.textContent).toBe("Recent");
  });
});

describe("ChartsDatasetSearchBox — live search debounce", () => {
  it("debounces the live call and shows results once it resolves", async () => {
    const search = vi.fn(async () => [{ id: "x/y", kind: "hf" as const, ref: "x/y", title: "X Y Dataset", url: "https://huggingface.co/datasets/x/y" }]);
    mount({ search });
    await type("iris flowers"); // not a parseable URL/id — a genuine search phrase
    expect(search).not.toHaveBeenCalled(); // not yet — still inside the debounce window
    await act(async () => { await vi.advanceTimersByTimeAsync(CHARTS_DATASET_SEARCH_DEBOUNCE_MS + 10); });
    expect(search).toHaveBeenCalledTimes(1);
    expect(search).toHaveBeenCalledWith("iris flowers", expect.objectContaining({ signal: expect.anything() }));
    expect(optionNames()).toEqual(["X Y Dataset"]);
  });

  it("resets the debounce on every keystroke — only the FINAL query is searched", async () => {
    const search = vi.fn(async () => []);
    mount({ search });
    await type("ir");
    await act(async () => { await vi.advanceTimersByTimeAsync(CHARTS_DATASET_SEARCH_DEBOUNCE_MS - 50); });
    await type("iris");
    await act(async () => { await vi.advanceTimersByTimeAsync(CHARTS_DATASET_SEARCH_DEBOUNCE_MS + 10); });
    expect(search).toHaveBeenCalledTimes(1);
    expect(search).toHaveBeenCalledWith("iris", expect.anything());
  });

  it("says so when the live search answers nothing", async () => {
    mount({ search: vi.fn(async () => []) });
    await type("zzzznotreal");
    await act(async () => { await vi.advanceTimersByTimeAsync(CHARTS_DATASET_SEARCH_DEBOUNCE_MS + 10); });
    expect(options()).toHaveLength(0);
    expect(container!.querySelector(".charts-dataset-search-note")?.textContent).toMatch(/no match/i);
  });
});

describe("ChartsDatasetSearchBox — pasted URL/id short-circuits search", () => {
  it("a bare org/name id shows exactly one 'Load' result and never calls search", async () => {
    const search = vi.fn(async () => []);
    mount({ search });
    await type("mstz/heart");
    await act(async () => { await vi.advanceTimersByTimeAsync(CHARTS_DATASET_SEARCH_DEBOUNCE_MS + 10); });
    expect(search).not.toHaveBeenCalled();
    expect(options()).toHaveLength(1);
    expect(optionNames()[0]).toContain("mstz/heart");
  });

  it("a pasted raw GitHub CSV URL shows one result too", async () => {
    mount();
    await type("https://raw.githubusercontent.com/o/r/main/d.csv");
    expect(options()).toHaveLength(1);
  });
});

describe("ChartsDatasetSearchBox — keyboard", () => {
  it("moves through the list with the arrows and selects with Enter", async () => {
    const { onSelect } = mount();
    await act(async () => { input().focus(); input().dispatchEvent(new Event("focus", { bubbles: true })); });
    key(input(), "ArrowDown");
    expect(options()[0]!.className).toContain("is-active");
    key(input(), "ArrowDown");
    expect(options()[1]!.className).toContain("is-active");
    key(input(), "Enter");
    expect(onSelect).toHaveBeenCalledWith(SUGGESTIONS[1]);
  });

  it("Enter with nothing highlighted picks the first result", async () => {
    const { onSelect } = mount();
    await act(async () => { input().focus(); input().dispatchEvent(new Event("focus", { bubbles: true })); });
    key(input(), "Enter");
    expect(onSelect).toHaveBeenCalledWith(SUGGESTIONS[0]);
  });

  it("Escape closes the open list, then clears the field on a second press", async () => {
    mount();
    await type("wine");
    await act(async () => { await vi.advanceTimersByTimeAsync(CHARTS_DATASET_SEARCH_DEBOUNCE_MS + 10); });
    key(input(), "Escape");
    expect(options()).toHaveLength(0);
    expect(input().value).toBe("wine");
    key(input(), "Escape");
    expect(input().value).toBe("");
  });

  it("wraps at both ends of the list", async () => {
    mount();
    await act(async () => { input().focus(); input().dispatchEvent(new Event("focus", { bubbles: true })); });
    key(input(), "ArrowUp"); // from -1, wraps to the LAST option
    expect(options()[1]!.className).toContain("is-active");
    key(input(), "ArrowDown");
    expect(options()[0]!.className).toContain("is-active"); // wraps back to the first
  });
});
