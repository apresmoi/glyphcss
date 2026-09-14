// @vitest-environment happy-dom
/**
 * The dataset search box's own behaviour in isolation — the Built-in
 * browse group, curated "Hugging Face" suggestions, "Recent", the
 * live-search debounce merging into the curated group, a pasted URL/id
 * short-circuiting the search, the idle-title display, and the keyboard
 * model — mirroring `MapsWorkbench/MapSearchBox.test.tsx`'s own structure
 * and `MapSearchBox.geocode.test.tsx`'s fake-timer debounce idiom. No
 * network: `search`/`suggestions`/`recent` are always injected.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChartsDatasetSearchBox, CHARTS_DATASET_SEARCH_DEBOUNCE_MS } from "./ChartsDatasetSearchBox";
import type { DatasetHit } from "../../lib/datasetSearch";
import type { ChartsDataset } from "./datasets";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function builtInDataset(id: string, title: string): ChartsDataset {
  return {
    id, title, description: `${title} description`,
    source: { name: "Test source", url: "https://example.com", licence: "CC0" },
    columns: ["x", "y"], rows: [],
    recommended: { mark: "line", x: "x", y: "y" },
  };
}

const BUILT_IN: readonly ChartsDataset[] = [
  builtInDataset("alpha-counts", "Alpha counts"),
  builtInDataset("beta-shares", "Beta shares"),
];

const SUGGESTIONS: readonly DatasetHit[] = [
  { id: "mstz/titanic", kind: "hf", ref: "mstz/titanic", title: "Titanic survival", url: "https://huggingface.co/datasets/mstz/titanic" },
  { id: "mstz/wine", kind: "hf", ref: "mstz/wine", title: "Wine quality", url: "https://huggingface.co/datasets/mstz/wine" },
];

let container: HTMLDivElement | null = null;
let root: Root | null = null;

function mount(props: { search?: ReturnType<typeof vi.fn>; recent?: () => readonly DatasetHit[]; loadedTitle?: string; builtIn?: readonly ChartsDataset[] } = {}) {
  const onSelectBuiltIn = vi.fn<(id: string) => void>();
  const onSelectRemote = vi.fn<(hit: DatasetHit) => void>();
  const search = props.search ?? vi.fn(async () => []);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(<ChartsDatasetSearchBox
      builtIn={props.builtIn ?? BUILT_IN}
      loadedTitle={props.loadedTitle ?? ""}
      onSelectBuiltIn={onSelectBuiltIn}
      onSelectRemote={onSelectRemote}
      search={search}
      suggestions={SUGGESTIONS}
      recent={props.recent ?? (() => [])}
    />);
  });
  return { onSelectBuiltIn, onSelectRemote, search };
}

const input = () => container!.querySelector<HTMLInputElement>(".instrument-search-input")!;
const chevron = () => container!.querySelector<HTMLButtonElement>('[aria-label="Browse datasets"]')!;
const options = () => [...container!.querySelectorAll<HTMLElement>("[role='option']")];
const optionNames = () => options().map((o) => o.querySelector(".instrument-search-name")?.textContent ?? "");
const groupHeadings = () => [...container!.querySelectorAll(".instrument-search-group")].map((n) => n.textContent);

function key(el: HTMLElement, k: string): void {
  act(() => { el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true })); });
}

async function focus() {
  await act(async () => { input().focus(); input().dispatchEvent(new Event("focus", { bubbles: true })); });
}

async function blur() {
  // The native `.blur()` call is what actually fires happy-dom's focus
  // machinery (a bare `dispatchEvent(new Event("blur"))` does not) — same
  // idiom `MapSearchBox.test.tsx` uses.
  await act(async () => { input().blur(); });
  // The close/settle is deferred one macrotask (mirrors `MapSearchBox`'s
  // own click-before-blur allowance) — flush it under fake timers too.
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
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

describe("ChartsDatasetSearchBox — Built-in + suggestions + Recent", () => {
  it("the chevron opens the browse list with Built-in first, then Hugging Face, with no search call", async () => {
    const { search } = mount();
    expect(options()).toHaveLength(0);
    act(() => chevron().click());
    expect(optionNames()).toEqual(["Alpha counts", "Beta shares", "Titanic survival", "Wine quality"]);
    expect(groupHeadings()).toEqual(["Built-in", "Hugging Face"]);
    expect(search).not.toHaveBeenCalled();
  });

  it("focusing an empty field opens the same browse list as the chevron", async () => {
    mount();
    await focus();
    expect(optionNames()).toEqual(["Alpha counts", "Beta shares", "Titanic survival", "Wine quality"]);
  });

  it("lists Built-in, then Recent, then Suggested, de-duplicated by ref", async () => {
    const recentHit: DatasetHit = { id: "mstz/wine", kind: "hf", ref: "mstz/wine", title: "Wine quality", url: "https://huggingface.co/datasets/mstz/wine" };
    mount({ recent: () => [recentHit] });
    await focus();
    // "Wine quality" appears once (as Recent), not twice (Recent + Suggested).
    expect(optionNames()).toEqual(["Alpha counts", "Beta shares", "Wine quality", "Titanic survival"]);
    expect(groupHeadings()).toEqual(["Built-in", "Recent", "Hugging Face"]);
  });

  it("typing filters the Built-in group locally, by title or id", async () => {
    mount();
    await focus();
    await type("alpha");
    expect(optionNames()).toContain("Alpha counts");
    expect(optionNames()).not.toContain("Beta shares");
  });

  it("typing filters the curated Hugging Face suggestions locally, with no network call needed", async () => {
    const search = vi.fn(async () => []);
    mount({ search });
    await focus();
    await type("titanic");
    // Under the live-search minimum length this still narrows locally —
    // no debounce timer even needs to fire.
    expect(optionNames()).toEqual(["Titanic survival"]);
    expect(search).not.toHaveBeenCalled();
  });
});

describe("ChartsDatasetSearchBox — live search merges with the curated group", () => {
  it("debounces the live call and merges its results with any curated matches", async () => {
    const search = vi.fn(async () => [{ id: "x/y", kind: "hf" as const, ref: "x/y", title: "X Y Dataset", url: "https://huggingface.co/datasets/x/y" }]);
    mount({ search });
    await type("iris flowers"); // matches nothing curated or built-in — a genuine search phrase
    expect(search).not.toHaveBeenCalled(); // not yet — still inside the debounce window
    await act(async () => { await vi.advanceTimersByTimeAsync(CHARTS_DATASET_SEARCH_DEBOUNCE_MS + 10); });
    expect(search).toHaveBeenCalledTimes(1);
    expect(search).toHaveBeenCalledWith("iris flowers", expect.objectContaining({ signal: expect.anything() }));
    expect(optionNames()).toEqual(["X Y Dataset"]);
  });

  it("resets the debounce on every keystroke — only the FINAL query is searched", async () => {
    const search = vi.fn(async () => []);
    mount({ search });
    await type("qq");
    await act(async () => { await vi.advanceTimersByTimeAsync(CHARTS_DATASET_SEARCH_DEBOUNCE_MS - 50); });
    await type("qqq");
    await act(async () => { await vi.advanceTimersByTimeAsync(CHARTS_DATASET_SEARCH_DEBOUNCE_MS + 10); });
    expect(search).toHaveBeenCalledTimes(1);
    expect(search).toHaveBeenCalledWith("qqq", expect.anything());
  });

  it("says so when neither the live search nor the curated group has a match", async () => {
    mount({ search: vi.fn(async () => []) });
    await type("zzzznotreal");
    await act(async () => { await vi.advanceTimersByTimeAsync(CHARTS_DATASET_SEARCH_DEBOUNCE_MS + 10); });
    expect(options()).toHaveLength(0);
    expect(container!.querySelector(".instrument-search-note")?.textContent).toMatch(/no match/i);
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

describe("ChartsDatasetSearchBox — idle title, focus clears, blur restores", () => {
  it("shows the loaded title when idle, clears on focus, and restores on blur with no pick", async () => {
    mount({ loadedTitle: "Alpha counts" });
    expect(input().value).toBe("Alpha counts");
    await focus();
    expect(input().value).toBe("");
    await type("something typed but never picked");
    await blur();
    expect(input().value).toBe("Alpha counts");
  });
});

describe("ChartsDatasetSearchBox — keyboard", () => {
  it("moves through the list with the arrows and selects a Built-in entry with Enter", async () => {
    const { onSelectBuiltIn } = mount();
    await focus();
    key(input(), "ArrowDown");
    expect(options()[0]!.className).toContain("is-active");
    key(input(), "ArrowDown");
    expect(options()[1]!.className).toContain("is-active");
    key(input(), "Enter");
    expect(onSelectBuiltIn).toHaveBeenCalledWith("beta-shares");
  });

  it("selects a remote entry (past the Built-in group) with Enter", async () => {
    const { onSelectRemote } = mount();
    await focus();
    for (let i = 0; i < 3; i++) key(input(), "ArrowDown"); // 2 built-in + 1 into the remote group
    key(input(), "Enter");
    expect(onSelectRemote).toHaveBeenCalledWith(SUGGESTIONS[0]);
  });

  it("Enter with nothing highlighted picks the first (Built-in) result", async () => {
    const { onSelectBuiltIn } = mount();
    await focus();
    key(input(), "Enter");
    expect(onSelectBuiltIn).toHaveBeenCalledWith("alpha-counts");
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
    await focus();
    key(input(), "ArrowUp"); // from -1, wraps to the LAST option (index 3 of 4)
    expect(options()[3]!.className).toContain("is-active");
    key(input(), "ArrowDown");
    expect(options()[0]!.className).toContain("is-active"); // wraps back to the first
  });
});
