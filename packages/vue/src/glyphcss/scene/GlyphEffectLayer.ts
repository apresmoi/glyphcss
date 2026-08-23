import {
  defineComponent,
  inject,
  onBeforeUnmount,
  shallowRef,
  watch,
} from "vue";
import type { PropType, VNode } from "vue";
import type {
  GlyphEffectDefinition,
  GlyphEffectDefinitionLayerOptions,
  GlyphEffectLayerCommonOptions,
  GlyphEffectLayerHandle,
  GlyphEffectParamSchema,
  GlyphEffectParamShape,
  GlyphEffectParamValue,
  GlyphEffectParamValues,
  GlyphEffectProgram,
  GlyphEffectProgramBase,
  GlyphEffectProgramLayerOptions,
  GlyphEffectTarget,
  GlyphEffectBlend,
} from "glyphcss";
import { GlyphSceneContextKey } from "./context";

type RuntimeParams = Record<string, GlyphEffectParamValue>;
type RuntimeEffect =
  | GlyphEffectDefinition<any, any>
  | GlyphEffectProgram<any, any>;
type RuntimeHandle = GlyphEffectLayerHandle<RuntimeParams>;

export type GlyphEffectLayerProps<
  Schema extends GlyphEffectParamSchema = GlyphEffectParamSchema,
  P extends GlyphEffectParamShape<P> = RuntimeParams,
  State = undefined,
> =
  | GlyphEffectDefinitionLayerOptions<Schema, State>
  | GlyphEffectProgramLayerOptions<P, State>;

export type GlyphEffectLayerExposed<
  P extends object = RuntimeParams,
> = GlyphEffectLayerHandle<P>;

type GlyphEffectLayerEffect =
  | {
    readonly id: string;
    readonly version: number;
    readonly parameterSchema: GlyphEffectParamSchema;
    readonly program: object;
  }
  | { evaluate(...args: any[]): void };

type GlyphEffectProgramLike<P extends GlyphEffectParamShape<P>> =
  | GlyphEffectProgram<P>
  | (GlyphEffectProgramBase<P, any> & { createState(): any });

type GlyphEffectLayerParamsFor<Effect, P> =
  Effect extends { readonly parameterSchema: infer Schema extends GlyphEffectParamSchema }
    ? GlyphEffectParamValues<Schema>
    : P;

type GlyphEffectLayerPropsFor<
  Effect,
  P extends GlyphEffectParamShape<P>,
> = Effect extends {
  readonly parameterSchema: infer Schema extends GlyphEffectParamSchema;
}
  ? {
    effect: Effect;
    params?: Partial<GlyphEffectParamValues<Schema>>;
    /** Program-as-data (VOLUMETRIC-3.md §4) — see `RuntimeProps.program`'s doc below. */
    program?: unknown;
    /** Program-as-data's NAMED sibling (VOLUMETRIC-4.md §1) — see `RuntimeProps.colorProgram`'s doc below. */
    colorProgram?: unknown;
  } & GlyphEffectLayerCommonOptions
  : {
    effect: Effect & GlyphEffectProgramLike<P>;
    params: P;
  } & GlyphEffectLayerCommonOptions;

export interface GlyphEffectLayerComponent {
  <
    Effect extends GlyphEffectLayerEffect,
    P extends GlyphEffectParamShape<P> = RuntimeParams,
  >(
    props: GlyphEffectLayerPropsFor<Effect, P>,
  ): VNode & {
    __ctx?: GlyphEffectLayerExposed<GlyphEffectLayerParamsFor<Effect, P>>;
  };
}

interface RuntimeProps {
  effect: RuntimeEffect;
  params?: Partial<RuntimeParams>;
  target?: GlyphEffectTarget;
  blend?: GlyphEffectBlend;
  opacity?: number;
  order?: number;
  enabled?: boolean;
  /**
   * Program-as-data (VOLUMETRIC-3.md §4) — a definition-layer-only option
   * (opaque to glyphcss and this wrapper alike), forwarded to
   * `scene.addEffectLayer` ONLY at layer creation: it's immutable after
   * mount (the imperative handle's `setOptions` throws on a change — see
   * `GlyphEffectDefinitionLayerOptions.program`'s own doc), so this wrapper
   * doesn't diff/re-apply it the way `target`/`blend`/etc. are. Changing
   * the prop after creation is a silent no-op here, matching that
   * immutability rather than throwing from inside a watcher.
   */
  program?: unknown;
  /**
   * Program-as-data's NAMED sibling (VOLUMETRIC-4.md §1) — same
   * creation-only-forward, immutable-after-creation contract as `program`
   * above, for a definition that drives a second independent program (e.g.
   * field-synth's colour voice stack).
   */
  colorProgram?: unknown;
}

interface NormalizedLayerOptions {
  target: GlyphEffectTarget;
  blend: GlyphEffectBlend;
  opacity: number;
  order: number;
  enabled: boolean;
}

function own(object: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function snapshotParams(params: Partial<RuntimeParams> | undefined): Partial<RuntimeParams> {
  return params ? { ...params } : {};
}

function definitionDefaults(effect: RuntimeEffect): RuntimeParams | null {
  if (!("parameterSchema" in effect)) return null;
  const defaults: RuntimeParams = {};
  for (const [key, spec] of Object.entries(
    effect.parameterSchema as GlyphEffectParamSchema,
  )) {
    defaults[key] = spec.default;
  }
  return defaults;
}

function parameterSchemaKey(
  effect: RuntimeEffect,
  params: Partial<RuntimeParams> | undefined,
): string {
  const keys = "parameterSchema" in effect
    ? Object.keys(effect.parameterSchema)
    : Object.keys(params ?? {});
  return JSON.stringify(keys.sort());
}

function changedParams(
  effect: RuntimeEffect,
  previous: Partial<RuntimeParams>,
  next: Partial<RuntimeParams>,
): Partial<RuntimeParams> {
  const defaults = definitionDefaults(effect);
  const changed: Partial<RuntimeParams> = {};
  const keys = new Set([...Object.keys(previous), ...Object.keys(next)]);

  for (const key of keys) {
    if (own(next, key)) {
      if (!own(previous, key) || !Object.is(previous[key], next[key])) {
        changed[key] = next[key];
      }
    } else if (own(previous, key) && defaults && own(defaults, key)) {
      changed[key] = defaults[key];
    }
  }

  return changed;
}

function normalizeLayerOptions(props: RuntimeProps): NormalizedLayerOptions {
  return {
    target: props.target ?? "surfaces",
    blend: props.blend ?? "over",
    opacity: props.opacity ?? 1,
    order: props.order ?? 0,
    enabled: props.enabled ?? true,
  };
}

/**
 * Canonical key for a `target` value: `"surfaces"`/`"viewport"` pass through,
 * a `GlyphMeshHandle` / `GlyphMeshHandle[]` normalizes to its sorted mesh-id
 * set. Diffing by this key (not `Object.is`) means a fresh `[a, b]` array
 * built each render — same meshes, new array identity — is a no-op instead
 * of a spurious `setOptions` call (VOLUMETRIC-3.md §1).
 */
function targetKey(target: GlyphEffectTarget | undefined): string {
  const resolved = target ?? "surfaces";
  if (resolved === "surfaces" || resolved === "viewport") return resolved;
  const handles = Array.isArray(resolved) ? resolved : [resolved];
  return handles.map((handle) => handle.id).sort((a, b) => a - b).join(",");
}

function changedLayerOptions(
  previous: NormalizedLayerOptions,
  next: NormalizedLayerOptions,
): Partial<NormalizedLayerOptions> {
  const changed: Partial<NormalizedLayerOptions> = {};
  if (targetKey(previous.target) !== targetKey(next.target)) changed.target = next.target;
  if (previous.blend !== next.blend) changed.blend = next.blend;
  if (previous.opacity !== next.opacity) changed.opacity = next.opacity;
  if (previous.order !== next.order) changed.order = next.order;
  if (previous.enabled !== next.enabled) changed.enabled = next.enabled;
  return changed;
}

const GlyphEffectLayerRuntime = defineComponent({
  name: "GlyphEffectLayer",
  props: {
    effect: { type: Object as PropType<RuntimeEffect>, required: true },
    params: { type: Object as PropType<Partial<RuntimeParams>>, default: undefined },
    target: { type: [String, Object, Array] as unknown as PropType<GlyphEffectTarget>, default: undefined },
    blend: { type: String as PropType<GlyphEffectBlend>, default: undefined },
    opacity: { type: Number, default: undefined },
    order: { type: Number, default: undefined },
    enabled: { type: Boolean, default: undefined },
    program: { type: null as unknown as PropType<unknown>, default: undefined },
    colorProgram: { type: null as unknown as PropType<unknown>, default: undefined },
  },
  setup(props, { expose }) {
    const context = inject(GlyphSceneContextKey);
    if (!context) {
      throw new Error("glyphcss: GlyphEffectLayer must be used inside a GlyphScene.");
    }

    const { sceneRef } = context;
    const handleRef = shallowRef<RuntimeHandle | null>(null);
    let previousParams: Partial<RuntimeParams> = {};
    let previousOptions = normalizeLayerOptions(props);

    function currentHandle(): RuntimeHandle {
      const handle = handleRef.value;
      if (!handle) throw new Error("glyphcss: GlyphEffectLayer is not ready.");
      return handle;
    }

    const exposedHandle = {
      get params() { return currentHandle().params; },
      get disposed() { return handleRef.value?.disposed ?? true; },
      get enabled() { return currentHandle().enabled; },
      set enabled(value: boolean) { currentHandle().enabled = value; },
      get opacity() { return currentHandle().opacity; },
      set opacity(value: number) { currentHandle().opacity = value; },
      get order() { return currentHandle().order; },
      set order(value: number) { currentHandle().order = value; },
      setParams(params: Partial<RuntimeParams>) { currentHandle().setParams(params); },
      setOptions(options: Parameters<RuntimeHandle["setOptions"]>[0]) {
        currentHandle().setOptions(options);
      },
      invalidate() { currentHandle().invalidate(); },
      dispose() { currentHandle().dispose(); },
    } satisfies RuntimeHandle;
    expose(exposedHandle);

    function disposeLayer(): void {
      const handle = handleRef.value;
      if (!handle) return;
      handleRef.value = null;
      handle.dispose();
    }

    function createLayer(): void {
      disposeLayer();
      const scene = sceneRef.value;
      if (!scene) return;
      const options = normalizeLayerOptions(props);
      handleRef.value = scene.addEffectLayer({
        effect: props.effect,
        ...(props.params !== undefined ? { params: props.params } : {}),
        ...(props.program !== undefined ? { program: props.program } : {}),
        ...(props.colorProgram !== undefined ? { colorProgram: props.colorProgram } : {}),
        ...options,
      } as never) as RuntimeHandle;
      previousParams = snapshotParams(props.params);
      previousOptions = options;
    }

    watch(
      [
        sceneRef,
        () => props.effect,
        () => parameterSchemaKey(
          props.effect,
          "parameterSchema" in props.effect ? undefined : props.params,
        ),
      ],
      createLayer,
      { immediate: true },
    );

    watch(
      [() => props.effect, () => snapshotParams(props.params)] as const,
      ([effect, nextParams]) => {
        const handle = handleRef.value;
        if (!handle) return;
        const changed = changedParams(effect, previousParams, nextParams);
        previousParams = nextParams;
        if (Object.keys(changed).length > 0) handle.setParams(changed);
      },
      { immediate: true },
    );

    watch(
      () => normalizeLayerOptions(props),
      (nextOptions) => {
        const handle = handleRef.value;
        if (!handle) return;
        const changed = changedLayerOptions(previousOptions, nextOptions);
        previousOptions = nextOptions;
        if (Object.keys(changed).length > 0) handle.setOptions(changed);
      },
      { immediate: true },
    );

    onBeforeUnmount(disposeLayer);

    return () => null;
  },
});

export const GlyphEffectLayer = GlyphEffectLayerRuntime as unknown as GlyphEffectLayerComponent;
