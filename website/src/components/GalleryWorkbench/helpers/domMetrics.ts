import type { DomMetrics } from "../../types";
import { cssUrlValue, cssPxValue, cssNumberValue, cssPaintAlpha, localElementSize } from "./cssValues";

export const DOM_OVERPAINT_CACHE_EVENT = "polycss:dom-overpaint-cache";
export const SPRITE_ALPHA_CACHE = new Map<string, number>();
export const SPRITE_ALPHA_PENDING = new Set<string>();
export const SPRITE_ALPHA_IMAGE_CACHE = new Map<string, Promise<HTMLImageElement>>();

export const EMPTY_METRICS: DomMetrics = {
  measuredAt: 0,
  nodeCount: 0,
  sprites: 0,
  rects: 0,
  triangles: 0,
  irregular: 0,
  overpaintPercent: 0,
};

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(value, min), max);
}

export function loadAlphaImage(url: string): Promise<HTMLImageElement> {
  let promise = SPRITE_ALPHA_IMAGE_CACHE.get(url);
  if (promise) return promise;

  promise = new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`alpha image load failed: ${url}`));
    img.src = url;
  });
  SPRITE_ALPHA_IMAGE_CACHE.set(url, promise);
  return promise;
}

export function emitOverpaintCacheUpdate(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(DOM_OVERPAINT_CACHE_EVENT));
}

async function sampleSpriteAlpha(
  key: string,
  url: string,
  cssX: number,
  cssY: number,
  cssW: number,
  cssH: number,
  cssBackgroundW: number,
  cssBackgroundH: number,
): Promise<void> {
  try {
    const img = await loadAlphaImage(url);
    const scaleX = img.naturalWidth / cssBackgroundW;
    const scaleY = img.naturalHeight / cssBackgroundH;
    if (!Number.isFinite(scaleX) || !Number.isFinite(scaleY) || scaleX <= 0 || scaleY <= 0) return;

    const sx = Math.max(0, Math.round(cssX * scaleX));
    const sy = Math.max(0, Math.round(cssY * scaleY));
    const sw = Math.max(1, Math.min(img.naturalWidth - sx, Math.round(cssW * scaleX)));
    const sh = Math.max(1, Math.min(img.naturalHeight - sy, Math.round(cssH * scaleY)));
    if (sw <= 0 || sh <= 0) return;

    const canvas = document.createElement("canvas");
    canvas.width = sw;
    canvas.height = sh;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;

    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
    const pixels = ctx.getImageData(0, 0, sw, sh).data;
    let alpha = 0;
    for (let i = 3; i < pixels.length; i += 4) alpha += pixels[i] / 255;
    SPRITE_ALPHA_CACHE.set(key, alpha / (pixels.length / 4));
  } catch {
    SPRITE_ALPHA_CACHE.set(key, 1);
  } finally {
    SPRITE_ALPHA_PENDING.delete(key);
    emitOverpaintCacheUpdate();
  }
}

export function spriteAtlasAlpha(element: HTMLElement): number | null {
  const view = element.ownerDocument.defaultView;
  if (!view || typeof Image === "undefined") return null;

  const style = view.getComputedStyle(element);
  const url = cssUrlValue(style.backgroundImage)
    ?? cssUrlValue(style.getPropertyValue("-webkit-mask-image"))
    ?? cssUrlValue(style.getPropertyValue("mask-image"))
    ?? cssUrlValue(style.background);
  if (!url) return null;

  const width = cssPxValue(style.width) ?? element.offsetWidth;
  const height = cssPxValue(style.height) ?? element.offsetHeight;
  const positionX = cssNumberValue(style.backgroundPositionX) ?? 0;
  const positionY = cssNumberValue(style.backgroundPositionY) ?? 0;
  const maskPosition = style.getPropertyValue("-webkit-mask-position") || style.getPropertyValue("mask-position");
  const [maskPositionXRaw, maskPositionYRaw] = maskPosition.split(/\s+/);
  const cssX = -(cssNumberValue(style.backgroundPositionX) ?? cssNumberValue(maskPositionXRaw) ?? positionX);
  const cssY = -(cssNumberValue(style.backgroundPositionY) ?? cssNumberValue(maskPositionYRaw) ?? positionY);
  const size = style.backgroundSize || style.getPropertyValue("-webkit-mask-size") || style.getPropertyValue("mask-size");
  const [backgroundWidthRaw, backgroundHeightRaw] = size.split(/\s+/);
  const backgroundWidth = cssPxValue(backgroundWidthRaw);
  const backgroundHeight = cssPxValue(backgroundHeightRaw);
  if (!width || !height || !backgroundWidth || !backgroundHeight) return null;

  const key = [
    url,
    cssX.toFixed(3),
    cssY.toFixed(3),
    width.toFixed(3),
    height.toFixed(3),
    backgroundWidth.toFixed(3),
    backgroundHeight.toFixed(3),
  ].join("|");

  const cached = SPRITE_ALPHA_CACHE.get(key);
  if (cached !== undefined) return cached;

  if (!SPRITE_ALPHA_PENDING.has(key)) {
    SPRITE_ALPHA_PENDING.add(key);
    void sampleSpriteAlpha(key, url, cssX, cssY, width, height, backgroundWidth, backgroundHeight);
  }

  return null;
}

export function elementPaintAlphaSample(element: HTMLElement): { alpha: number; area: number } | null {
  const { width, height } = localElementSize(element);
  const area = Math.max(1, width * height);

  if (element.tagName === "U") {
    return {
      alpha: 0.5 * cssPaintAlpha(element, ["border-bottom-color", "color", "--polycss-paint"]),
      area,
    };
  }

  if (element.tagName === "I") {
    return {
      alpha: cssPaintAlpha(element, ["border-bottom-color", "border-color", "color", "--polycss-paint"]),
      area,
    };
  }

  if (element.tagName === "S") {
    const alpha = spriteAtlasAlpha(element)
      ?? cssPaintAlpha(element, ["background-color", "background"]);
    return { alpha, area };
  }

  if (element.tagName === "B") {
    return {
      alpha: cssPaintAlpha(element, ["background-color", "background", "color", "--polycss-paint"]),
      area,
    };
  }

  return null;
}

export function measureDomOverpaintPercent(scopes: HTMLElement[]): number {
  let weightedPaintAlpha = 0;
  let totalArea = 0;

  for (const scope of scopes) {
    const elements = scope.querySelectorAll<HTMLElement>("b, u, s, i");
    for (const element of elements) {
      const sample = elementPaintAlphaSample(element);
      if (!sample) continue;
      weightedPaintAlpha += clamp(sample.alpha, 0, 1) * sample.area;
      totalArea += sample.area;
    }
  }

  return totalArea > 0 ? Number(((1 - weightedPaintAlpha / totalArea) * 100).toFixed(1)) : 0;
}

export function measureDom(root: HTMLElement | null): DomMetrics {
  if (!root) return EMPTY_METRICS;
  const modelScopes = Array.from(root.querySelectorAll<HTMLElement>(".dn-model-mesh"));
  if (modelScopes.length === 0) return EMPTY_METRICS;
  const scopes = modelScopes;
  const countInScopes = (selector: string): number =>
    scopes.reduce((sum, scope) => sum + scope.querySelectorAll(selector).length, 0);
  const nodeCount = scopes.reduce((sum, scope) => sum + 1 + scope.querySelectorAll("*").length, 0);

  return {
    measuredAt: performance.now(),
    nodeCount,
    sprites: countInScopes("s"),
    rects: countInScopes("b"),
    triangles: countInScopes("u"),
    irregular: countInScopes("i"),
    overpaintPercent: measureDomOverpaintPercent(scopes),
  };
}
