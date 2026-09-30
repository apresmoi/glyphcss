import { galleryBucketForPreset, PRESETS, stripParenthesizedText } from "../../features/gallery/data/index";
import { routeInitialPresetId } from "../../features/gallery/hooks/index";
import { defaultZoomForModel } from "../../features/gallery/model/smartDefaults";
import type { PresetModel, SceneOptionsState } from "../../features/gallery/model/types";
import { glyphAtlasCellsFromPre } from "../../services/export/asciiClipboard";
import { defaultGlyphColorEncoding } from "../../services/rendering/glyphColorEncodingDefault";
import { type AsciiCell, type TrimmedStrip } from "./types";

/** Walk the strip's DOM, collect (char, color) cells per row, then compute the
 * trim bounds (leading/trailing empty rows, common left/right padding).
 *
 * Under `colorEncoding: "atlas"` there are no `<span>`s and no literal glyphs
 * to walk — the text is PUA code points naming palette slots — so the span
 * walk below would collect unreadable characters with no colour. The atlas
 * decoder runs first and returns the same `(ch, color)` rows from the code
 * points plus the scene's own `@font-palette-values` block, keeping the
 * COLOURED paste working in both encodings rather than degrading it to plain
 * text whenever the atlas is on. */
export function parseStripCells(strip: HTMLElement): TrimmedStrip | null {
  const rows: AsciiCell[][] = glyphAtlasCellsFromPre(strip) ?? [[]];
  let row = rows[rows.length - 1]!;
  const alreadyDecoded = rows.length > 1 || rows[0]!.length > 0;
  const visit = (node: Node, color?: string): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      const t = node.nodeValue ?? "";
      for (const ch of t) {
        if (ch === "\n") {
          row = [];
          rows.push(row);
        } else {
          row.push(color ? { ch, color } : { ch });
        }
      }
      return;
    }
    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement;
      const next = el.style?.color || color;
      el.childNodes.forEach((c) => visit(c, next));
    }
  };
  if (!alreadyDecoded) strip.childNodes.forEach((c) => visit(c));

  let top = 0;
  let bottom = rows.length - 1;
  const rowEmpty = (r: AsciiCell[]) => r.every((c) => c.ch === " ");
  while (top <= bottom && rowEmpty(rows[top]!)) top++;
  while (bottom >= top && rowEmpty(rows[bottom]!)) bottom--;
  if (bottom < top) return null;

  let left = Infinity;
  let right = 0;
  for (let i = top; i <= bottom; i++) {
    const r = rows[i]!;
    let first = -1;
    let last = -1;
    for (let j = 0; j < r.length; j++) {
      if (r[j]!.ch !== " ") {
        if (first === -1) first = j;
        last = j + 1;
      }
    }
    if (first === -1) continue;
    if (first < left) left = first;
    if (last > right) right = last;
  }
  if (!Number.isFinite(left) || right === 0) return null;
  return { rows, top, bottom, left, right };
}

/** Render the trimmed strip as plain text + inline-color HTML. */
export function renderHtmlAndText(strip: TrimmedStrip): { text: string; html: string } {
  const { rows, top, bottom, left, right } = strip;

  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const textLines: string[] = [];
  const htmlLines: string[] = [];
  for (let i = top; i <= bottom; i++) {
    const r = rows[i]!;
    const slice = r.slice(left, right);
    while (slice.length < right - left) slice.push({ ch: " " });
    textLines.push(slice.map((c) => c.ch).join(""));

    let html = "";
    let buf = "";
    let cur: string | undefined;
    const flush = () => {
      if (!buf) return;
      // Cells with a color render as solid blocks of that color (background
      // matches the glyph color, so the glyph itself disappears) — yields
      // a clean colored silhouette of the mesh when pasted into rich-text
      // editors. Plain cells stay bare so empty padding inherits the paste
      // target's background.
      html += cur ? `<span style="color:${cur};background:${cur}">${esc(buf)}</span>` : esc(buf);
      buf = "";
    };
    for (const cell of slice) {
      if (cell.color !== cur) {
        flush();
        cur = cell.color;
      }
      buf += cell.ch;
    }
    flush();
    htmlLines.push(html);
  }
  const text = textLines.join("\n");
  // Background + default color intentionally omitted so the paste target's
  // theme (Docs/Notion white, terminals dark) shows through. Per-cell colors
  // still survive via inline span styles.
  const html = `<pre style="font-family:ui-monospace,'JetBrains Mono','SF Mono',Menlo,monospace;white-space:pre;line-height:1.05;margin:0">${htmlLines.join("\n")}</pre>`;
  return { text, html };
}

export function presetPickerItem(preset: PresetModel, local = false) {
  return {
    id: preset.id,
    label: local ? `Dropped: ${stripParenthesizedText(preset.label)}` : stripParenthesizedText(preset.label),
    category: galleryBucketForPreset(preset),
  };
}

export const PRESET_PICKER_ITEMS = PRESETS.map((preset) => presetPickerItem(preset));

export const ALL_PRESET_IDS = PRESETS.map((p) => p.id);

const DEFAULT_SCENE: SceneOptionsState = {
  animationPaused: false,
  animationTimeScale: 1,
  autoCenter: true,
  autoRotate: false,
  interactive: true,
  zoom: PRESETS[0].zoom ?? 0.35,
  rotX: PRESETS[0].rotX ?? 65,
  rotY: PRESETS[0].rotY ?? 45,
  perspective: 32000,
  lightAzimuth: 50,
  lightElevation: 7,
  lightIntensity: 0.95,
  lightColor: "#ffffff",
  ambientIntensity: 0.75,
  ambientColor: "#ffffff",
  target: [0, 0, 0],
  renderMode: "solid",
  featureEdges: 30,
  glyphPalette: "default",
  charMode: "ascii",
  wireframeJunctions: false,
  hiddenLines: "show",
  solidWeightRamp: false,
  // Feature-detected site default. `useRouteSync`'s codec keeps `default:
  // "spans"` on purpose — that is the URL omission sentinel, and it must not
  // vary by browser or a link shared from one engine would decode differently
  // on another. DEFAULT_SCENE is spread BEFORE the decoded route options, so
  // an explicit `?scene=…b…` value still wins.
  colorEncoding: defaultGlyphColorEncoding(),
  lineHeight: 1.0,
  density: 1.0,
  dragDensity: 1,
  useColors: true,
  smoothShading: false,
  creaseAngle: 60,
  dragMode: "orbit",
  fpvLook: true,
  fpvMove: true,
  fpvJump: true,
  fpvCrouch: true,
  fpvMoveSpeed: 1,
  fpvJumpVelocity: 0.7,
  fpvGravity: 1.8,
  fpvEyeHeight: 0.2,
  fpvCrouchHeight: 0.1,
  fpvLookSensitivity: 0.15,
  fpvInvertY: false,
  // Shadow — ON by default with cast+receive so every model self-shadows out
  // of the box. Floor OFF: self-shadowing only, no ground plane.
  shadowEnabled: true,
  shadowOpacity: 0.25,
  shadowLift: 0.05,
  shadowColor: "#000000",
  shadowCast: true,
  shadowReceive: true,
  shadowFloor: false,
};

const RESPONSIVE_ZOOM_BREAKPOINT = 900;

const RESPONSIVE_ZOOM_BOTTOM_RESERVE = 72;

const RESPONSIVE_ZOOM_MIN_SCALE = 0.42;

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(value, min), max);
}

export function responsiveZoomScaleForViewport(width: number, height: number): number {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return 1;
  }
  const effectiveHeight = Math.max(1, height - RESPONSIVE_ZOOM_BOTTOM_RESERVE);
  const widthScale = width < RESPONSIVE_ZOOM_BREAKPOINT ? width / RESPONSIVE_ZOOM_BREAKPOINT : 1;
  const heightScale = effectiveHeight < RESPONSIVE_ZOOM_BREAKPOINT ? effectiveHeight / RESPONSIVE_ZOOM_BREAKPOINT : 1;
  return clamp(Math.min(widthScale, heightScale), RESPONSIVE_ZOOM_MIN_SCALE, 1);
}

export function initialResponsiveZoomScale(): number {
  if (typeof window === "undefined") return 1;
  return responsiveZoomScaleForViewport(window.innerWidth, window.innerHeight);
}

export function sceneDefaultsFor(model: PresetModel): SceneOptionsState {
  return {
    ...DEFAULT_SCENE,
    zoom: defaultZoomForModel(model),
    rotX: model.rotX ?? DEFAULT_SCENE.rotX,
    rotY: model.rotY ?? DEFAULT_SCENE.rotY,
  };
}

export function sceneDefaultsForPresetId(id: string): SceneOptionsState {
  const model = PRESETS.find((p) => p.id === id);
  return model ? sceneDefaultsFor(model) : DEFAULT_SCENE;
}

export function randomPreset(): PresetModel {
  return PRESETS[Math.floor(Math.random() * PRESETS.length)] ?? PRESETS[0];
}

export function resolveInitialPreset(): PresetModel {
  const id = routeInitialPresetId(ALL_PRESET_IDS);
  return (id ? PRESETS.find((p) => p.id === id) : null) ?? randomPreset();
}
