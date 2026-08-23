import type {
  GlyphEffectBlend,
  GlyphEffectDefinition,
  GlyphEffectLayerHandle,
  GlyphEffectParamSchema,
  GlyphEffectParamValue,
  GlyphEffectTarget,
} from "../api/effects";
import type { GlyphSceneHandle } from "../api/createGlyphScene";
import type { GlyphSceneElement } from "./GlyphSceneElement";

const ELEMENT_BASE: typeof HTMLElement =
  typeof HTMLElement !== "undefined"
    ? HTMLElement
    : (class {} as unknown as typeof HTMLElement);

type RuntimeParams = Record<string, GlyphEffectParamValue>;
type RuntimeDefinition = GlyphEffectDefinition<GlyphEffectParamSchema, any>;
type RuntimeHandle = GlyphEffectLayerHandle<RuntimeParams>;

declare global {
  interface HTMLElementTagNameMap {
    "glyph-effect-layer": GlyphEffectLayerElement;
  }
}

export interface GlyphEffectLayerElementConfig {
  effect: RuntimeDefinition;
  params?: Partial<RuntimeParams>;
  target?: GlyphEffectTarget;
  blend?: GlyphEffectBlend;
  opacity?: number;
  order?: number;
  enabled?: boolean;
  /**
   * Program-as-data (VOLUMETRIC-3.md §4) — JS property, not an attribute
   * (the program is data, the same rule `sceneManifest`/`dictionary` use
   * elsewhere): configured through `.configure()` or by setting
   * `.effect`/a fresh `configure()` call, never through a DOM attribute.
   * Forwarded to `scene.addEffectLayer` only when the underlying handle is
   * (re)created (a new `effect` reference) — it's immutable after mount
   * (`setOptions` throws on a change), so changing `program` alone on an
   * already-mounted layer's config is a silent no-op, matching that
   * immutability rather than throwing from inside the flush microtask.
   */
  program?: unknown;
  /**
   * Program-as-data's NAMED sibling (VOLUMETRIC-4.md §1) — same JS-property-
   * only, mount-only-forward, immutable-after-mount contract as `program`
   * above, for a definition that drives a second independent program (e.g.
   * field-synth's colour voice stack).
   */
  colorProgram?: unknown;
}

function parseFinite(value: string | null): number | undefined {
  if (value === null) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseEnabled(value: string | null): boolean | undefined {
  if (value === null) return undefined;
  return value !== "false";
}

function definitionDefaults(effect: RuntimeDefinition): RuntimeParams {
  const params: RuntimeParams = {};
  for (const [key, spec] of Object.entries(effect.parameterSchema)) params[key] = spec.default;
  return params;
}

export class GlyphEffectLayerElement extends ELEMENT_BASE {
  static get observedAttributes(): string[] {
    return ["target", "blend", "opacity", "order", "enabled"];
  }

  private _config: GlyphEffectLayerElementConfig | null = null;
  private _handle: RuntimeHandle | null = null;
  private _handleEffect: RuntimeDefinition | null = null;
  private _appliedParams: RuntimeParams | null = null;
  private _scheduled = false;
  private _sceneElement: GlyphSceneElement | null = null;
  private _readyWaiters: Array<(handle: RuntimeHandle) => void> = [];

  get effect(): RuntimeDefinition | null {
    return this._config?.effect ?? null;
  }

  set effect(effect: RuntimeDefinition | null) {
    if (effect === null) {
      this.configure(null);
      return;
    }
    this._config = { ...(this._config ?? { effect }), effect };
    this._schedule();
  }

  get params(): RuntimeParams | Partial<RuntimeParams> {
    return this._handle?.params ?? this._config?.params ?? {};
  }

  set params(params: Partial<RuntimeParams>) {
    if (!params || typeof params !== "object" || Array.isArray(params)) {
      throw new TypeError("glyphcss: <glyph-effect-layer>.params must be a flat parameter object.");
    }
    if (!this._config) {
      throw new Error("glyphcss: set <glyph-effect-layer>.effect before assigning params.");
    }
    this._config = { ...this._config, params: { ...params } };
    this._schedule();
  }

  getEffectHandle(): RuntimeHandle | null {
    return this._handle;
  }

  whenReady(): Promise<RuntimeHandle> {
    if (this._handle) return Promise.resolve(this._handle);
    return new Promise((resolve) => this._readyWaiters.push(resolve));
  }

  configure(config: GlyphEffectLayerElementConfig | null): void {
    this._config = config
      ? { ...config, ...(config.params ? { params: { ...config.params } } : {}) }
      : null;
    this._schedule();
  }

  connectedCallback(): void {
    this._schedule();
  }

  disconnectedCallback(): void {
    this._detachSceneListener();
    this._disposeHandle();
  }

  attributeChangedCallback(
    _name: string,
    oldValue: string | null,
    newValue: string | null,
  ): void {
    if (oldValue !== newValue) this._schedule();
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
      this._emitError(new Error("glyphcss: <glyph-effect-layer> must be used inside <glyph-scene>."));
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

  private _resolvedOptions(config: GlyphEffectLayerElementConfig) {
    const targetAttribute = this.getAttribute("target");
    const target = targetAttribute === "viewport" || targetAttribute === "surfaces"
      ? targetAttribute
      : config.target;
    const blendAttribute = this.getAttribute("blend");
    const blend = blendAttribute === "replace" || blendAttribute === "over"
      ? blendAttribute
      : config.blend;
    return {
      target,
      blend,
      opacity: parseFinite(this.getAttribute("opacity")) ?? config.opacity,
      order: parseFinite(this.getAttribute("order")) ?? config.order,
      enabled: parseEnabled(this.getAttribute("enabled")) ?? config.enabled,
    };
  }

  private _flush(): void {
    const config = this._config;
    if (!config) {
      this._disposeHandle();
      return;
    }
    const scene = this._scene();
    if (!scene) return;
    const options = this._resolvedOptions(config);
    const params = {
      ...definitionDefaults(config.effect),
      ...(config.params ?? {}),
    } as RuntimeParams;
    try {
      if (!this._handle || this._handleEffect !== config.effect) {
        this._disposeHandle();
        const handle = scene.addEffectLayer({
          effect: config.effect,
          params,
          ...(config.program !== undefined ? { program: config.program } : {}),
          ...(config.colorProgram !== undefined ? { colorProgram: config.colorProgram } : {}),
          ...options,
        }) as RuntimeHandle;
        this._handle = handle;
        this._handleEffect = config.effect;
        this._appliedParams = params;
        for (const resolve of this._readyWaiters.splice(0)) resolve(handle);
        this.dispatchEvent(new CustomEvent("glyphcss:effect-ready", {
          detail: { handle },
          bubbles: false,
        }));
        return;
      }
      const changedParams: Partial<RuntimeParams> = {};
      for (const [name, value] of Object.entries(params)) {
        if (!this._appliedParams || !Object.is(this._appliedParams[name], value)) {
          changedParams[name] = value;
        }
      }
      if (Object.keys(changedParams).length > 0) this._handle.setParams(changedParams);
      this._appliedParams = params;
      this._handle.setOptions(options);
    } catch (error) {
      this._emitError(error);
    }
  }

  private _disposeHandle(): void {
    this._handle?.dispose();
    this._handle = null;
    this._handleEffect = null;
    this._appliedParams = null;
  }

  private _emitError(error: unknown): void {
    this.dispatchEvent(new CustomEvent("glyphcss:error", { detail: error, bubbles: true }));
  }
}
