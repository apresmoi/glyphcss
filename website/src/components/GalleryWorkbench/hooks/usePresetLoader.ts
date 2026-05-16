import { useEffect, useRef, type RefObject } from "react";
import type { DroppedModelSource, LoadedModel, ParserOptionsState, PresetModel } from "../types";
import { loadPresetModel, loadDroppedModel } from "../helpers/loaders";
import {
  smartAmbientForModel,
  smartKeyIntensityForModel,
  defaultZoomForModel,
} from "../helpers/smartDefaults";

export interface UsePresetLoaderOptions {
  selectedPreset: PresetModel;
  selectedDroppedSource: DroppedModelSource | null;
  parserOptions: ParserOptionsState;
  onLoaded: (model: LoadedModel) => void;
  onLoadError: (message: string) => void;
  onLoadingChange: (loading: boolean) => void;
  onSceneDefaults: (zoom: number | null, ambientIntensity: number | null, lightIntensity: number | null) => void;
  autoZoomPresetRef: RefObject<string | null>;
  autoAmbientPresetRef: RefObject<string | null>;
  autoKeyPresetRef: RefObject<string | null>;
}

export function usePresetLoader({
  selectedPreset,
  selectedDroppedSource,
  parserOptions,
  onLoaded,
  onLoadError,
  onLoadingChange,
  onSceneDefaults,
  autoZoomPresetRef,
  autoAmbientPresetRef,
  autoKeyPresetRef,
}: UsePresetLoaderOptions): void {
  const disposeRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    let cancelled = false;
    onLoadingChange(true);
    onLoadError("");

    const run = async () => {
      const presetForLoad = selectedPreset;
      try {
        disposeRef.current?.();
        disposeRef.current = null;
        const next = selectedDroppedSource
          ? await loadDroppedModel(selectedDroppedSource, parserOptions)
          : await loadPresetModel(presetForLoad, parserOptions);
        if (cancelled) {
          next.dispose();
          return;
        }
        disposeRef.current = next.dispose;
        const nextZoom = autoZoomPresetRef.current !== presetForLoad.id
          ? defaultZoomForModel(presetForLoad, next.rawPolygons)
          : null;
        const nextAmbient = autoAmbientPresetRef.current !== presetForLoad.id
          ? smartAmbientForModel(presetForLoad, next.rawPolygons)
          : null;
        const nextKey = autoKeyPresetRef.current !== presetForLoad.id
          ? smartKeyIntensityForModel(next.rawPolygons)
          : null;

        if (nextZoom !== null || nextAmbient !== null || nextKey !== null) {
          onSceneDefaults(nextZoom, nextAmbient, nextKey);
          autoZoomPresetRef.current = presetForLoad.id;
          autoAmbientPresetRef.current = presetForLoad.id;
          autoKeyPresetRef.current = presetForLoad.id;
        }
        onLoaded(next);
      } catch (error) {
        if (cancelled) return;
        onLoadError(error instanceof Error ? error.message : String(error));
      } finally {
        if (!cancelled) onLoadingChange(false);
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [selectedPreset, selectedDroppedSource, parserOptions]);

  useEffect(() => {
    return () => {
      disposeRef.current?.();
    };
  }, []);
}
