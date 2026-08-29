import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { GlyphSceneElement } from "./GlyphSceneElement";
import { GlyphPerspectiveCameraElement } from "./GlyphPerspectiveCameraElement";
import { GlyphOrthographicCameraElement } from "./GlyphOrthographicCameraElement";
import type { Polygon } from "@glyphcss/core";
import { computeGlyphControlContentSha256, computeGlyphControlGeometryHashes, type GlyphControlSceneManifest, type GlyphObjectDictionary } from "../api/controlFrame";

const semanticPolygon: Polygon = { vertices: [[-1, -1, 0], [-1, 1, 0], [1, 1, 0], [1, -1, 0]], color: "#fff" };
const semanticDictionaryBase: Omit<GlyphObjectDictionary, "contentSha256"> = { schemaVersion: "glyph-object-dictionary/v2", id: "dictionary/element", font: { id: "font/element", version: "1", sha256: "a".repeat(64) }, classes: [{ id: 1, name: "quad", semanticGlyph: "Q", controlColor: "#123456" }] };
const semanticDictionary: GlyphObjectDictionary = { ...semanticDictionaryBase, contentSha256: computeGlyphControlContentSha256(semanticDictionaryBase) };
function semanticManifest(): GlyphControlSceneManifest {
  const hashes = computeGlyphControlGeometryHashes([semanticPolygon]);
  const base = { schemaVersion: "control-scene/v1" as const, id: "scene/element", dictionaryId: semanticDictionary.id, dictionarySha256: semanticDictionary.contentSha256, ...hashes, contentSha256: "", instances: [{ id: "instance/quad", classId: 1 }], surfaces: [{ id: "surface/quad", instanceId: "instance/quad" }], polygonSurfaceIds: ["surface/quad"] };
  return { ...base, contentSha256: computeGlyphControlContentSha256(base) };
}

// Register elements if not already registered.
if (!customElements.get("glyph-scene")) {
  customElements.define("glyph-scene", GlyphSceneElement);
}
if (!customElements.get("glyph-perspective-camera")) {
  customElements.define("glyph-perspective-camera", GlyphPerspectiveCameraElement);
}
if (!customElements.get("glyph-orthographic-camera")) {
  customElements.define("glyph-orthographic-camera", GlyphOrthographicCameraElement);
}
if (!customElements.get("glyph-camera")) {
  class GlyphCameraElement extends GlyphOrthographicCameraElement {}
  customElements.define("glyph-camera", GlyphCameraElement);
}

describe("GlyphSceneElement", () => {
  let camEl: GlyphPerspectiveCameraElement;
  let host: GlyphSceneElement;

  beforeEach(() => {
    camEl = document.createElement("glyph-perspective-camera") as GlyphPerspectiveCameraElement;
    host = document.createElement("glyph-scene") as GlyphSceneElement;
    camEl.appendChild(host);
  });

  afterEach(() => {
    if (camEl.isConnected) camEl.remove();
  });

  it("is registered under the 'glyph-scene' tag", () => {
    expect(customElements.get("glyph-scene")).toBe(GlyphSceneElement);
  });

  it("createElement produces a GlyphSceneElement instance", () => {
    expect(host).toBeInstanceOf(GlyphSceneElement);
  });

  it("observes the expected attributes", () => {
    expect(GlyphSceneElement.observedAttributes).toContain("mode");
    expect(GlyphSceneElement.observedAttributes).toContain("cols");
    expect(GlyphSceneElement.observedAttributes).toContain("rows");
    expect(GlyphSceneElement.observedAttributes).toContain("use-colors");
    expect(GlyphSceneElement.observedAttributes).toContain("glyph-palette");
    expect(GlyphSceneElement.observedAttributes).toContain("char-mode");
    expect(GlyphSceneElement.observedAttributes).toContain("color-tolerance");
    expect(GlyphSceneElement.observedAttributes).toContain("wireframe-junctions");
    expect(GlyphSceneElement.observedAttributes).toContain("cell-aspect");
    expect(GlyphSceneElement.observedAttributes).toContain("directional-intensity");
    expect(GlyphSceneElement.observedAttributes).toContain("ambient-intensity");
    expect(GlyphSceneElement.observedAttributes).toContain("shadow");
    expect(GlyphSceneElement.observedAttributes).toContain("shadow-color");
    expect(GlyphSceneElement.observedAttributes).toContain("shadow-opacity");
    expect(GlyphSceneElement.observedAttributes).toContain("shadow-lift");
    expect(GlyphSceneElement.observedAttributes).toContain("shadow-max-extend");
  });

  it("getScene() returns null before connect", () => {
    expect(host.getScene()).toBeNull();
  });

  it("appending camera to document emits .glyph-scene wrapper and <pre> output", () => {
    document.body.appendChild(camEl);
    expect(host.querySelector(".glyph-scene")).toBeTruthy();
    expect(host.querySelector("pre.glyph-output")).toBeTruthy();
  });

  it("getScene() is non-null after connect", () => {
    document.body.appendChild(camEl);
    expect(host.getScene()).not.toBeNull();
  });

  // `directional-direction` sat in observedAttributes but was never read, so the
  // light stayed pinned to its default and the documented attribute did nothing.
  it("reads directional-direction into the scene's light", () => {
    host.setAttribute("directional-direction", "1,0,0");
    host.setAttribute("directional-intensity", "0.75");
    document.body.appendChild(camEl);
    const light = host.getScene()?.getOptions().directionalLight;
    expect(light?.direction).toEqual([1, 0, 0]);
    expect(light?.intensity).toBe(0.75);
  });

  it("accepts directional-direction on its own", () => {
    host.setAttribute("directional-direction", "0,-1,0");
    document.body.appendChild(camEl);
    expect(host.getScene()?.getOptions().directionalLight?.direction).toEqual([0, -1, 0]);
  });

  it("ignores a malformed directional-direction rather than throwing", () => {
    host.setAttribute("directional-direction", "1,2");
    host.setAttribute("directional-intensity", "0.5");
    document.body.appendChild(camEl);
    // Falls back to the default vector, keeping the intensity that parsed.
    expect(host.getScene()?.getOptions().directionalLight?.intensity).toBe(0.5);
  });

  // COLOR-TOLERANCE.md Phase 3 — `color-tolerance` attribute reflection.
  it("reads color-tolerance into the scene options", () => {
    host.setAttribute("color-tolerance", "42");
    document.body.appendChild(camEl);
    expect(host.getScene()?.getOptions().colorTolerance).toBe(42);
  });

  it("defaults colorTolerance to 0 when the attribute is absent", () => {
    document.body.appendChild(camEl);
    expect(host.getScene()?.getOptions().colorTolerance).toBe(0);
  });

  it("attributeChangedCallback updates colorTolerance on a live scene", () => {
    document.body.appendChild(camEl);
    expect(host.getScene()?.getOptions().colorTolerance).toBe(0);
    host.setAttribute("color-tolerance", "17");
    expect(host.getScene()?.getOptions().colorTolerance).toBe(17);
  });

  it("ignores an unparseable color-tolerance attribute rather than throwing", () => {
    host.setAttribute("color-tolerance", "not-a-number");
    expect(() => document.body.appendChild(camEl)).not.toThrow();
    expect(host.getScene()?.getOptions().colorTolerance).toBe(0);
  });

  it("a negative color-tolerance attribute is accepted here and degrades to 0 downstream", () => {
    host.setAttribute("color-tolerance", "-5");
    document.body.appendChild(camEl);
    expect(host.getScene()?.getOptions().colorTolerance).toBe(0);
  });

  // color-tolerance's own +Infinity special case (COLOR-TOLERANCE.md Phase 3
  // review Finding 3): the shared `parseNumber` used by every other numeric
  // attribute drops non-finite input via `Number.isFinite`, which would
  // silently ignore `color-tolerance="Infinity"` even though the JS/React/Vue
  // surfaces (and the documented attribute table) honor +Infinity as a
  // legitimate maximal-merge value, not an error.
  it("honors color-tolerance=\"Infinity\" as +Infinity", () => {
    host.setAttribute("color-tolerance", "Infinity");
    document.body.appendChild(camEl);
    expect(host.getScene()?.getOptions().colorTolerance).toBe(Infinity);
  });

  it("honors color-tolerance=\"+Infinity\" as +Infinity", () => {
    host.setAttribute("color-tolerance", "+Infinity");
    document.body.appendChild(camEl);
    expect(host.getScene()?.getOptions().colorTolerance).toBe(Infinity);
  });

  it("degrades color-tolerance=\"-Infinity\" to 0, same as any other negative value", () => {
    host.setAttribute("color-tolerance", "-Infinity");
    document.body.appendChild(camEl);
    expect(host.getScene()?.getOptions().colorTolerance).toBe(0);
  });

  it("attributeChangedCallback honors a live update to color-tolerance=\"Infinity\"", () => {
    document.body.appendChild(camEl);
    expect(host.getScene()?.getOptions().colorTolerance).toBe(0);
    host.setAttribute("color-tolerance", "Infinity");
    expect(host.getScene()?.getOptions().colorTolerance).toBe(Infinity);
  });

  it("reads track-opaque-coverage into the scene options", () => {
    host.setAttribute("track-opaque-coverage", "");
    document.body.appendChild(camEl);
    expect(host.getScene()?.getOptions().trackOpaqueCoverage).toBe(true);
  });

  it("defaults trackOpaqueCoverage to false when the attribute is absent", () => {
    document.body.appendChild(camEl);
    expect(host.getScene()?.getOptions().trackOpaqueCoverage).toBe(false);
  });

  it("attributeChangedCallback updates trackOpaqueCoverage on a live scene", () => {
    document.body.appendChild(camEl);
    expect(host.getScene()?.getOptions().trackOpaqueCoverage).toBe(false);
    host.setAttribute("track-opaque-coverage", "true");
    expect(host.getScene()?.getOptions().trackOpaqueCoverage).toBe(true);
    host.setAttribute("track-opaque-coverage", "false");
    expect(host.getScene()?.getOptions().trackOpaqueCoverage).toBe(false);
  });

  it("dispatches glyphcss:scene-ready on connect", () => {
    let fired = false;
    host.addEventListener("glyphcss:scene-ready", () => { fired = true; });
    document.body.appendChild(camEl);
    expect(fired).toBe(true);
  });

  it("passes cols/rows attributes down to the scene", async () => {
    host.setAttribute("cols", "40");
    host.setAttribute("rows", "10");
    document.body.appendChild(camEl);
    // Let the microtask render flush.
    await Promise.resolve();
    const pre = host.querySelector("pre.glyph-output") as HTMLPreElement;
    // The pre should have some content rendered into a 40x10 grid.
    expect(pre).toBeTruthy();
  });

  it("mode attribute change triggers re-render without throwing", async () => {
    host.setAttribute("cols", "20");
    host.setAttribute("rows", "5");
    document.body.appendChild(camEl);
    await Promise.resolve();
    host.setAttribute("mode", "wireframe");
    await Promise.resolve();
    const pre = host.querySelector("pre.glyph-output") as HTMLPreElement;
    expect(pre).toBeTruthy();
  });

  it("char-mode=braille attribute in wireframe mode renders without throwing", async () => {
    host.setAttribute("cols", "20");
    host.setAttribute("rows", "5");
    host.setAttribute("mode", "wireframe");
    host.setAttribute("char-mode", "braille");
    document.body.appendChild(camEl);
    await Promise.resolve();
    const pre = host.querySelector("pre.glyph-output") as HTMLPreElement;
    expect(pre).toBeTruthy();
  });

  it("wireframe-junctions attribute in wireframe mode renders without throwing", async () => {
    host.setAttribute("cols", "20");
    host.setAttribute("rows", "5");
    host.setAttribute("mode", "wireframe");
    host.setAttribute("wireframe-junctions", "true");
    document.body.appendChild(camEl);
    await Promise.resolve();
    const pre = host.querySelector("pre.glyph-output") as HTMLPreElement;
    expect(pre).toBeTruthy();
  });

  it("attributeChangedCallback is a no-op before connect", () => {
    // Setting an attribute before connect must not throw.
    expect(() => { host.setAttribute("mode", "solid"); }).not.toThrow();
    // Scene still null after attribute change before connect.
    expect(host.getScene()).toBeNull();
  });

  it("disconnect destroys the scene (removes .glyph-scene from DOM)", () => {
    document.body.appendChild(camEl);
    expect(host.querySelector(".glyph-scene")).toBeTruthy();
    camEl.remove();
    expect(host.querySelector(".glyph-scene")).toBeFalsy();
    expect(host.getScene()).toBeNull();
  });

  it("reconnect after disconnect creates a fresh scene", () => {
    document.body.appendChild(camEl);
    const first = host.getScene();
    camEl.remove();
    // Re-create the camera element to avoid the "already connected" guard
    const camEl2 = document.createElement("glyph-perspective-camera") as GlyphPerspectiveCameraElement;
    const host2 = document.createElement("glyph-scene") as GlyphSceneElement;
    camEl2.appendChild(host2);
    document.body.appendChild(camEl2);
    const second = host2.getScene();
    expect(second).not.toBeNull();
    // Should be a fresh handle object (not the same reference).
    expect(second).not.toBe(first);
    camEl2.remove();
  });

  it("use-colors=false attribute is forwarded (no crash on render)", async () => {
    host.setAttribute("use-colors", "false");
    host.setAttribute("cols", "20");
    host.setAttribute("rows", "5");
    document.body.appendChild(camEl);
    await Promise.resolve();
    const pre = host.querySelector("pre.glyph-output") as HTMLPreElement;
    expect(pre).toBeTruthy();
  });

  it("directional-intensity and ambient-intensity attributes are forwarded without error", () => {
    host.setAttribute("directional-intensity", "0.8");
    host.setAttribute("ambient-intensity", "0.3");
    expect(() => { document.body.appendChild(camEl); }).not.toThrow();
  });

  it("throws when connected without a camera ancestor", () => {
    const orphanScene = document.createElement("glyph-scene") as GlyphSceneElement;
    expect(() => {
      document.body.appendChild(orphanScene);
    }).toThrow(
      "glyphcss: <glyph-scene> must be placed inside a <glyph-camera>, <glyph-perspective-camera>, or <glyph-orthographic-camera>.",
    );
    orphanScene.remove();
  });

  it("mounts inside the <glyph-camera> alias (orthographic alias)", () => {
    const aliasCam = document.createElement("glyph-camera");
    const aliasHost = document.createElement("glyph-scene") as GlyphSceneElement;
    aliasCam.appendChild(aliasHost);
    expect(() => { document.body.appendChild(aliasCam); }).not.toThrow();
    expect(aliasHost.getScene()).not.toBeNull();
    aliasCam.remove();
  });

  it("shadow attribute enables shadows with default options", () => {
    host.setAttribute("shadow", "");
    host.setAttribute("cols", "20");
    host.setAttribute("rows", "5");
    document.body.appendChild(camEl);
    const sceneHandle = host.getScene()!;
    const opts = sceneHandle.getOptions();
    expect(opts.shadow).toMatchObject({
      color: "#000000",
      opacity: 0.25,
      lift: 0.05,
      maxExtend: 2000,
    });
  });

  it("shadow-opacity attribute overrides the default opacity", () => {
    host.setAttribute("shadow", "");
    host.setAttribute("shadow-opacity", "0.5");
    host.setAttribute("cols", "20");
    host.setAttribute("rows", "5");
    document.body.appendChild(camEl);
    const opts = host.getScene()!.getOptions();
    expect(opts.shadow).toMatchObject({ opacity: 0.5 });
  });

  it("shadow-color, shadow-lift, shadow-max-extend attributes are forwarded", () => {
    host.setAttribute("shadow", "");
    host.setAttribute("shadow-color", "#ff0000");
    host.setAttribute("shadow-lift", "0.1");
    host.setAttribute("shadow-max-extend", "500");
    host.setAttribute("cols", "20");
    host.setAttribute("rows", "5");
    document.body.appendChild(camEl);
    const opts = host.getScene()!.getOptions();
    expect(opts.shadow).toMatchObject({ color: "#ff0000", lift: 0.1, maxExtend: 500 });
  });

  it("absence of shadow attribute means no shadow options", () => {
    host.setAttribute("cols", "20");
    host.setAttribute("rows", "5");
    document.body.appendChild(camEl);
    const opts = host.getScene()!.getOptions();
    expect(opts.shadow).toBeUndefined();
  });

  it("shadow attribute change after connect updates scene options", async () => {
    host.setAttribute("cols", "20");
    host.setAttribute("rows", "5");
    document.body.appendChild(camEl);
    expect(host.getScene()!.getOptions().shadow).toBeUndefined();

    const setOptionsSpy = vi.spyOn(host.getScene()!, "setOptions");
    host.setAttribute("shadow", "");
    expect(setOptionsSpy).toHaveBeenCalled();
    const lastCall = setOptionsSpy.mock.calls[setOptionsSpy.mock.calls.length - 1]![0];
    expect(lastCall.shadow).toMatchObject({ opacity: 0.25 });
  });

  it("stages semantic properties, activates once complete, and resets when the attribute is removed", () => {
    host.setAttribute("glyph-output", "semantic");
    document.body.appendChild(camEl);
    const scene = host.getScene()!;
    scene.add([semanticPolygon]);
    expect(scene.getOptions().glyphOutput).toBe("visible");
    host.sceneManifest = semanticManifest();
    expect(scene.getOptions().glyphOutput).toBe("visible");
    host.dictionary = semanticDictionary;
    expect(scene.getOptions().glyphOutput).toBe("semantic");
    host.removeAttribute("glyph-output");
    expect(scene.getOptions().glyphOutput).toBe("visible");
  });

  it("rolls back a failed semantic property update without changing the active scene", () => {
    document.body.appendChild(camEl);
    const scene = host.getScene()!;
    scene.add([semanticPolygon]);
    host.setAttribute("glyph-output", "semantic");
    host.sceneManifest = semanticManifest();
    host.dictionary = semanticDictionary;
    const before = host.dictionary;
    expect(() => { host.dictionary = { ...semanticDictionary, contentSha256: "f".repeat(64) }; }).toThrow(/dictionary/);
    expect(host.dictionary).toBe(before);
    expect(scene.getOptions().dictionary).toBe(before);
  });
});
