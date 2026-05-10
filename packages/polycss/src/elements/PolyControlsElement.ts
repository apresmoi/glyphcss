/**
 * <poly-controls> — declarative wrapper around `createPolyControls`.
 *
 * Behavior element: no rendered output. Sits inside <poly-scene> and walks
 * up via `closest("poly-scene")` to attach itself to the parent scene.
 * Mirrors the A-Frame component pattern. The full options surface from
 * createPolyControls is exposed via kebab-case attributes:
 *
 *   <poly-controls
 *     drag                                  (presence enables, omit = enabled too — drag defaults true)
 *     wheel
 *     animate-speed="0.3"                   (any animate-* attribute implies animate is on)
 *     animate-axis="y"                      ("x" | "y", default "y")
 *     animate-pause-on-interaction          (presence enables, default true)
 *     invert="false"                        (or a number for sensitivity)
 *     zoom-min="0.1"
 *     zoom-max="10"
 *   ></poly-controls>
 *
 * The presence-based booleans match HTML convention (presence = true),
 * EXCEPT drag/wheel — those default true at the JS layer, so absence of
 * the attribute means "use the default". Pass `drag="false"` (or omit and
 * pass it programmatically) to disable.
 */
import { PolySceneElement } from "./PolySceneElement";
import {
  createPolyControls,
  type ControlsHandle,
  type PolyControlsOptions,
} from "../api/createPolyControls";

const ELEMENT_BASE: typeof HTMLElement =
  typeof HTMLElement !== "undefined"
    ? HTMLElement
    : (class {} as unknown as typeof HTMLElement);

const OBSERVED_ATTRS = [
  "drag",
  "wheel",
  "mode",
  "invert",
  "zoom-min",
  "zoom-max",
  "animate-speed",
  "animate-axis",
  "animate-pause-on-interaction",
] as const;

function parseNumber(value: string | null): number | undefined {
  if (value == null) return undefined;
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Boolean attribute parsing — distinguishes "absent" (= use default) from
 * "explicit false". `drag="false"` is true-presence in HTML semantics, so
 * we have to look at the value: `value === "false"` → false, anything else
 * (including empty string from `<poly-controls drag>`) → true.
 *
 * Returns undefined when the attribute is absent, so resolveOptions can
 * fall back to the JS-layer default rather than overriding it with false.
 */
function parseBoolAttr(value: string | null): boolean | undefined {
  if (value === null) return undefined;
  if (value === "false" || value === "0") return false;
  return true;
}

/**
 * Invert can be a boolean OR a number (sensitivity multiplier). Treat
 * numeric strings as numbers; "true"/"false" as booleans; absent as
 * undefined (use default).
 */
function parseInvert(value: string | null): boolean | number | undefined {
  if (value === null) return undefined;
  if (value === "true") return true;
  if (value === "false") return false;
  const n = parseFloat(value);
  if (Number.isFinite(n)) return n;
  // Empty string from `<poly-controls invert>` → presence = true.
  return true;
}

function parseAxis(value: string | null): "x" | "y" | undefined {
  if (value === "x" || value === "y") return value;
  return undefined;
}

function parseDragMode(value: string | null): "orbit" | "pan" | undefined {
  if (value === "orbit" || value === "pan") return value;
  return undefined;
}

export class PolyControlsElement extends ELEMENT_BASE {
  static get observedAttributes(): string[] {
    return [...OBSERVED_ATTRS];
  }

  private _controls: ControlsHandle | null = null;

  /**
   * The animate sub-object is built from any animate-* attribute. If at
   * least one is present, animate is enabled; otherwise it stays off.
   */
  private _readAnimate(): PolyControlsOptions["animate"] | undefined {
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

  private _readOptions(): PolyControlsOptions {
    const opts: PolyControlsOptions = {};
    const drag = parseBoolAttr(this.getAttribute("drag"));
    if (drag !== undefined) opts.drag = drag;
    const wheel = parseBoolAttr(this.getAttribute("wheel"));
    if (wheel !== undefined) opts.wheel = wheel;
    const mode = parseDragMode(this.getAttribute("mode"));
    if (mode !== undefined) opts.mode = mode;
    const invert = parseInvert(this.getAttribute("invert"));
    if (invert !== undefined) opts.invert = invert;
    const zoomMin = parseNumber(this.getAttribute("zoom-min"));
    const zoomMax = parseNumber(this.getAttribute("zoom-max"));
    if (zoomMin !== undefined) opts.minZoom = zoomMin;
    if (zoomMax !== undefined) opts.maxZoom = zoomMax;
    // Always emit an explicit animate value so removing every animate-*
    // attribute propagates as "off" through controls.update() — without
    // this, omitting the field leaves resolveOptions to keep the prior
    // animate config, which would silently keep the loop running after
    // the user removed all animate attributes.
    opts.animate = this._readAnimate() ?? false;
    return opts;
  }

  /**
   * Locate the parent scene by walking up the DOM tree. We look for the
   * element class rather than a tag name so descendants nested inside
   * other custom elements are still attached correctly. Returns null when
   * the controls element is detached or sits outside any <poly-scene>.
   */
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
      // No parent scene yet — could be that the scene element hasn't
      // upgraded/connected yet. Listen once for its ready signal.
      if (sceneEl) {
        const onReady = (): void => {
          sceneEl.removeEventListener("polycss:scene-ready", onReady);
          this._attach();
        };
        sceneEl.addEventListener("polycss:scene-ready", onReady);
      }
      return;
    }
    this._controls = createPolyControls(handle, this._readOptions());
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
