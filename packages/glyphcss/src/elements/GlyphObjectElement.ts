/**
 * `<glyph-object position="…" scale="…" rotation="…">` — mounts a
 * `GlyphSceneObject` (PLAN-3d.md §3.1) into the closest `<glyph-scene>`.
 *
 * `.object` is a JS property, not an attribute — meshes/overlays/samplers
 * are data, the same rule `<glyph-effect-layer>`'s `.effect`/`.program`
 * follow (see AGENTS.md's "HTML custom elements" naming section).
 */
import type { Vec3 } from "@glyphcss/core";
import type { GlyphSceneHandle, GlyphSceneObject, GlyphSceneObjectHandle, GlyphSceneObjectTransform } from "../api/createGlyphScene";
import type { GlyphSceneElement } from "./GlyphSceneElement";

const ELEMENT_BASE: typeof HTMLElement =
  typeof HTMLElement !== "undefined"
    ? HTMLElement
    : (class {} as unknown as typeof HTMLElement);

function parseVec3(value: string | null): Vec3 | undefined {
  if (!value) return undefined;
  const parts = value.split(",").map((p) => parseFloat(p.trim()));
  if (parts.length !== 3 || parts.some((p) => !Number.isFinite(p))) return undefined;
  return [parts[0]!, parts[1]!, parts[2]!];
}

function parseScale(value: string | null): number | Vec3 | undefined {
  if (!value) return undefined;
  if (!value.includes(",")) {
    const n = parseFloat(value);
    return Number.isFinite(n) ? n : undefined;
  }
  return parseVec3(value);
}

export class GlyphObjectElement extends ELEMENT_BASE {
  static get observedAttributes(): string[] {
    return ["position", "scale", "rotation"];
  }

  private _object: GlyphSceneObject | null = null;
  private _handle: GlyphSceneObjectHandle | null = null;
  private _scheduled = false;
  private _sceneElement: GlyphSceneElement | null = null;

  get object(): GlyphSceneObject | null {
    return this._object;
  }

  set object(value: GlyphSceneObject | null) {
    this._object = value;
    this._schedule();
  }

  getObjectHandle(): GlyphSceneObjectHandle | null {
    return this._handle;
  }

  connectedCallback(): void {
    this._schedule();
  }

  disconnectedCallback(): void {
    this._detachSceneListener();
    this._dispose();
  }

  attributeChangedCallback(_name: string, oldValue: string | null, newValue: string | null): void {
    if (oldValue !== newValue) this._schedule();
  }

  private _readTransform(): GlyphSceneObjectTransform {
    return {
      position: parseVec3(this.getAttribute("position")),
      scale: parseScale(this.getAttribute("scale")),
      rotation: parseVec3(this.getAttribute("rotation")),
    };
  }

  private _schedule(): void {
    if (this._scheduled || !this.isConnected) return;
    this._scheduled = true;
    Promise.resolve().then(() => {
      this._scheduled = false;
      if (this.isConnected) this._flush();
    });
  }

  private _findSceneElement(): GlyphSceneElement | null {
    return this.closest("glyph-scene") as GlyphSceneElement | null;
  }

  private _detachSceneListener(): void {
    this._sceneElement?.removeEventListener("glyphcss:scene-ready", this._onSceneReady);
    this._sceneElement = null;
  }

  private readonly _onSceneReady = (): void => {
    this._detachSceneListener();
    this._schedule();
  };

  private _scene(): GlyphSceneHandle | null {
    const sceneElement = this._findSceneElement();
    if (!sceneElement) {
      this._emitError(new Error("glyphcss: <glyph-object> must be used inside <glyph-scene>."));
      return null;
    }
    const scene = sceneElement.getScene();
    if (scene) {
      this._detachSceneListener();
      return scene;
    }
    if (this._sceneElement !== sceneElement) {
      this._detachSceneListener();
      this._sceneElement = sceneElement;
      sceneElement.addEventListener("glyphcss:scene-ready", this._onSceneReady);
    }
    return null;
  }

  private _flush(): void {
    if (!this._object) {
      this._dispose();
      return;
    }
    const scene = this._scene();
    if (!scene) return;
    const transform = this._readTransform();
    try {
      if (!this._handle) {
        const handle = scene.addObject(this._object, transform);
        this._handle = handle;
        this.dispatchEvent(new CustomEvent("glyphcss:object-ready", { detail: { handle }, bubbles: false }));
        return;
      }
      this._handle.update(this._object);
      this._handle.setTransform(transform);
    } catch (error) {
      this._emitError(error);
    }
  }

  private _dispose(): void {
    this._handle?.remove();
    this._handle = null;
  }

  private _emitError(error: unknown): void {
    this.dispatchEvent(new CustomEvent("glyphcss:error", { detail: error, bubbles: true }));
  }
}
