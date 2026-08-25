/**
 * `<glyph-scene>` custom element.
 *
 * Must be placed inside a `<glyph-perspective-camera>` or
 * `<glyph-orthographic-camera>` element. On `connectedCallback`, walks up
 * `parentElement` until it finds a camera ancestor, then instantiates
 * `createGlyphScene(this, { camera, ...options })`.
 *
 * Children (`<glyph-mesh>`) walk up the tree to find this element and call
 * `getScene()` to register themselves.
 *
 * Attribute parsing mirrors `<poly-scene>` conventions.
 */
import {
  createGlyphScene,
  type GlyphSceneHandle,
  type GlyphSceneOptions,
} from "../api/createGlyphScene";
import type { GlyphShadowOptions, GlyphSolidWeightRampStep } from "../api/types";
import type { GlyphControlSceneManifest, GlyphObjectDictionary } from "../api/controlFrame";
import type { RenderMode } from "@glyphcss/core";

const ELEMENT_BASE: typeof HTMLElement =
  typeof HTMLElement !== "undefined"
    ? HTMLElement
    : (class {} as unknown as typeof HTMLElement);

const OBSERVED_ATTRS = [
  "mode",
  "glyph-output",
  "glyph-palette",
  "char-mode",
  "wireframe-junctions",
  "hidden-lines",
  "color-tolerance",
  "color-encoding",
  "use-colors",
  "cols",
  "rows",
  "cell-aspect",
  "directional-direction",
  "directional-intensity",
  "ambient-intensity",
  "auto-size",
  "interactive-downscale",
  "shadow",
  "shadow-color",
  "shadow-opacity",
  "shadow-lift",
  "shadow-max-extend",
] as const;

function parseVec3(value: string | null): [number, number, number] | undefined {
  if (!value) return undefined;
  const parts = value.split(",").map((p) => parseFloat(p.trim()));
  if (parts.length !== 3 || parts.some((p) => !Number.isFinite(p))) return undefined;
  return [parts[0]!, parts[1]!, parts[2]!];
}

function parseNumber(value: string | null): number | undefined {
  if (value == null) return undefined;
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : undefined;
}

// `colorTolerance` is the one numeric option whose public range legitimately
// includes non-finite values (`+Infinity` — COLOR-TOLERANCE.md, "honored
// as-is", verified at the JS/React/Vue surfaces): `parseNumber`'s blanket
// `Number.isFinite` guard exists for every OTHER numeric attribute, where a
// non-finite value is always a mistake, so `color-tolerance` gets its own
// parse instead of loosening the shared one.
function parseColorTolerance(value: string | null): number | undefined {
  if (value == null) return undefined;
  const trimmed = value.trim();
  if (trimmed === "Infinity" || trimmed === "+Infinity") return Infinity;
  if (trimmed === "-Infinity") return -Infinity; // degrades to 0 downstream, same as any other negative value.
  return parseNumber(value);
}

function parseMode(value: string | null): RenderMode | undefined {
  if (value === "wireframe" || value === "solid" || value === "voxel" || value === "ink") return value;
  return undefined;
}

function parseGlyphOutput(value: string | null): "visible" | "semantic" | undefined {
  return value === "visible" || value === "semantic" ? value : undefined;
}

function parseCharMode(value: string | null): "ascii" | "braille" | "halfblock" | "quadrant" | undefined {
  return value === "ascii" || value === "braille" || value === "halfblock" || value === "quadrant" ? value : undefined;
}

function parseHiddenLines(value: string | null): "show" | "hide" | undefined {
  return value === "show" || value === "hide" ? value : undefined;
}

function parseColorEncoding(value: string | null): "spans" | "atlas" | undefined {
  return value === "spans" || value === "atlas" ? value : undefined;
}

function parseBool(value: string | null): boolean | undefined {
  if (value === null) return undefined;
  if (value === "false") return false;
  if (value === "true" || value === "") return true;
  return undefined;
}

export class GlyphSceneElement extends ELEMENT_BASE {
  static get observedAttributes(): string[] {
    return [...OBSERVED_ATTRS];
  }

  private _scene: GlyphSceneHandle | null = null;
  private _sceneManifest: GlyphControlSceneManifest | undefined;
  private _dictionary: GlyphObjectDictionary | undefined;
  private _solidWeightRamp: GlyphSolidWeightRampStep[] | undefined;
  private _atlasPalette: readonly string[] | undefined;

  /**
   * Solid-mode font-weight density ramp (see
   * {@link RasterizeContextOptions.solidWeightRamp}). A JS property, not an
   * attribute — the ramp is a `(glyph, weight)[]` step list (typically the
   * output of `@glyphcss/effects`'s `calibrateWeightedGlyphRamp`), the same
   * "complex data through a property" convention `sceneManifest`/
   * `dictionary` above use, since it cannot round-trip through a string
   * attribute.
   */
  get solidWeightRamp(): GlyphSolidWeightRampStep[] | undefined { return this._solidWeightRamp; }
  set solidWeightRamp(value: GlyphSolidWeightRampStep[] | undefined) {
    this._solidWeightRamp = value;
    this._scene?.setOptions({ solidWeightRamp: value });
  }

  /**
   * Palette `color-encoding="atlas"` cells encode against (see
   * {@link RasterizeContextOptions.atlasPalette}). A JS property, not an
   * attribute — same "complex data through a property" convention as
   * `solidWeightRamp` above (an ordered color array doesn't round-trip
   * through a single string attribute the way a scalar option does).
   */
  get atlasPalette(): readonly string[] | undefined { return this._atlasPalette; }
  set atlasPalette(value: readonly string[] | undefined) {
    this._atlasPalette = value;
    this._scene?.setOptions({ atlasPalette: value });
  }

  get sceneManifest(): GlyphControlSceneManifest | undefined { return this._sceneManifest; }
  set sceneManifest(value: GlyphControlSceneManifest | undefined) {
    const previous = this._sceneManifest;
    this._sceneManifest = value;
    try { this._applySemanticOptions(); } catch (error) { this._sceneManifest = previous; throw error; }
  }

  get dictionary(): GlyphObjectDictionary | undefined { return this._dictionary; }
  set dictionary(value: GlyphObjectDictionary | undefined) {
    const previous = this._dictionary;
    this._dictionary = value;
    try { this._applySemanticOptions(); } catch (error) { this._dictionary = previous; throw error; }
  }

  getScene(): GlyphSceneHandle | null {
    return this._scene;
  }

  private _readOptions(): GlyphSceneOptions {
    const opts: GlyphSceneOptions = {};
    const mode = parseMode(this.getAttribute("mode"));
    if (mode !== undefined) opts.mode = mode;
    // Attribute removal is an explicit reset, not an omitted partial option.
    if (this.hasAttribute("glyph-output")) {
      const glyphOutput = parseGlyphOutput(this.getAttribute("glyph-output"));
      if (!glyphOutput) throw new TypeError('glyphcss: glyph-output must be "visible" or "semantic".');
      opts.glyphOutput = glyphOutput;
    }
    if (this._sceneManifest !== undefined) opts.sceneManifest = this._sceneManifest;
    if (this._dictionary !== undefined) opts.dictionary = this._dictionary;
    const glyphPalette = this.getAttribute("glyph-palette");
    if (glyphPalette) opts.glyphPalette = glyphPalette;
    const charMode = parseCharMode(this.getAttribute("char-mode"));
    if (charMode !== undefined) opts.charMode = charMode;
    const wireframeJunctions = parseBool(this.getAttribute("wireframe-junctions"));
    if (wireframeJunctions !== undefined) opts.wireframeJunctions = wireframeJunctions;
    const hiddenLines = parseHiddenLines(this.getAttribute("hidden-lines"));
    if (hiddenLines !== undefined) opts.hiddenLines = hiddenLines;
    if (this._solidWeightRamp !== undefined) opts.solidWeightRamp = this._solidWeightRamp;
    const colorTolerance = parseColorTolerance(this.getAttribute("color-tolerance"));
    if (colorTolerance !== undefined) opts.colorTolerance = colorTolerance;
    const colorEncoding = parseColorEncoding(this.getAttribute("color-encoding"));
    if (colorEncoding !== undefined) opts.colorEncoding = colorEncoding;
    if (this._atlasPalette !== undefined) opts.atlasPalette = this._atlasPalette;
    const useColors = parseBool(this.getAttribute("use-colors"));
    if (useColors !== undefined) opts.useColors = useColors;
    const cols = parseNumber(this.getAttribute("cols"));
    if (cols !== undefined) opts.cols = cols;
    const rows = parseNumber(this.getAttribute("rows"));
    if (rows !== undefined) opts.rows = rows;
    const cellAspect = parseNumber(this.getAttribute("cell-aspect"));
    if (cellAspect !== undefined) opts.cellAspect = cellAspect;
    // `directional-direction` was in `OBSERVED_ATTRS` but never read, so the
    // light direction was pinned to this default and the attribute silently did
    // nothing. Either attribute alone now configures the light, with the other
    // falling back — same "x,y,z" comma form `<glyph-mesh position>` uses.
    const dirDirection = parseVec3(this.getAttribute("directional-direction"));
    const dirIntensity = parseNumber(this.getAttribute("directional-intensity"));
    if (dirDirection !== undefined || dirIntensity !== undefined) {
      opts.directionalLight = {
        direction: dirDirection ?? [0.5, 0.7, 0.5],
        intensity: dirIntensity ?? 1,
      };
    }
    const ambIntensity = parseNumber(this.getAttribute("ambient-intensity"));
    if (ambIntensity !== undefined) opts.ambientLight = { intensity: ambIntensity };
    if (this.hasAttribute("auto-size")) opts.autoSize = true;
    const interactiveDownscale = parseNumber(this.getAttribute("interactive-downscale"));
    if (interactiveDownscale !== undefined) opts.interactiveDownscale = interactiveDownscale;
    if (this.hasAttribute("shadow")) {
      const shadowOpts: GlyphShadowOptions = {
        color: "#000000",
        opacity: 0.25,
        lift: 0.05,
        maxExtend: 2000,
      };
      const shadowColor = this.getAttribute("shadow-color");
      if (shadowColor) shadowOpts.color = shadowColor;
      const shadowOpacity = parseNumber(this.getAttribute("shadow-opacity"));
      if (shadowOpacity !== undefined) shadowOpts.opacity = shadowOpacity;
      const shadowLift = parseNumber(this.getAttribute("shadow-lift"));
      if (shadowLift !== undefined) shadowOpts.lift = shadowLift;
      const shadowMaxExtend = parseNumber(this.getAttribute("shadow-max-extend"));
      if (shadowMaxExtend !== undefined) shadowOpts.maxExtend = shadowMaxExtend;
      opts.shadow = shadowOpts;
    }
    return opts;
  }

  private _applySemanticOptions(): void {
    if (!this._scene) return;
    const opts = this._readOptions();
    if (!this.hasAttribute("glyph-output")) opts.glyphOutput = "visible";
    if (this.getAttribute("glyph-output") === "semantic" && (!this._sceneManifest || !this._dictionary)) {
      // Properties may arrive independently. Keep the requested attribute while
      // retaining the last valid scene output until the pair can activate together.
      this._scene.setOptions({ ...opts, glyphOutput: "visible", sceneManifest: this._sceneManifest, dictionary: this._dictionary });
      return;
    }
    this._scene.setOptions(opts);
  }

  private _findCameraAncestor(): (HTMLElement & { getCamera?: () => unknown }) | null {
    let el: HTMLElement | null = this.parentElement;
    while (el) {
      const tag = el.tagName.toLowerCase();
      if (
        tag === "glyph-perspective-camera" ||
        tag === "glyph-orthographic-camera" ||
        tag === "glyph-camera"
      ) {
        return el as HTMLElement & { getCamera?: () => unknown };
      }
      el = el.parentElement;
    }
    return null;
  }

  private _initScene(cameraAncestor: HTMLElement & { getCamera?: () => unknown }): void {
    const camera = typeof cameraAncestor.getCamera === "function"
      ? (cameraAncestor.getCamera() as GlyphSceneOptions["camera"])
      : undefined;
    const opts = this._readOptions();
    // A custom element can receive its executable metadata after connection.
    // Preserve its requested semantic attribute but initialize the real scene in
    // the safe visible state until both values arrive.
    if (opts.glyphOutput === "semantic" && (!this._sceneManifest || !this._dictionary)) opts.glyphOutput = "visible";
    if (camera) opts.camera = camera;
    this._scene = createGlyphScene(this, opts);
    this.dispatchEvent(new CustomEvent("glyphcss:scene-ready", { bubbles: false }));
  }

  connectedCallback(): void {
    if (this._scene) return;
    const cameraAncestor = this._findCameraAncestor();
    if (!cameraAncestor) {
      throw new Error(
        "glyphcss: <glyph-scene> must be placed inside a <glyph-camera>, <glyph-perspective-camera>, or <glyph-orthographic-camera>.",
      );
    }
    const cam = typeof cameraAncestor.getCamera === "function"
      ? (cameraAncestor.getCamera() as unknown)
      : null;
    if (cam !== null) {
      // Camera already created — initialize immediately.
      this._initScene(cameraAncestor);
    } else {
      // Camera element connected after scene (ordering edge case in some environments).
      // Wait for the camera-ready event.
      const onReady = () => {
        cameraAncestor.removeEventListener("glyph:camera-ready", onReady);
        if (!this._scene) this._initScene(cameraAncestor);
      };
      cameraAncestor.addEventListener("glyph:camera-ready", onReady);
    }
  }

  rerender(): void {
    this._scene?.rerender();
  }

  disconnectedCallback(): void {
    if (this._scene) {
      this._scene.destroy();
      this._scene = null;
    }
  }

  attributeChangedCallback(
    _name: string,
    oldValue: string | null,
    newValue: string | null,
  ): void {
    if (oldValue === newValue) return;
    if (!this._scene) return;
    try {
      this._applySemanticOptions();
    } catch (error) {
      if (_name === "glyph-output") {
        if (oldValue === null) this.removeAttribute("glyph-output");
        else this.setAttribute("glyph-output", oldValue);
      }
      throw error;
    }
  }
}
