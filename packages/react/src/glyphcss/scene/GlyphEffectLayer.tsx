import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import type { ForwardedRef, ReactElement, RefAttributes } from "react";
import type {
  GlyphEffectDefinition,
  GlyphEffectDefinitionLayerOptions,
  GlyphEffectLayerHandle,
  GlyphEffectParamSchema,
  GlyphEffectParamShape,
  GlyphEffectParamValue,
  GlyphEffectParamValues,
  GlyphEffectProgram,
  GlyphEffectProgramLayerOptions,
  GlyphEffectTarget,
  GlyphEffectBlend,
} from "glyphcss";
import { useGlyphSceneContext } from "./context";

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

interface RuntimeProps {
  effect: RuntimeEffect;
  params?: Partial<RuntimeParams>;
  target?: GlyphEffectTarget;
  blend?: GlyphEffectBlend;
  opacity?: number;
  order?: number;
  enabled?: boolean;
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

function changedLayerOptions(
  previous: NormalizedLayerOptions,
  next: NormalizedLayerOptions,
): Partial<NormalizedLayerOptions> {
  const changed: Partial<NormalizedLayerOptions> = {};
  if (!Object.is(previous.target, next.target)) changed.target = next.target;
  if (previous.blend !== next.blend) changed.blend = next.blend;
  if (previous.opacity !== next.opacity) changed.opacity = next.opacity;
  if (previous.order !== next.order) changed.order = next.order;
  if (previous.enabled !== next.enabled) changed.enabled = next.enabled;
  return changed;
}

function GlyphEffectLayerInner(
  props: RuntimeProps,
  forwardedRef: ForwardedRef<RuntimeHandle>,
): null {
  const { sceneRef } = useGlyphSceneContext();
  const handleRef = useRef<RuntimeHandle | null>(null);
  const previousParamsRef = useRef<Partial<RuntimeParams>>({});
  const previousOptionsRef = useRef<NormalizedLayerOptions>(normalizeLayerOptions(props));
  const [exposedHandle, setExposedHandle] = useState<RuntimeHandle | null>(null);
  const schemaKey = parameterSchemaKey(props.effect, props.params);

  useImperativeHandle(forwardedRef, () => exposedHandle!, [exposedHandle]);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    const options = normalizeLayerOptions(props);
    const layer = scene.addEffectLayer({
      effect: props.effect,
      ...(props.params !== undefined ? { params: props.params } : {}),
      ...options,
    } as never) as RuntimeHandle;

    handleRef.current = layer;
    previousParamsRef.current = snapshotParams(props.params);
    previousOptionsRef.current = options;
    setExposedHandle(layer);

    return () => {
      if (handleRef.current === layer) handleRef.current = null;
      layer.dispose();
    };
  }, [sceneRef, props.effect, schemaKey]);

  const declarativeParams = snapshotParams(props.params);

  useEffect(() => {
    const handle = handleRef.current;
    if (!handle) return;
    const changed = changedParams(
      props.effect,
      previousParamsRef.current,
      declarativeParams,
    );
    previousParamsRef.current = declarativeParams;
    if (Object.keys(changed).length > 0) handle.setParams(changed);
  }, [declarativeParams, props.effect, schemaKey]);

  const normalizedOptions = normalizeLayerOptions(props);
  useEffect(() => {
    const handle = handleRef.current;
    if (!handle) return;
    const changed = changedLayerOptions(previousOptionsRef.current, normalizedOptions);
    previousOptionsRef.current = normalizedOptions;
    if (Object.keys(changed).length > 0) handle.setOptions(changed);
  }, [
    normalizedOptions.target,
    normalizedOptions.blend,
    normalizedOptions.opacity,
    normalizedOptions.order,
    normalizedOptions.enabled,
  ]);

  return null;
}

export interface GlyphEffectLayerComponent {
  <Schema extends GlyphEffectParamSchema, State = undefined>(
    props: GlyphEffectDefinitionLayerOptions<Schema, State> &
      RefAttributes<GlyphEffectLayerHandle<GlyphEffectParamValues<Schema>>>,
  ): ReactElement | null;
  <P extends GlyphEffectParamShape<P>, State = undefined>(
    props: GlyphEffectProgramLayerOptions<P, State> &
      RefAttributes<GlyphEffectLayerHandle<P>>,
  ): ReactElement | null;
}

const ForwardedGlyphEffectLayer = forwardRef(GlyphEffectLayerInner);
ForwardedGlyphEffectLayer.displayName = "GlyphEffectLayer";

export const GlyphEffectLayer = ForwardedGlyphEffectLayer as GlyphEffectLayerComponent;
