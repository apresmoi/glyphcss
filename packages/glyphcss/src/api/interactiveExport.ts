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
  cols?: number;
  rows?: number;
  cellAspect?: number;
  mode?: RenderMode;
  useColors?: boolean;
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

function buildScript(opts: {
  cdn: string;
  mountId: string;
  polysJson: string;
  rotX?: number; rotY?: number; zoom?: number;
  cellAspect?: number; mode?: string; useColors?: boolean;
  interactions: GlyphInteraction[];
}): string {
  const hasFpv = opts.interactions.includes("fpv");
  const hasPan = opts.interactions.includes("pan");
  const hasOrbit = opts.interactions.includes("orbit");
  const hasZoom = opts.interactions.includes("zoom");

  const imports = ["createGlyphScene", "createGlyphPerspectiveCamera"];
  if (hasFpv) imports.push("createGlyphFirstPersonControls");
  else if (hasPan) imports.push("createGlyphMapControls");
  else if (hasOrbit || hasZoom) imports.push("createGlyphOrbitControls");

  const sceneOpts: string[] = ["autoSize: true"];
  if (opts.mode) sceneOpts.push(`mode: ${JSON.stringify(opts.mode)}`);
  if (opts.useColors === false) sceneOpts.push("useColors: false");
  if (opts.cellAspect !== undefined) sceneOpts.push(`cellAspect: ${opts.cellAspect}`);

  const camParts: string[] = [];
  if (opts.rotX !== undefined) camParts.push(`rotX: ${opts.rotX}`);
  if (opts.rotY !== undefined) camParts.push(`rotY: ${opts.rotY}`);
  if (opts.zoom !== undefined) camParts.push(`zoom: ${opts.zoom}`);

  let controlLine = "";
  if (hasFpv) {
    controlLine = "createGlyphFirstPersonControls(scene, { enabled: true });";
  } else if (hasPan) {
    controlLine = `createGlyphMapControls(scene, { drag: true, wheel: ${hasZoom ? "true" : "false"} });`;
  } else if (hasOrbit || hasZoom) {
    controlLine = `createGlyphOrbitControls(scene, { drag: ${hasOrbit ? "true" : "false"}, wheel: ${hasZoom ? "true" : "false"} });`;
  }

  return `import { ${imports.join(", ")} } from "${opts.cdn}";
const polygons = ${opts.polysJson}.map((p) => ({ vertices: p[0], color: p[1] }));
const camera = createGlyphPerspectiveCamera({ ${camParts.join(", ")} });
const scene = createGlyphScene(document.getElementById(${JSON.stringify(opts.mountId)}), { camera, ${sceneOpts.join(", ")} });
scene.add(polygons);
${controlLine}`;
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
  const cdn = `https://esm.sh/glyphcss${options.cdnVersion ? `@${options.cdnVersion}` : ""}`;
  const script = buildScript({
    cdn, mountId,
    polysJson: serializePolygons(decimated),
    rotX: options.rotX, rotY: options.rotY, zoom: options.zoom,
    cellAspect: options.cellAspect, mode: options.mode, useColors: options.useColors,
    interactions,
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
