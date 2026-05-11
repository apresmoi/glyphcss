/**
 * <poly-orbit-controls> — declarative wrapper around `createPolyOrbitControls`.
 *
 * Behavior element: no rendered output. Sits inside <poly-scene> and walks
 * up via parent nodes to attach itself to the parent scene.
 * The full options surface from createPolyOrbitControls is exposed via
 * kebab-case attributes:
 *
 *   <poly-orbit-controls
 *     drag                                  (presence enables, omit = enabled too — drag defaults true)
 *     wheel
 *     dolly                                 (presence enables dolly mode — wheel changes distance)
 *     min-distance="0"                      (minimum dolly distance in CSS px, used when dolly is on)
 *     max-distance="5000"                   (maximum dolly distance in CSS px, used when dolly is on)
 *     animate-speed="0.3"                   (any animate-* attribute implies animate is on)
 *     animate-axis="y"                      ("x" | "y", default "y")
 *     animate-pause-on-interaction          (presence enables, default true)
 *     invert="false"                        (or a number for sensitivity)
 *     zoom-min="0.1"
 *     zoom-max="10"
 *   ></poly-orbit-controls>
 */
import { PolySceneElement } from "./PolySceneElement";
import {
  createPolyOrbitControls,
  type PolyOrbitControlsHandle,
  type PolyOrbitControlsOptions,
} from "../api/createPolyOrbitControls";
import { parseNumber, parseBoolAttr, parseInvert, parseAxis } from "./parseAttr";

const ELEMENT_BASE: typeof HTMLElement =
  typeof HTMLElement !== "undefined"
    ? HTMLElement
    : (class {} as unknown as typeof HTMLElement);

const OBSERVED_ATTRS = [
  "drag",
  "wheel",
  "dolly",
  "min-distance",
  "max-distance",
  "invert",
  "zoom-min",
  "zoom-max",
  "animate-speed",
  "animate-axis",
  "animate-pause-on-interaction",
] as const;


export class PolyOrbitControlsElement extends ELEMENT_BASE {
  static get observedAttributes(): string[] {
    return [...OBSERVED_ATTRS];
  }

  private _controls: PolyOrbitControlsHandle | null = null;

  private _readAnimate(): PolyOrbitControlsOptions["animate"] | undefined {
    const speed = parseNumber(this.getAttribute("animate-speed"));
    const axis = parseAxis(this.getAttribute("animate-axis"));
    const pauseAttr = this.getAttribute("animate-pause-on-interaction");
    const hasAny =
      this.hasAttribute("animate-speed") ||
      this.hasAttribute("animate-axis") ||
      this.hasAttribute("animate-pause-on-interaction");
    if (!hasAny) return undefined;
    return {
      ...(speed !== undefined ? { speed } : {}),
      ...(axis !== undefined ? { axis } : {}),
      ...(pauseAttr !== null ? { pauseOnInteraction: parseBoolAttr(pauseAttr) } : {}),
    };
  }

  private _readOptions(): PolyOrbitControlsOptions {
    const opts: PolyOrbitControlsOptions = {};
    const drag = parseBoolAttr(this.getAttribute("drag"));
    if (drag !== undefined) opts.drag = drag;
    const wheel = parseBoolAttr(this.getAttribute("wheel"));
    if (wheel !== undefined) opts.wheel = wheel;
    if (this.hasAttribute("dolly")) opts.dolly = true;
    const minDistance = parseNumber(this.getAttribute("min-distance"));
    if (minDistance !== undefined) opts.minDistance = minDistance;
    const maxDistance = parseNumber(this.getAttribute("max-distance"));
    if (maxDistance !== undefined) opts.maxDistance = maxDistance;
    const invert = parseInvert(this.getAttribute("invert"));
    if (invert !== undefined) opts.invert = invert;
    const zoomMin = parseNumber(this.getAttribute("zoom-min"));
    const zoomMax = parseNumber(this.getAttribute("zoom-max"));
    if (zoomMin !== undefined) opts.minZoom = zoomMin;
    if (zoomMax !== undefined) opts.maxZoom = zoomMax;
    opts.animate = this._readAnimate() ?? false;
    return opts;
  }

  private _findScene(): PolySceneElement | null {
    let node: Node | null = this.parentNode;
    while (node) {
      if (node instanceof PolySceneElement) return node;
      node = node.parentNode;
    }
    return null;
  }

  private _attach(): void {
    if (this._controls) return;
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
    this._controls = createPolyOrbitControls(handle, this._readOptions());
  }

  connectedCallback(): void {
    this._attach();
  }

  disconnectedCallback(): void {
    if (this._controls) {
      this._controls.destroy();
      this._controls = null;
    }
  }

  attributeChangedCallback(
    _name: string,
    oldValue: string | null,
    newValue: string | null,
  ): void {
    if (oldValue === newValue) return;
    if (!this._controls) return;
    this._controls.update(this._readOptions());
  }
}
