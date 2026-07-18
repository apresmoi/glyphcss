/**
 * buildGlyphInteractiveExport — turn polygons + a declared interaction set into a
 * self-contained, portable glyphcss scene (a container + one `<script type=
 * "module">` that pulls glyphcss from a CDN with the decimated mesh inlined).
 *
 * Pure and browser-safe (no DOM, no fs) — the Node file pipeline
 * (`@glyphcss/compile`) and the in-browser "export to CodePen" button both call
 * this. The capability manifest drives both the wired control (only the declared
 * one is imported → the runtime tree-shakes) and the decimation budget ("zoom"
 * lets the camera approach, so a finer grid is kept).
 */
import { decimatePolygons, recenterPolygons } from "@glyphcss/core";
import type { Polygon, RenderMode } from "@glyphcss/core";

export type GlyphInteraction = "orbit" | "zoom" | "pan" | "fpv";

export interface GlyphInteractiveExportOptions {
  /** Declared interactions. Default `["orbit"]`. `[]` → a static, non-interactive scene. */
  interactions?: GlyphInteraction[];
  /** Override the auto decimation budget (lattice cells along the longest axis). */
  decimateGrid?: number;
  /** glyphcss version to load from esm.sh. Default: latest. */
  cdnVersion?: string;
  /** Container element id. Default "glyph". */
  mountId?: string;
  /** Recenter the mesh bbox to the origin before exporting. Default false. */
  autoCenter?: boolean;
  rotX?: number;
  rotY?: number;
  zoom?: number;
  /** Camera projection (default "perspective"). FPV always uses a perspective camera. */
  projection?: "perspective" | "orthographic";
  /** CSS-perspective distance in virtual px (perspective only). */
  perspectivePx?: number;
  cols?: number;
  rows?: number;
  cellAspect?: number;
  mode?: RenderMode;
  useColors?: boolean;
  /**
   * Mount a live stock `@glyphcss/effects` layer, resolved by id from the CDN
   * at runtime. The exporter never imports `@glyphcss/effects` itself (that
   * package depends on glyphcss, never the reverse) — `id` stays an opaque
   * string until the snippet runs in the browser.
   */
  effect?: {
    /** Stock effect id, e.g. "field-synth" / "matrix-rain". */
    id: string;
    /** Flat ABI params. Any `time` key is stripped — the emitted clock owns it. */
    params: Record<string, number | string | boolean>;
    /** Default: "over" (glyphcss's own `addEffectLayer` default). */
    blend?: "over" | "replace";
    /** Clock speed. >0 emits an rAF loop driving `params.time`; 0/undefined = static. */
    timeScale?: number;
  };
}

export interface GlyphInteractiveExportResult {
  /** Self-contained HTML: container + `<style>` + module script. Drop into any page. */
  html: string;
  /** Split for CodePen prefill (the module script lives in `html`; css separate). */
  pen: { html: string; css: string; js: string };
  /** Triangles shipped after decimation (vs the source count). */
  polygonCount: number;
  sourcePolygonCount: number;
  interactions: GlyphInteraction[];
}

function round(n: number): number {
  return Math.round(n * 1e4) / 1e4;
}

function serializePolygons(polys: Polygon[]): string {
  const arr = polys.map((p) => [
    p.vertices.map((v) => [round(v[0]), round(v[1]), round(v[2])]),
    p.color ?? "#cccccc",
  ]);
  return JSON.stringify(arr);
}

// Coarse is plenty for orbit; "zoom"/"fpv" let the camera approach, so more
// on-screen cells → a finer grid is warranted.
function autoGrid(interactions: GlyphInteraction[]): number {
  if (interactions.includes("fpv")) return 110;
  if (interactions.includes("zoom")) return 96;
  return 56;
}

const BASE_CSS = `html,body{margin:0;height:100%;background:#0b0d10;color:#e2e8f0}
#MOUNT{width:100vw;height:100vh}
#MOUNT pre.glyph-output{margin:0;font:13px/1 ui-monospace,Menlo,monospace;white-space:pre}`;

// The clock owns `time` — strip any authored value so the rAF loop (or the
// static single assignment) is the sole writer.
function serializeEffectParams(params: Record<string, number | string | boolean>): string {
  const { time: _time, ...rest } = params;
  return JSON.stringify(rest);
}

// Shared by the FPV and normal branches of buildScript so the effect-mount +
// clock snippet isn't duplicated. `effect` here is the resolved, non-optional
// export option — callers gate on `opts.effect` before calling this.
function buildEffectBlock(effect: NonNullable<GlyphInteractiveExportOptions["effect"]>): string {
  const blend = effect.blend ?? "over";
  const layerLine = `const glyphEffect = scene.addEffectLayer({ effect: getGlyphEffect(${JSON.stringify(effect.id)}), blend: ${JSON.stringify(blend)}, params: ${serializeEffectParams(effect.params)} });`;
  if (!effect.timeScale) return layerLine;
  return `${layerLine}
const _t0 = performance.now();
(function _tick(now) {
  glyphEffect.params.time = ((now - _t0) / 1000) * ${round(effect.timeScale)};
  requestAnimationFrame(_tick);
})(performance.now());`;
}

function buildScript(opts: {
  cdn: string;
  effectsCdn?: string;
  mountId: string;
  polysJson: string;
  rotX?: number; rotY?: number; zoom?: number;
  cellAspect?: number; mode?: string; useColors?: boolean;
  projection?: "perspective" | "orthographic"; perspectivePx?: number;
  interactions: GlyphInteraction[];
  scale: number;
  effect?: GlyphInteractiveExportOptions["effect"];
}): string {
  const hasFpv = opts.interactions.includes("fpv");
  const hasPan = opts.interactions.includes("pan");
  const hasOrbit = opts.interactions.includes("orbit");
  const hasZoom = opts.interactions.includes("zoom");

  // FPV needs a perspective camera; otherwise honor the scene's
  // projection (the gallery defaults to orthographic — using the wrong one
  // mis-frames the model and breaks map-controls pan tracking).
  const orthoMode = !hasFpv && opts.projection === "orthographic";
  const cameraCtor = orthoMode ? "createGlyphOrthographicCamera" : "createGlyphPerspectiveCamera";

  const imports = ["createGlyphScene", cameraCtor];
  if (hasFpv) imports.push("createGlyphFirstPersonControls");
  else if (hasPan) imports.push("createGlyphMapControls");
  else if (hasOrbit || hasZoom) imports.push("createGlyphOrbitControls");

  const sceneOpts: string[] = ["autoSize: true"];
  if (opts.mode) sceneOpts.push(`mode: ${JSON.stringify(opts.mode)}`);
  if (opts.useColors === false) sceneOpts.push("useColors: false");
  if (opts.cellAspect !== undefined) sceneOpts.push(`cellAspect: ${opts.cellAspect}`);

  const importLines = [`import { ${imports.join(", ")} } from "${opts.cdn}";`];
  if (opts.effect) importLines.push(`import { getGlyphEffect } from "${opts.effectsCdn}";`);
  const head = `${importLines.join("\n")}
const polygons = ${opts.polysJson}.map((p) => ({ vertices: p[0], color: p[1] }));`;
  const mount = `document.getElementById(${JSON.stringify(opts.mountId)})`;
  const effectBlock = opts.effect ? buildEffectBlock(opts.effect) : undefined;

  // FPV mirrors the gallery: perspective at rotX=90, zoom × model-scale,
  // and move/jump/gravity/eyeHeight scaled by the model so it works at any size.
  // Spawn one+ model-span back from the (auto-centered) origin along the look dir.
  if (hasFpv) {
    const s = opts.scale;
    const rotY = opts.rotY ?? 0;
    const r = (rotY * Math.PI) / 180;
    const back = 1.5 * s;
    const spawnX = round(Math.cos(r) * back);
    const spawnY = round(Math.sin(r) * back);
    const eyeZ = round(0.2 * s);
    const fpvZoom = round((opts.zoom ?? 0.5) * s);
    const fpvPerspective = round(200 * s);
    const fpvOpts = `{ moveSpeed: ${round(1 * s)}, jumpVelocity: ${round(0.7 * s)}, gravity: ${round(1.8 * s)}, eyeHeight: ${eyeZ}, crouchHeight: ${round(0.1 * s)}, groundZ: 0, lookSensitivity: 0.15, minPitch: 5, maxPitch: 175 }`;
    return [
      head,
      `const camera = createGlyphPerspectiveCamera({ rotX: 90, rotY: ${round(rotY)}, zoom: ${fpvZoom}, perspective: ${fpvPerspective} });
const scene = createGlyphScene(${mount}, { camera, ${sceneOpts.join(", ")} });
scene.add(polygons);
const fpv = createGlyphFirstPersonControls(scene, ${fpvOpts});
fpv.setOrigin([${spawnX}, ${spawnY}, ${eyeZ}]);
// Click the scene to capture the mouse, then WASD to move, mouse to look.`,
      effectBlock,
    ].filter(Boolean).join("\n");
  }

  const camParts: string[] = [];
  if (opts.rotX !== undefined) camParts.push(`rotX: ${round(opts.rotX)}`);
  if (opts.rotY !== undefined) camParts.push(`rotY: ${round(opts.rotY)}`);
  if (opts.zoom !== undefined) camParts.push(`zoom: ${round(opts.zoom)}`);
  if (!orthoMode && opts.perspectivePx !== undefined) camParts.push(`perspective: ${round(opts.perspectivePx)}`);

  let controlLine = "";
  if (hasPan) {
    controlLine = `createGlyphMapControls(scene, { drag: true, wheel: ${hasZoom ? "true" : "false"} });`;
  } else if (hasOrbit || hasZoom) {
    controlLine = `createGlyphOrbitControls(scene, { drag: ${hasOrbit ? "true" : "false"}, wheel: ${hasZoom ? "true" : "false"} });`;
  }

  return [
    head,
    `const camera = ${cameraCtor}({ ${camParts.join(", ")} });
const scene = createGlyphScene(${mount}, { camera, ${sceneOpts.join(", ")} });
scene.add(polygons);
${controlLine}`,
    effectBlock,
  ].filter(Boolean).join("\n");
}

function modelScale(polygons: Polygon[]): number {
  let mnx = Infinity, mxx = -Infinity, mny = Infinity, mxy = -Infinity, mnz = Infinity, mxz = -Infinity;
  for (const p of polygons) for (const v of p.vertices) {
    if (v[0] < mnx) mnx = v[0]; if (v[0] > mxx) mxx = v[0];
    if (v[1] < mny) mny = v[1]; if (v[1] > mxy) mxy = v[1];
    if (v[2] < mnz) mnz = v[2]; if (v[2] > mxz) mxz = v[2];
  }
  if (!isFinite(mnx)) return 1;
  return Math.max(mxx - mnx, mxy - mny, mxz - mnz, 0.001) / 2;
}

export function buildGlyphInteractiveExport(
  polygons: Polygon[],
  options: GlyphInteractiveExportOptions = {},
): GlyphInteractiveExportResult {
  const interactions = options.interactions ?? ["orbit"];
  const centered = options.autoCenter ? recenterPolygons(polygons) : polygons;
  const grid = options.decimateGrid ?? autoGrid(interactions);
  const decimated = decimatePolygons(centered, { grid });

  const mountId = options.mountId ?? "glyph";
  const versionSuffix = options.cdnVersion ? `@${options.cdnVersion}` : "";
  const cdn = `https://esm.sh/glyphcss${versionSuffix}`;
  // `?deps=glyphcss<ver>` pins esm.sh to the same glyphcss instance the main
  // import resolves, so the effect layer's runtime type checks (which compare
  // against glyphcss's exported classes/symbols) see one module graph.
  const effectsCdn = options.effect
    ? `https://esm.sh/@glyphcss/effects${versionSuffix}?deps=glyphcss${versionSuffix}`
    : undefined;
  const script = buildScript({
    cdn, effectsCdn, mountId,
    polysJson: serializePolygons(decimated),
    rotX: options.rotX, rotY: options.rotY, zoom: options.zoom,
    projection: options.projection, perspectivePx: options.perspectivePx,
    cellAspect: options.cellAspect, mode: options.mode, useColors: options.useColors,
    interactions,
    scale: modelScale(decimated),
    effect: options.effect,
  });

  const css = BASE_CSS.replace(/MOUNT/g, mountId);
  const containerHtml = `<div id="${mountId}"></div>`;
  return {
    html: `${containerHtml}\n<style>${css}</style>\n<script type="module">\n${script}\n</script>`,
    pen: {
      html: `${containerHtml}\n<script type="module">\n${script}\n</script>`,
      css,
      js: "",
    },
    polygonCount: decimated.length,
    sourcePolygonCount: centered.length,
    interactions,
  };
}

/**
 * glyphCodepenPrefill — turn an interactive export into a CodePen "prefill" POST.
 * CodePen expects a form POST to `action` with a single `data` field (JSON).
 */
export function glyphCodepenPrefill(
  result: GlyphInteractiveExportResult,
  title = "glyphcss",
): { action: string; data: string } {
  return {
    action: "https://codepen.io/pen/define",
    data: JSON.stringify({
      title,
      html: result.pen.html,
      css: result.pen.css,
      js: result.pen.js,
      editors: "110",
    }),
  };
}
