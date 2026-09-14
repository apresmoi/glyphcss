// @vitest-environment node
vi.hoisted(async () => {
  const { Window } = await import("happy-dom");
  const window = new Window();
  for (const key of ["window", "document", "navigator", "HTMLElement", "Element", "Event"] as const) {
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: key === "window" ? window : window[key] });
  }
});
import { createHash } from "node:crypto";
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CodePanel } from "./CodePanel";
import { DEFAULT_GALLERY_EFFECT_STATE } from "./effects";
import type { SceneOptionsState } from "./types";

vi.mock("@glyphcss/core", () => import("../../../../packages/core/src/index"));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const options: SceneOptionsState = {
  animationPaused: false, animationTimeScale: 1, autoCenter: true, autoRotate: false, interactive: true,
  zoom: 0.35, rotX: 65, rotY: 45, perspective: false, target: [0, 0, 0],
  lightAzimuth: 50, lightElevation: 7, lightIntensity: 0.95, lightColor: "#ffffff", ambientIntensity: 0.75, ambientColor: "#ffffff",
  renderMode: "solid", featureEdges: 30, glyphPalette: "default", charMode: "ascii", wireframeJunctions: false,
  hiddenLines: "show", solidWeightRamp: false, colorEncoding: "spans", lineHeight: 1, density: 1, dragDensity: 1,
  useColors: true, smoothShading: false, creaseAngle: 60, dragMode: "orbit",
  fpvLook: true, fpvMove: true, fpvJump: true, fpvCrouch: true, fpvMoveSpeed: 1, fpvJumpVelocity: 0.7,
  fpvGravity: 1.8, fpvEyeHeight: 0.2, fpvCrouchHeight: 0.1, fpvLookSensitivity: 0.15, fpvInvertY: false,
  shadowEnabled: true, shadowOpacity: 0.25, shadowLift: 0.05, shadowColor: "#000000", shadowCast: true, shadowReceive: true, shadowFloor: false,
};
const cases: { name: string; props: ComponentProps<typeof CodePanel>; reactSnippet: string }[] = [
  { name: "gallery", props: { meshUrl: "/model.obj", options, selectedPreset: { id: "model", kind: "obj", label: "Model", category: "Solid", url: "/model.obj" }, effectState: DEFAULT_GALLERY_EFFECT_STATE }, reactSnippet: '@glyphcss/react' },
  { name: "maps", props: { override: { snippets: { html: "<glyph-map />", vanilla: "createGlyphMap()", react: "<GlyphMap />", vue: "<GlyphMap /> <!-- Vue -->" } } }, reactSnippet: "<GlyphMap />" },
];

describe("CodePanel default framework tabs", () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    vi.useFakeTimers();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it.each(cases)("preserves $name markup, ordered tabs, default selection and copy without override.tabs", async ({ props, reactSnippet }) => {
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    act(() => root.render(<CodePanel {...props} />));
    const tabs = Array.from(container.querySelectorAll<HTMLButtonElement>(".gw-code-panel__tab"));
    expect(tabs.map((tab) => tab.textContent)).toEqual(["HTML", "JS", "React", "Vue"]);
    expect(container.querySelector(".gw-code-panel__tab.is-active")?.textContent).toBe("React");
    expect(container.querySelector("code")?.textContent).toContain(reactSnippet);
    const fingerprint = () => createHash("sha256").update(container.innerHTML).digest("hex");
    const markup = [fingerprint()];
    for (const tab of tabs) {
      act(() => tab.click());
      expect(container.querySelector(".gw-code-panel__tab.is-active")).toBe(tab);
      const snippet = container.querySelector("code")!.textContent;
      expect(snippet).not.toBe("");
      markup.push(fingerprint());
      await act(async () => container.querySelector<HTMLButtonElement>('[title="Copy current snippet"]')!.click());
      expect(writeText).toHaveBeenLastCalledWith(snippet);
      act(() => vi.runAllTimers());
    }
    act(() => container.querySelector<HTMLButtonElement>('[aria-label="Collapse"]')!.click());
    expect(container.querySelector("code")).toBeNull();
    markup.push(fingerprint());
    // Captured against the pre-patch component: the whole DOM, including
    // generated snippets, must remain byte-identical for existing consumers.
    expect(markup).toMatchSnapshot();
  });
});
