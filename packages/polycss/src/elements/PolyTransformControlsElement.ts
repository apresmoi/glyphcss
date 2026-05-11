/**
 * <poly-transform-controls> — declarative wrapper around `createTransformControls`.
 *
 * Behavior element: no rendered output. Sits inside <poly-scene> and walks
 * up via parent nodes to attach itself to the parent scene.
 *
 * Attributes:
 *   mode      — "translate" | "rotate" (default "translate")
 *   target    — CSS selector or id of a <poly-mesh> element to attach to
 *   size      — number, gizmo size multiplier (default 1)
 *   enabled   — boolean attr (default true, presence enables)
 *
 * Dispatches standard DOM events:
 *   polycss:object-change — fires on each drag tick with
 *     { detail: { position?, rotation? } }
 */
import { PolySceneElement } from "./PolySceneElement";
import { PolyMeshElement } from "./PolyMeshElement";
import {
  createTransformControls,
  type PolyTransformControlsHandle,
  type PolyTransformControlsOptions,
} from "../api/createTransformControls";
import { parseNumber } from "./parseAttr";

const ELEMENT_BASE: typeof HTMLElement =
  typeof HTMLElement !== "undefined"
    ? HTMLElement
    : (class {} as unknown as typeof HTMLElement);

const OBSERVED_ATTRS = [
  "mode",
  "target",
  "size",
  "enabled",
] as const;

function parseMode(value: string | null): "translate" | "rotate" | undefined {
  if (value === "translate" || value === "rotate") return value;
  return undefined;
}

export class PolyTransformControlsElement extends ELEMENT_BASE {
  static get observedAttributes(): string[] {
    return [...OBSERVED_ATTRS];
  }

  private _tc: PolyTransformControlsHandle | null = null;

  private _findScene(): PolySceneElement | null {
    let node: Node | null = this.parentNode;
    while (node) {
      if (node instanceof PolySceneElement) return node;
      node = node.parentNode;
    }
    return null;
  }

  private _findTargetMesh(): PolyMeshElement | null {
    const selector = this.getAttribute("target");
    if (!selector) return null;
    const sceneEl = this._findScene();
    if (!sceneEl) return null;
    // Try as id first, then as CSS selector
    let el: Element | null = null;
    try {
      el = sceneEl.querySelector(`#${selector}`) ??
           sceneEl.querySelector(selector);
    } catch {
      el = sceneEl.querySelector(`[id="${selector}"]`);
    }
    if (el instanceof PolyMeshElement) return el;
    return null;
  }

  private _readOptions(): PolyTransformControlsOptions {
    const opts: PolyTransformControlsOptions = {};
    const mode = parseMode(this.getAttribute("mode"));
    if (mode !== undefined) opts.mode = mode;
    const size = parseNumber(this.getAttribute("size"));
    if (size !== undefined) opts.size = size;
    const enabledAttr = this.getAttribute("enabled");
    if (enabledAttr !== null) opts.enabled = enabledAttr !== "false" && enabledAttr !== "0";
    opts.onObjectChange = (event) => {
      this.dispatchEvent(
        new CustomEvent("polycss:object-change", {
          bubbles: true,
          detail: { position: event.position, rotation: event.rotation },
        }),
      );
    };
    return opts;
  }

  private _attach(): void {
    if (this._tc) return;
    const sceneEl = this._findScene();
    const handle = sceneEl?.getScene();
    if (!handle) {
      if (sceneEl) {
        const onReady = (): void => {
          sceneEl.removeEventListener("polycss:scene-ready", onReady);
          this._attach();
        };
        sceneEl.addEventListener("polycss:scene-ready", onReady);
      }
      return;
    }
    this._tc = createTransformControls(handle, this._readOptions());
    // Try to attach to target mesh if specified
    const meshEl = this._findTargetMesh();
    if (meshEl) {
      const meshHandle = meshEl.getMeshHandle();
      if (meshHandle) this._tc.attach(meshHandle);
    }
  }

  connectedCallback(): void {
    this._attach();
  }

  disconnectedCallback(): void {
    if (this._tc) {
      this._tc.destroy();
      this._tc = null;
    }
  }

  attributeChangedCallback(
    name: string,
    oldValue: string | null,
    newValue: string | null,
  ): void {
    if (oldValue === newValue) return;
    if (!this._tc) return;
    if (name === "mode") {
      const mode = parseMode(newValue);
      if (mode) this._tc.setMode(mode);
    } else if (name === "target") {
      const meshEl = this._findTargetMesh();
      this._tc.attach(meshEl ? (meshEl.getMeshHandle() ?? null) : null);
    }
  }
}
