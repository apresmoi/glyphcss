/**
 * <poly-scene> custom element. Vanilla counterpart to React's <PolyScene>.
 *
 * On `connectedCallback`, instantiates a `createPolyScene(this, options)` and
 * stores the handle. Children (<poly-mesh>, <poly-polygon>) walk up the tree
 * to find this element via `closest("poly-scene")` and call its `getScene()`
 * to register themselves.
 *
 * Attribute parsing — minimal-footprint string → typed conversion. Unknown
 * attributes are ignored (HTML semantics, not validation).
 */
import type { DirectionalLight, Vec3 } from "@polycss/core";
import {
  createPolyScene,
  type PolySceneOptions,
  type SceneHandle,
} from "../api/createPolyScene";

const ELEMENT_BASE: typeof HTMLElement =
  typeof HTMLElement !== "undefined"
    ? HTMLElement
    : (class {} as unknown as typeof HTMLElement);

const OBSERVED_ATTRS = [
  "perspective",
  "rot-x",
  "rot-y",
  "zoom",
  "light-direction",
  "light-color",
  "light-ambient",
  "light-ambient-color",
  "merge",
  "projection",
  "auto-center",
] as const;

function parseNumber(value: string | null): number | undefined {
  if (value == null) return undefined;
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : undefined;
}

function parseVec3(value: string | null): Vec3 | undefined {
  if (!value) return undefined;
  const parts = value.split(",").map((p) => parseFloat(p.trim()));
  if (parts.length !== 3 || parts.some((p) => !Number.isFinite(p))) {
    return undefined;
  }
  return [parts[0], parts[1], parts[2]];
}

function parseMerge(value: string | null): "off" | "auto" | undefined {
  if (!value) return undefined;
  if (value === "off" || value === "auto") return value;
  return undefined;
}

export class PolySceneElement extends ELEMENT_BASE {
  static get observedAttributes(): string[] {
    return [...OBSERVED_ATTRS];
  }

  private _scene: SceneHandle | null = null;

  /**
   * Returns the underlying SceneHandle. Children call this during their own
   * connectedCallback to register meshes.
   */
  getScene(): SceneHandle | null {
    return this._scene;
  }

  private _readOptions(): PolySceneOptions {
    const directionalLight = this._readLight();
    const opts: PolySceneOptions = {};
    const perspective = parseNumber(this.getAttribute("perspective"));
    if (perspective !== undefined) opts.perspective = perspective;
    const rotX = parseNumber(this.getAttribute("rot-x"));
    if (rotX !== undefined) opts.rotX = rotX;
    const rotY = parseNumber(this.getAttribute("rot-y"));
    if (rotY !== undefined) opts.rotY = rotY;
    const zoom = parseNumber(this.getAttribute("zoom"));
    if (zoom !== undefined) opts.zoom = zoom;
    const merge = parseMerge(this.getAttribute("merge"));
    if (merge !== undefined) opts.merge = merge;
    const projection = this.getAttribute("projection");
    if (projection === "cubic" || projection === "dimetric") {
      opts.projection = projection;
    }
    if (this.hasAttribute("auto-center")) opts.autoCenter = true;
    if (directionalLight) opts.directionalLight = directionalLight;
    return opts;
  }

  private _readLight(): DirectionalLight | undefined {
    const direction = parseVec3(this.getAttribute("light-direction"));
    const color = this.getAttribute("light-color") || undefined;
    const ambientColor = this.getAttribute("light-ambient-color") || undefined;
    const ambient = parseNumber(this.getAttribute("light-ambient"));
    if (!direction && !color && !ambientColor && ambient === undefined) {
      return undefined;
    }
    const light: DirectionalLight = {
      direction: direction ?? [0.4, -0.7, 0.59],
    };
    if (color) light.color = color;
    if (ambientColor) light.ambientColor = ambientColor;
    if (ambient !== undefined) light.ambient = ambient;
    return light;
  }

  connectedCallback(): void {
    if (this._scene) return;
    this._scene = createPolyScene(this, this._readOptions());
    // Notify any descendant <poly-mesh> / <poly-polygon> elements that the
    // scene is ready. They listen for this on connect via a custom event so
    // their own connectedCallback (which may fire BEFORE the scene's, when
    // the scene is hydrated upgrade-after-children) can retry.
    this.dispatchEvent(
      new CustomEvent("polycss:scene-ready", { bubbles: false }),
    );
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
    this._scene.setOptions(this._readOptions());
  }
}
