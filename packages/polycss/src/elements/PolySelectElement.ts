/**
 * <poly-select> — declarative wrapper around `createSelect`.
 *
 * Behavior element: no rendered output. Sits inside <poly-scene> and walks
 * up via parent nodes to attach itself to the parent scene.
 *
 * Attributes:
 *   multiple     — boolean attr; when present, allows multi-select
 *   clear-on-miss — boolean attr (default true); when present, clicking
 *                   background clears selection
 *
 * Dispatches:
 *   polycss:select — fires on every selection change with
 *     { detail: { selected: PolyMeshHandle[] } }
 */
import { PolySceneElement } from "./PolySceneElement";
import { createSelect, type PolySelectionHandle } from "../api/createSelect";
import type { PolyMeshHandle } from "../api/createPolyScene";

const ELEMENT_BASE: typeof HTMLElement =
  typeof HTMLElement !== "undefined"
    ? HTMLElement
    : (class {} as unknown as typeof HTMLElement);

const OBSERVED_ATTRS = [
  "multiple",
  "clear-on-miss",
] as const;

export class PolySelectElement extends ELEMENT_BASE {
  static get observedAttributes(): string[] {
    return [...OBSERVED_ATTRS];
  }

  private _selection: PolySelectionHandle | null = null;

  private _findScene(): PolySceneElement | null {
    let node: Node | null = this.parentNode;
    while (node) {
      if (node instanceof PolySceneElement) return node;
      node = node.parentNode;
    }
    return null;
  }

  private _readOptions() {
    return {
      multiple: this.hasAttribute("multiple"),
      clearOnMiss: !this.hasAttribute("clear-on-miss") || this.getAttribute("clear-on-miss") !== "false",
      onChange: (meshes: PolyMeshHandle[]) => {
        this.dispatchEvent(
          new CustomEvent("polycss:select", {
            bubbles: true,
            detail: { selected: meshes },
          }),
        );
      },
    };
  }

  private _attach(): void {
    if (this._selection) return;
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
    this._selection = createSelect(handle, this._readOptions());
  }

  connectedCallback(): void {
    this._attach();
  }

  disconnectedCallback(): void {
    if (this._selection) {
      this._selection.destroy();
      this._selection = null;
    }
  }

  attributeChangedCallback(
    _name: string,
    oldValue: string | null,
    newValue: string | null,
  ): void {
    if (oldValue === newValue) return;
    // Re-create to pick up the new options (createSelect doesn't have an update() method)
    if (this._selection) {
      this._selection.destroy();
      this._selection = null;
    }
    this._attach();
  }
}
