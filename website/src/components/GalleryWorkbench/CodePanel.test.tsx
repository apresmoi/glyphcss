import panelStyles from "../CodePanel/CodePanel.module.css";
// @vitest-environment happy-dom
import "../../test/dom";
import { createHash } from "node:crypto";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CodePanel } from "../CodePanel";
import { GalleryCodePanel } from "./GalleryCodePanel";
import { DEFAULT_GALLERY_EFFECT_STATE } from "../../features/gallery/model/effects";
import type { SceneOptionsState } from "../../features/gallery/model/types";

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
const cases: { name: string; render: (onClose: () => void) => ReactNode; reactSnippet: string }[] = [
  { name: "gallery", render: onClose => <GalleryCodePanel meshUrl="/model.obj" options={options} selectedPreset={{ id: "model", kind: "obj", label: "Model", category: "Solid", url: "/model.obj" }} effectState={DEFAULT_GALLERY_EFFECT_STATE} effectDefinition={null} onClose={onClose} />, reactSnippet: '@glyphcss/react' },
  { name: "shared", render: onClose => <CodePanel snippets={{ html: "<pre />", vanilla: "render()", react: "<GlyphMap />", vue: "<GlyphMap /> <!-- Vue -->" }} onClose={onClose} />, reactSnippet: "<GlyphMap />" },
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

  it.each(cases)("preserves $name markup, ordered tabs, default selection and copy with the shared shell", async ({ render, reactSnippet }) => {
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    const onClose = vi.fn(() => root.render(null));
    act(() => root.render(render(onClose)));
    const select = container.querySelector<HTMLSelectElement>('[aria-label="Export format"]')!;
    const tabs = Array.from(select.options);
    expect(tabs.map((tab) => tab.textContent)).toEqual(["HTML", "JS", "React", "Vue"]);
    expect(select.selectedOptions[0]?.textContent).toBe("React");
    expect(container.querySelector("code")?.textContent).toContain(reactSnippet);
    const fingerprint = () => {
      expect(container.querySelector("aside")!.classList.contains(panelStyles.root)).toBe(true);
      const copy = container.cloneNode(true) as HTMLElement;
      copy.querySelector("aside")!.classList.remove(panelStyles.root);
      for (const node of copy.querySelectorAll("[id], [aria-controls], [aria-labelledby]")) {
        for (const attr of ["id", "aria-controls", "aria-labelledby"]) if (node.hasAttribute(attr)) node.setAttribute(attr, node.getAttribute(attr)!.replace(/_r_[^_]+_/g, "_stable_"));
      }
      return createHash("sha256").update(copy.innerHTML).digest("hex");
    };
    const markup = [fingerprint()];
    for (const tab of tabs) {
      act(() => { select.value = tab.value; select.dispatchEvent(new Event("change", {bubbles:true})); });
      expect(select.value).toBe(tab.value);
      expect(tab.selected).toBe(true);
      const snippet = container.querySelector("code")!.textContent;
      expect(snippet).not.toBe("");
      markup.push(fingerprint());
      await act(async () => container.querySelector<HTMLButtonElement>('[title="Copy current snippet"]')!.click());
      expect(writeText).toHaveBeenLastCalledWith(snippet);
      act(() => vi.runAllTimers());
    }
    act(() => container.querySelector<HTMLButtonElement>('[aria-label="Close export panel"]')!.click());
    expect(container.querySelector("code")).toBeNull();
    expect(onClose).toHaveBeenCalledOnce();
    // Captures the approved shared-control markup and generated snippets.
    expect(markup).toMatchSnapshot();
  });
});
