/**
 * `<glyphcss-perspective-camera>` — declarative perspective camera.
 * Walks up to the parent `<glyphcss-scene>` and replaces its camera.
 */
import { createGlyphcssPerspectiveCamera } from "../api/createGlyphcssCamera";
import type { GlyphcssSceneElement } from "./GlyphcssSceneElement";

const ELEMENT_BASE: typeof HTMLElement =
  typeof HTMLElement !== "undefined"
    ? HTMLElement
    : (class {} as unknown as typeof HTMLElement);

function parseNumber(value: string | null): number | undefined {
  if (value == null) return undefined;
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : undefined;
}

function findScene(el: HTMLElement): GlyphcssSceneElement | null {
  const found = el.closest("glyphcss-scene") as unknown as (GlyphcssSceneElement & { getScene?: () => unknown }) | null;
  return found ?? null;
}

export class GlyphcssPerspectiveCameraElement extends ELEMENT_BASE {
  static get observedAttributes(): string[] {
    return ["rot-x", "rot-y", "distance", "scale", "stretch"];
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
    const cam = createGlyphcssPerspectiveCamera({
      rotX: parseNumber(this.getAttribute("rot-x")),
      rotY: parseNumber(this.getAttribute("rot-y")),
      distance: parseNumber(this.getAttribute("distance")),
      scale: parseNumber(this.getAttribute("scale")),
      stretch: parseNumber(this.getAttribute("stretch")),
    });
    scene.setOptions({ camera: cam });
  }
}
