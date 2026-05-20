/**
 * `<glyph-perspective-camera>` — declarative perspective camera.
 * Walks up to the parent `<glyph-scene>` and replaces its camera.
 */
import { createGlyphPerspectiveCamera } from "../api/createGlyphCamera";
import type { GlyphSceneElement } from "./GlyphSceneElement";

const ELEMENT_BASE: typeof HTMLElement =
  typeof HTMLElement !== "undefined"
    ? HTMLElement
    : (class {} as unknown as typeof HTMLElement);

function parseNumber(value: string | null): number | undefined {
  if (value == null) return undefined;
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : undefined;
}

function findScene(el: HTMLElement): GlyphSceneElement | null {
  const found = el.closest("glyph-scene") as unknown as (GlyphSceneElement & { getScene?: () => unknown }) | null;
  return found ?? null;
}

export class GlyphPerspectiveCameraElement extends ELEMENT_BASE {
  static get observedAttributes(): string[] {
    return ["rot-x", "rot-y", "distance", "zoom", "stretch"];
  }

  connectedCallback(): void { this._apply(); }

  attributeChangedCallback(_name: string, old: string | null, next: string | null): void {
    if (old === next) return;
    this._apply();
  }

  private _apply(): void {
    const sceneEl = findScene(this);
    const scene = sceneEl?.getScene();
    if (!scene) return;
    const cam = createGlyphPerspectiveCamera({
      rotX: parseNumber(this.getAttribute("rot-x")),
      rotY: parseNumber(this.getAttribute("rot-y")),
      distance: parseNumber(this.getAttribute("distance")),
      zoom: parseNumber(this.getAttribute("zoom")),
      stretch: parseNumber(this.getAttribute("stretch")),
    });
    scene.setOptions({ camera: cam });
  }
}
