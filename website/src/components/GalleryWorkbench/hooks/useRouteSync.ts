import { useEffect } from "react";

function getRoutePresetValue(): string {
  if (typeof window === "undefined") return "";
  const params = new URLSearchParams(window.location.search);
  return params.get("model") || "";
}

function hashStringToUint32(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function routeIdForPresetId(presetId: string): string {
  return String(hashStringToUint32(presetId));
}

function resolveRoutePresetId(routeValue: string, presetIds: string[]): string {
  const value = typeof routeValue === "string" ? routeValue.trim() : "";
  if (!value) return "";

  if (/^\d+$/.test(value)) {
    const found = presetIds.find((id) => routeIdForPresetId(id) === value);
    if (found) return found;
  }

  return presetIds.find((id) => id === value) ?? "";
}

export function setRoutePresetId(presetId: string | null): void {
  if (typeof window === "undefined") return;
  const next = presetId ? routeIdForPresetId(presetId) : "";
  const current = getRoutePresetValue();
  if (next === current) return;

  const params = new URLSearchParams(window.location.search);
  if (next) params.set("model", next);
  else params.delete("model");

  const newSearch = params.toString();
  const newUrl = `${window.location.pathname}${newSearch ? `?${newSearch}` : ""}${window.location.hash}`;
  window.history.replaceState(null, "", newUrl);
}

export function routeInitialPresetId(presetIds: string[]): string {
  const routeValue = getRoutePresetValue();
  return resolveRoutePresetId(routeValue, presetIds);
}

export interface UseRouteSyncOptions {
  presetId: string;
  presetIds: string[];
  resetToPreset: (id: string) => void;
}

export function useRouteSync({ presetId, presetIds, resetToPreset }: UseRouteSyncOptions): void {
  useEffect(() => {
    const routeValue = getRoutePresetValue();
    if (routeValue) {
      const routePresetId = resolveRoutePresetId(routeValue, presetIds);
      if (routePresetId) {
        setRoutePresetId(routePresetId);
      } else {
        setRoutePresetId(null);
      }
    }

    const handlePopState = () => {
      const nextRouteValue = getRoutePresetValue();
      if (!nextRouteValue) return;
      const nextPresetId = resolveRoutePresetId(nextRouteValue, presetIds);
      if (!nextPresetId) {
        setRoutePresetId(null);
        return;
      }
      if (nextPresetId !== presetId) {
        resetToPreset(nextPresetId);
      }
    };

    window.addEventListener("popstate", handlePopState);
    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, [presetId, resetToPreset]);
}
