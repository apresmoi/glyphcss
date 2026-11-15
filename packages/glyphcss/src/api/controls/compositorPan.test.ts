import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Polygon } from "@glyphcss/core";
import { createGlyphScene, type GlyphSceneHandle, type GlyphSceneOptions } from "../createGlyphScene";
import { createGlyphOrthographicCamera, createGlyphPerspectiveCamera } from "../createGlyphCamera";
import { createGlyphOrbitControls } from "../createGlyphOrbitControls";
import { createGlyphMapControls } from "../createGlyphMapControls";

const CELL_W = 8, CELL_H = 16, COLS = 40, ROWS = 20;
const MARGIN_COLS = 12, MARGIN_ROWS = 8; // a quarter of the grid, rounded up to the dither's 4-cell period

const scenes: GlyphSceneHandle[] = [];
let renders = 0;

/** Two crossed quads: enough silhouette that a shifted picture cannot equal the unshifted one. */
const MESH: Polygon[] = [
  { vertices: [[-3, -2, 0], [3, -2, 0], [3, 2, 0], [-3, 2, 0]], color: "#ff0000" },
  { vertices: [[-1, -4, 1], [1, -4, 1], [1, 4, 1], [-1, 4, 1]], color: "#00ff00" },
];

function mount(extra: Partial<GlyphSceneOptions> = {}): GlyphSceneHandle {
  const host = document.createElement("div");
  document.body.append(host);
  const scene = createGlyphScene(host, {
    cols: COLS, rows: ROWS, useColors: false, doubleSided: true,
    camera: createGlyphOrthographicCamera({ rotX: 30, rotY: 20, zoom: 24 }),
    ...extra,
  });
  scene.add(MESH);
  scene.rerender();
  scenes.push(scene);
  return scene;
}

const event = (scene: GlyphSceneHandle, type: string, x: number, y: number, button = 1): void => {
  scene.host.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, pointerId: 1, isPrimary: true, button, bubbles: true }));
};
/** Middle-button drag (the orbit controls' pan) from (100, 100) through each offset, without releasing. */
function drag(scene: GlyphSceneHandle, offsets: ReadonlyArray<readonly [number, number]>): void {
  event(scene, "pointerdown", 100, 100);
  for (const [dx, dy] of offsets) event(scene, "pointermove", 100 + dx, 100 + dy);
}
const release = (scene: GlyphSceneHandle): void => event(scene, "pointerup", 0, 0);
const sceneElement = (scene: GlyphSceneHandle): HTMLElement => scene.output.parentElement as HTMLElement;
const text = (scene: GlyphSceneHandle): string => scene.output.textContent ?? "";

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const lines = this.textContent?.split("\n") ?? [];
    const pre = this.tagName === "PRE";
    const width = pre ? Math.max(0, ...lines.map((line) => line.length)) * CELL_W : COLS * CELL_W;
    const height = pre ? lines.length * CELL_H : ROWS * CELL_H;
    return { width, height, x: 0, y: 0, top: 0, left: 0, right: width, bottom: height, toJSON() {} } as DOMRect;
  });
  (globalThis as { __glyphRenderStage?: (stage: string) => void }).__glyphRenderStage = (stage) => { if (stage === "base-validate") renders++; };
});

afterEach(() => {
  for (const scene of scenes.splice(0)) scene.destroy();
  (globalThis as { __glyphRenderStage?: unknown }).__glyphRenderStage = undefined;
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("compositorPan", () => {
  it("a pan gesture leaves the same frame, options and styles as a plain pan", () => {
    const plain = mount(), slid = mount();
    const a = createGlyphOrbitControls(plain), b = createGlyphOrbitControls(slid, { compositorPan: true });
    const before = { style: sceneElement(slid).style.cssText, overflow: slid.host.style.overflow, center: [...slid.camera.center] };
    const moves = [[5, 3], [19, -11], [33, 7]] as const;
    drag(plain, moves); release(plain);
    drag(slid, moves); release(slid);

    expect(text(plain)).not.toBe(text(mount())); // the pan moved the picture
    expect(text(slid)).toBe(text(plain));
    expect(slid.camera.target).toEqual(plain.camera.target);
    expect(slid.getOptions().cols).toBe(COLS);
    expect(slid.getOptions().rows).toBe(ROWS);
    expect(sceneElement(slid).style.cssText).toBe(before.style);
    expect(slid.host.style.overflow).toBe(before.overflow);
    expect(slid.camera.center).toEqual(before.center);
    a.destroy(); b.destroy();
  });

  it("renders once for the gesture and translates by the pointer's own offset after that", () => {
    const scene = mount();
    const controls = createGlyphOrbitControls(scene, { compositorPan: true });
    renders = 0;
    drag(scene, [[4, 2]]);
    expect(renders).toBe(1); // the anchor render on the margin grid
    expect(scene.getOptions().cols).toBe(COLS + 2 * MARGIN_COLS);
    expect(scene.host.style.overflow).toBe("hidden");
    expect(sceneElement(scene).style.transform).toBe(`translate(${-MARGIN_COLS * CELL_W}px, ${-MARGIN_ROWS * CELL_H}px)`);

    const anchored = text(scene);
    event(scene, "pointermove", 100 + 28, 100 + 18);
    event(scene, "pointermove", 100 + 20, 100 - 6);
    expect(renders).toBe(1);
    expect(text(scene)).toBe(anchored);
    const [, x, y] = /translate\((-?[\d.]+)px, (-?[\d.]+)px\)/.exec(sceneElement(scene).style.transform)!;
    expect(Number(x)).toBeCloseTo(-MARGIN_COLS * CELL_W + 16, 6); // 20 - 4 since the anchor
    expect(Number(y)).toBeCloseTo(-MARGIN_ROWS * CELL_H - 8, 6); // -6 - 2
    release(scene);
    expect(renders).toBe(2); // the settle
    controls.destroy();
  });

  it("the slid picture is the picture a render of that pose draws", () => {
    // Pan by whole cells, so the translation lands every glyph on the lattice a fresh render uses,
    // and by a whole period of the ordered dither (4 x 4 cells), which is keyed to that lattice.
    const shift = [4, -4] as const;
    const plain = mount(), slid = mount();
    const a = createGlyphOrbitControls(plain), b = createGlyphOrbitControls(slid, { compositorPan: true });
    drag(plain, [[0.5, 0.5]]); drag(slid, [[0.5, 0.5]]); // anchor first, then one whole-cell move
    event(plain, "pointermove", 100.5 + shift[0] * CELL_W, 100.5 + shift[1] * CELL_H);
    event(slid, "pointermove", 100.5 + shift[0] * CELL_W, 100.5 + shift[1] * CELL_H);

    const wide = text(slid).split("\n");
    const shown = wide.slice(MARGIN_ROWS - shift[1], MARGIN_ROWS - shift[1] + ROWS)
      .map((line) => line.padEnd(COLS + 2 * MARGIN_COLS).slice(MARGIN_COLS - shift[0], MARGIN_COLS - shift[0] + COLS).trimEnd());
    const fresh = text(plain).split("\n").map((line) => line.trimEnd());
    expect(fresh.join("").trim()).not.toBe("");
    expect(shown).toEqual(fresh);
    release(plain); release(slid);
    a.destroy(); b.destroy();
  });

  it("starting a pan changes no visible glyph", () => {
    const scene = mount();
    const controls = createGlyphOrbitControls(scene, { compositorPan: true });
    const resting = text(scene).split("\n").map((line) => line.trimEnd());
    event(scene, "pointerdown", 100, 100);
    const target = [...scene.camera.target];
    event(scene, "pointermove", 100.001, 100); // begins the pan a thousandth of a pixel away
    scene.camera.target = target as typeof scene.camera.target;
    scene.rerender(); // the margin grid at the resting pose
    const shown = text(scene).split("\n").slice(MARGIN_ROWS, MARGIN_ROWS + ROWS)
      .map((line) => line.padEnd(COLS + 2 * MARGIN_COLS).slice(MARGIN_COLS, MARGIN_COLS + COLS).trimEnd());
    expect(shown).toEqual(resting);
    release(scene);
    controls.destroy();
  });

  it("re-anchors with one render when the slide nears the margin", () => {
    const scene = mount();
    const controls = createGlyphOrbitControls(scene, { compositorPan: true });
    drag(scene, [[1, 0]]);
    renders = 0;
    event(scene, "pointermove", 101 + MARGIN_COLS * CELL_W * 0.79, 100); // inside 80% of the margin
    expect(renders).toBe(0);
    event(scene, "pointermove", 101 + MARGIN_COLS * CELL_W * 0.81, 100);
    expect(renders).toBe(1);
    expect(sceneElement(scene).style.transform).toBe(`translate(${-MARGIN_COLS * CELL_W}px, ${-MARGIN_ROWS * CELL_H}px)`);
    release(scene);
    controls.destroy();
  });

  it("a render that is not the pan's own re-anchors, so the pan is never applied twice", () => {
    const scene = mount();
    const controls = createGlyphOrbitControls(scene, { compositorPan: true });
    drag(scene, [[1, 0], [25, 9]]);
    expect(sceneElement(scene).style.transform).not.toBe(`translate(${-MARGIN_COLS * CELL_W}px, ${-MARGIN_ROWS * CELL_H}px)`);
    scene.rerender();
    expect(sceneElement(scene).style.transform).toBe(`translate(${-MARGIN_COLS * CELL_W}px, ${-MARGIN_ROWS * CELL_H}px)`);
    release(scene);
    controls.destroy();
  });

  it.each([
    ["a perspective camera", (): Partial<GlyphSceneOptions> => ({ camera: createGlyphPerspectiveCamera({ rotX: 30, rotY: 20, zoom: 24 }) })],
    ["interactiveDownscale", (): Partial<GlyphSceneOptions> => ({ interactiveDownscale: 2 })],
  ])("renders every move under %s", (_name, options) => {
    const scene = mount(options());
    const controls = createGlyphOrbitControls(scene, { compositorPan: true });
    const style = sceneElement(scene).style.cssText;
    drag(scene, [[4, 2]]);
    renders = 0;
    event(scene, "pointermove", 120, 110);
    event(scene, "pointermove", 130, 115);
    expect(renders).toBe(2);
    expect(sceneElement(scene).style.cssText).toBe(style);
    release(scene);
    controls.destroy();
  });

  it("off by default: every pan move renders and nothing is restyled", () => {
    const scene = mount();
    const controls = createGlyphOrbitControls(scene);
    drag(scene, [[4, 2]]);
    renders = 0;
    event(scene, "pointermove", 120, 110);
    expect(renders).toBe(1);
    expect(scene.getOptions().cols).toBe(COLS);
    expect(sceneElement(scene).style.transform).toBe("");
    release(scene);
    controls.destroy();
  });

  it("destroy() mid-pan settles the scene", () => {
    const scene = mount();
    const controls = createGlyphOrbitControls(scene, { compositorPan: true });
    drag(scene, [[4, 2], [20, 10]]);
    controls.destroy();
    expect(scene.getOptions().cols).toBe(COLS);
    expect(sceneElement(scene).style.transform).toBe("");
    const reference = mount();
    reference.camera.target = [...scene.camera.target] as typeof scene.camera.target;
    reference.rerender();
    expect(text(scene)).toBe(text(reference));
  });

  it("map controls: a left-drag pan slides, and settles to the plain pan's frame", () => {
    const plain = mount(), slid = mount();
    const a = createGlyphMapControls(plain), b = createGlyphMapControls(slid, { compositorPan: true });
    for (const scene of [plain, slid]) { event(scene, "pointerdown", 100, 100, 0); event(scene, "pointermove", 104, 102, 0); }
    renders = 0;
    event(slid, "pointermove", 125, 111, 0);
    expect(renders).toBe(0);
    event(plain, "pointermove", 125, 111, 0);
    release(plain); release(slid);
    expect(text(slid)).toBe(text(plain));
    expect(slid.getOptions().cols).toBe(COLS);
    a.destroy(); b.destroy();
  });
});
