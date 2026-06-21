/**
 * `<glyph-first-person-controls>` — declarative first-person controls.
 *
 * Behavior element (no rendered output). Sits inside <glyph-scene> and attaches
 * to the parent scene. The full createGlyphFirstPersonControls option surface is
 * exposed via kebab-case attributes:
 *
 *   <glyph-first-person-controls
 *     enabled look-enabled move-enabled jump-enabled crouch-enabled
 *     look-sensitivity="0.2" invert-y move-speed="8" jump-velocity="10"
 *     gravity="20" eye-height="1.7" crouch-height="1" ground-z="0"
 *     min-pitch="5" max-pitch="175"
 *   ></glyph-first-person-controls>
 *
 * Requires a perspective camera (see createGlyphFirstPersonControls).
 */
import {
  createGlyphFirstPersonControls,
  type GlyphFirstPersonControlsHandle,
  type GlyphFirstPersonControlsOptions,
} from "../api/createGlyphFirstPersonControls";
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

function parseBool(value: string | null): boolean | undefined {
  if (value === null) return undefined;
  if (value === "false") return false;
  if (value === "true" || value === "") return true;
  return undefined;
}

function findScene(el: HTMLElement): GlyphSceneElement | null {
  const found = el.closest("glyph-scene") as unknown as GlyphSceneElement | null;
  return found ?? null;
}

const OBSERVED_ATTRS = [
  "enabled",
  "look-enabled",
  "move-enabled",
  "jump-enabled",
  "crouch-enabled",
  "look-sensitivity",
  "invert-y",
  "move-speed",
  "jump-velocity",
  "gravity",
  "eye-height",
  "crouch-height",
  "ground-z",
  "min-pitch",
  "max-pitch",
] as const;

export class GlyphFirstPersonControlsElement extends ELEMENT_BASE {
  static get observedAttributes(): string[] {
    return [...OBSERVED_ATTRS];
  }

  private _controls: GlyphFirstPersonControlsHandle | null = null;

  connectedCallback(): void { this._attach(); }

  disconnectedCallback(): void {
    if (this._controls) { this._controls.destroy(); this._controls = null; }
  }

  attributeChangedCallback(_name: string, old: string | null, next: string | null): void {
    if (old === next) return;
    this._controls?.update(this._readOptions());
  }

  private _readOptions(): GlyphFirstPersonControlsOptions {
    const opts: GlyphFirstPersonControlsOptions = {};
    const enabled = parseBool(this.getAttribute("enabled"));
    if (enabled !== undefined) opts.enabled = enabled;
    const lookEnabled = parseBool(this.getAttribute("look-enabled"));
    if (lookEnabled !== undefined) opts.lookEnabled = lookEnabled;
    const moveEnabled = parseBool(this.getAttribute("move-enabled"));
    if (moveEnabled !== undefined) opts.moveEnabled = moveEnabled;
    const jumpEnabled = parseBool(this.getAttribute("jump-enabled"));
    if (jumpEnabled !== undefined) opts.jumpEnabled = jumpEnabled;
    const crouchEnabled = parseBool(this.getAttribute("crouch-enabled"));
    if (crouchEnabled !== undefined) opts.crouchEnabled = crouchEnabled;
    const lookSensitivity = parseNumber(this.getAttribute("look-sensitivity"));
    if (lookSensitivity !== undefined) opts.lookSensitivity = lookSensitivity;
    if (this.hasAttribute("invert-y")) {
      const invertY = parseBool(this.getAttribute("invert-y"));
      if (invertY !== undefined) opts.invertY = invertY;
    }
    const moveSpeed = parseNumber(this.getAttribute("move-speed"));
    if (moveSpeed !== undefined) opts.moveSpeed = moveSpeed;
    const jumpVelocity = parseNumber(this.getAttribute("jump-velocity"));
    if (jumpVelocity !== undefined) opts.jumpVelocity = jumpVelocity;
    const gravity = parseNumber(this.getAttribute("gravity"));
    if (gravity !== undefined) opts.gravity = gravity;
    const eyeHeight = parseNumber(this.getAttribute("eye-height"));
    if (eyeHeight !== undefined) opts.eyeHeight = eyeHeight;
    const crouchHeight = parseNumber(this.getAttribute("crouch-height"));
    if (crouchHeight !== undefined) opts.crouchHeight = crouchHeight;
    const groundZ = parseNumber(this.getAttribute("ground-z"));
    if (groundZ !== undefined) opts.groundZ = groundZ;
    const minPitch = parseNumber(this.getAttribute("min-pitch"));
    if (minPitch !== undefined) opts.minPitch = minPitch;
    const maxPitch = parseNumber(this.getAttribute("max-pitch"));
    if (maxPitch !== undefined) opts.maxPitch = maxPitch;
    return opts;
  }

  private _attach(): void {
    if (this._controls) return;
    const sceneEl = findScene(this);
    if (!sceneEl) return;
    const handle = sceneEl.getScene();
    if (!handle) {
      const onReady = (): void => {
        sceneEl.removeEventListener("glyphcss:scene-ready", onReady);
        this._attach();
      };
      sceneEl.addEventListener("glyphcss:scene-ready", onReady);
      return;
    }
    this._controls = createGlyphFirstPersonControls(handle, this._readOptions());
  }
}
