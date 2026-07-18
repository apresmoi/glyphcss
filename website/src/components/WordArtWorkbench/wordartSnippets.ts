/**
 * wordartSnippets — generate /wordart's "use the libs" export code (HTML
 * custom elements / vanilla JS / React / Vue), each importing glyphcss (+
 * `@glyphcss/effects` when an effect is mounted) from a CDN and regenerating
 * the current extruded-text mesh with `@glyphcss/fonts`: the mesh is
 * reconstructed at runtime (`loadFont`/`loadGoogleFont` + `composeText`)
 * from the same text/font/face/profile/warp options the page itself passes
 * to `composeText`, not inlined as a baked polygon literal. Camera + mesh
 * rotation, lighting, and (if set) the live Glyph Effects layer + a time
 * clock round out the scene.
 *
 * Sibling to `../SynthWorkbench/synthSnippets.ts` (same shape: one function
 * per framework, rendered by the same-look `WordArtCodePanel`) and to
 * `../GalleryWorkbench/CodePanel.tsx`'s `generateSnippets` (same camera +
 * lighting + effect reconstruction) — kept separate because WordArt's mesh
 * is generated from a font at compose time rather than fetched from a
 * `src`/`geometry` reference, so the snippet regenerates it with
 * `@glyphcss/fonts` instead.
 */
import type { Vec3 } from "@glyphcss/core";
import type { FontEntry, WarpShape } from "@glyphcss/fonts";

export type WordArtTab = "html" | "vanilla" | "react" | "vue";

export interface WordArtSnippetEffect {
  /** Stock effect id (e.g. "field-synth"). */
  id: string;
  /** Key into `@glyphcss/effects`'s `GlyphEffects` map (e.g. "fieldSynth"). */
  exportName: string;
  params: Record<string, number | string | boolean>;
  blend: "over" | "replace";
  paused: boolean;
  timeScale: number;
  /** Whether the effect declares a `time` param — gates emitting a clock. */
  hasClock: boolean;
}

/** A paintable face, mirroring `@glyphcss/fonts`'s `FaceFillSpec` — reconstructed
 *  in the snippet via `resolveFace` (gradient/rainbow/texture/image) or a plain
 *  `{ color }` object (solid, no `resolveFace` call needed). */
export interface WordArtFaceSpec {
  kind: "solid" | "gradient" | "rainbow" | "texture" | "image";
  color?: string;
  from?: string;
  to?: string;
  angle?: number;
  /** Absolute URL (texture kind) — baked from the page's origin at export time. */
  url?: string;
  tile?: number;
  /** Image kind — a data URL or absolute URL. */
  src?: string;
}

export type WordArtProfileSpec =
  | { kind: "flat" }
  | { kind: "edge"; edge: "bevel" | "round"; raised: boolean; segments: number }
  | { kind: "curve"; curve: [number, number, number, number]; segments: number };

export type WordArtFontSpec =
  | {
      kind: "default";
      /** Absolute URL to `/fonts/default.ttf`, baked from `window.location.origin`
       *  at export time (the relative path is a local site asset that won't
       *  exist on CodePen). */
      url: string;
    }
  | {
      kind: "google";
      /** The picked Google font's full catalog entry — small enough to inline,
       *  and it's exactly what `loadGoogleFont` takes (no extra `listGoogleFonts`
       *  round-trip needed in the exported snippet). */
      entry: FontEntry;
      weight: number;
      style: "normal" | "italic";
    };

/** Everything `composeText` needs to regenerate the mesh, mirroring the
 *  options `WordArtWorkbench`'s own `composeText(...)` call passes. */
export interface WordArtComposeInput {
  /** Case-already-applied text (the page's `applyCase(text, textCase)` result). */
  text: string;
  font: WordArtFontSpec;
  depth: number;
  profile: WordArtProfileSpec;
  letterSpacing: number;
  lineHeight: number;
  align: "left" | "center" | "right";
  underline: boolean;
  strike: boolean;
  curveSteps: number;
  simplify: number;
  warpShape: WarpShape;
  warpAmount: number;
  front: WordArtFaceSpec;
  sides: WordArtFaceSpec | null;
  back: (WordArtFaceSpec & { offset?: [number, number] }) | null;
  outline: { color: string; width: number } | null;
}

export interface WordArtSnippetInput {
  compose: WordArtComposeInput;
  /** Local-Y-axis stretch fraction (maps to the mesh's screen-horizontal axis). */
  scaleX: number;
  /** Local-X-axis stretch fraction (maps to the mesh's screen-vertical axis). */
  scaleY: number;
  /** `[turn, tilt, 0]` — the live turntable/tilt snapshot at export time. */
  rotation: Vec3;
  perspective: boolean;
  /** Snapshotted camera zoom (CSS px per world unit). */
  zoom: number;
  lightDir: Vec3;
  lightIntensity: number;
  lightColor: string;
  ambient: number;
  /** Scene-wide density multiplier — emitted as the render font-size. */
  density: number;
  effect: WordArtSnippetEffect | null;
}

const BASE_FONT_PX = 16;

function fmt(n: number): string {
  if (!Number.isFinite(n)) return "0";
  return String(Number(n.toFixed(2)));
}

function vec3(v: Vec3): string {
  return `[${fmt(v[0])}, ${fmt(v[1])}, ${fmt(v[2])}]`;
}

function jsonForScript(value: unknown): string {
  const json = JSON.stringify(value);
  if (json === undefined) throw new TypeError("WordArt snippet values must be JSON-serializable.");
  return json
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

type JsonFn = (value: unknown) => string;

// ── Mesh regeneration block ────────────────────────────────────────────────
// Shared by every tab: font-loading statements + face reconstruction +
// the `composeText(...)` call, ending in a `meshPolygons` local. Kept as a
// SEPARATE local name (never `polygons`) so callers with their own outer
// `polygons` state/ref (React/Vue) never get silently shadowed by it.

interface MeshBlock {
  /** Named imports needed from `@glyphcss/fonts`. */
  imports: string[];
  /** Statements to splice verbatim (already newline-joinable) ending in `const meshPolygons = ...;`. */
  statements: string[];
}

function profileLiteral(p: WordArtProfileSpec, json: JsonFn): string {
  if (p.kind === "flat") return `"flat"`;
  if (p.kind === "edge") return json({ edge: p.edge, raised: p.raised, segments: p.segments });
  return json({ curve: p.curve, segments: p.segments });
}

function faceExprLiteral(spec: WordArtFaceSpec | null, json: JsonFn): string {
  if (!spec) return "false";
  if (spec.kind === "solid") return `{ color: ${json(spec.color)} }`;
  return `resolveFace(${json(spec)})`;
}

function composeCallLiteral(c: WordArtComposeInput, json: JsonFn): string {
  const lines = [
    `size: 100`,
    `depth: ${fmt(c.depth)}`,
    `profile: ${profileLiteral(c.profile, json)}`,
    `letterSpacing: ${fmt(c.letterSpacing)}`,
    `lineHeight: ${fmt(c.lineHeight)}`,
    `align: ${json(c.align)}`,
    `underline: ${c.underline}`,
    `strike: ${c.strike}`,
    `curveSteps: ${c.curveSteps}`,
    `simplify: ${fmt(c.simplify)}`,
    `warp: { shape: ${json(c.warpShape)}, amount: ${fmt(c.warpAmount)} }`,
    `faces: { front, sides, back }`,
  ];
  if (c.outline) lines.push(`outline: ${json(c.outline)}`);
  return `{\n  ${lines.join(",\n  ")},\n}`;
}

function buildMeshBlock(c: WordArtComposeInput, json: JsonFn): MeshBlock {
  const imports = new Set<string>(["composeText"]);
  const statements: string[] = [];

  if (c.font.kind === "default") {
    imports.add("loadFont");
    statements.push(
      `// Baked from this page's own origin at export time — correct when exported`,
      `// from the deployed site; exporting from a localhost dev server bakes a`,
      `// localhost URL here instead.`,
      `const font = await loadFont(${json(c.font.url)});`,
    );
  } else {
    imports.add("loadGoogleFont");
    statements.push(
      `const fontEntry = ${json(c.font.entry)};`,
      `const font = await loadGoogleFont(fontEntry, ${c.font.weight}, ${json(c.font.style)});`,
    );
  }

  const needsResolveFace = [c.front, c.sides, c.back].some((f) => f && f.kind !== "solid");
  if (needsResolveFace) imports.add("resolveFace");

  statements.push(`const front = ${faceExprLiteral(c.front, json)};`);
  statements.push(`const sides = ${faceExprLiteral(c.sides, json)};`);
  if (c.back) {
    statements.push(`const back = ${faceExprLiteral(c.back, json)};`);
    if (c.back.offset) statements.push(`back.offset = ${json(c.back.offset)};`);
  } else {
    statements.push(`const back = false;`);
  }

  statements.push(
    `const meshPolygons = centerPolygons(composeText(font, ${json(c.text)}, ${composeCallLiteral(c, json)}));`,
  );

  return { imports: [...imports], statements };
}

const CENTER_POLYGONS_JS = `function centerPolygons(polygons) {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const p of polygons) for (const v of p.vertices) {
    if (v[0] < minX) minX = v[0]; if (v[0] > maxX) maxX = v[0];
    if (v[1] < minY) minY = v[1]; if (v[1] > maxY) maxY = v[1];
    if (v[2] < minZ) minZ = v[2]; if (v[2] > maxZ) maxZ = v[2];
  }
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, cz = (minZ + maxZ) / 2;
  return polygons.map((p) => ({
    ...p,
    vertices: p.vertices.map(([x, y, z]) => [x - cx, y - cy, z - cz]),
  }));
}`;

const CENTER_POLYGONS_TS = `function centerPolygons(polygons: Polygon[]): Polygon[] {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const p of polygons) for (const v of p.vertices) {
    if (v[0] < minX) minX = v[0]; if (v[0] > maxX) maxX = v[0];
    if (v[1] < minY) minY = v[1]; if (v[1] > maxY) maxY = v[1];
    if (v[2] < minZ) minZ = v[2]; if (v[2] > maxZ) maxZ = v[2];
  }
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, cz = (minZ + maxZ) / 2;
  return polygons.map((p) => ({
    ...p,
    vertices: p.vertices.map(([x, y, z]) => [x - cx, y - cy, z - cz]) as Polygon["vertices"],
  }));
}`;

interface Prepared {
  fontSizePx: number;
  rotation: string;
  scale: string;
  isOrtho: boolean;
  zoom: string;
  lightDir: string;
  lightIntensity: string;
  lightColor: string;
  ambient: string;
  effect: WordArtSnippetEffect | null;
  effectParamsJson: string;
  hasEffectClock: boolean;
}

function prepare(input: WordArtSnippetInput): Prepared {
  const { scaleX, scaleY, rotation, perspective, zoom, lightDir, lightIntensity, lightColor, ambient, density, effect } = input;
  return {
    fontSizePx: Math.round((BASE_FONT_PX / density) * 100) / 100,
    // Mesh local X = text height (screen-down), local Y = text width
    // (screen-right) — mirrors `Stage`'s `<GlyphMesh scale={[scaleYFrac, scaleXFrac, 1]}>`.
    rotation: vec3(rotation),
    scale: vec3([scaleY, scaleX, 1]),
    isOrtho: !perspective,
    zoom: fmt(zoom),
    lightDir: vec3(lightDir),
    lightIntensity: fmt(lightIntensity),
    lightColor,
    ambient: fmt(ambient),
    effect,
    effectParamsJson: effect ? jsonForScript(effect.params) : "{}",
    hasEffectClock: !!effect?.hasClock && !effect.paused && effect.timeScale > 0,
  };
}

/** The `scene.addEffectLayer(...)` mount + optional rAF clock, shared by the
 *  vanilla tab and the panel's CodePen pen (both drive the scene via the
 *  imperative `createGlyphScene` API, so the block is byte-identical). */
function buildSceneEffectBlock(p: Prepared): string {
  if (!p.effect) return "";
  return `

const effectLayer = scene.addEffectLayer({
  effect: GlyphEffects.${p.effect.exportName},
  params: ${p.effectParamsJson},
  target: "surfaces",
  blend: "${p.effect.blend}",
});${p.hasEffectClock ? `

let effectTime = 0;
let effectPrevious = performance.now();
function animateEffect(now) {
  effectTime += Math.min((now - effectPrevious) / 1000, 0.1) * ${fmt(p.effect.timeScale)};
  effectPrevious = now;
  effectLayer.params.time = effectTime;
  requestAnimationFrame(animateEffect);
}
requestAnimationFrame(animateEffect);` : ""}`;
}

function buildVanilla(p: Prepared, mesh: MeshBlock): string {
  const cameraCtor = p.isOrtho ? "createGlyphOrthographicCamera" : "createGlyphPerspectiveCamera";
  const imports = [
    `import {\n  ${cameraCtor},\n  createGlyphScene,\n  createGlyphOrbitControls,\n} from "https://esm.sh/glyphcss";`,
    `import { ${mesh.imports.join(", ")} } from "https://esm.sh/@glyphcss/fonts";`,
  ];
  if (p.effect) imports.push(`import { GlyphEffects } from "https://esm.sh/@glyphcss/effects";`);

  return `${imports.join("\n")}

${CENTER_POLYGONS_JS}

const host = document.querySelector("#scene");
// Cell font-size sets the ASCII resolution; autoSize fills the host's box.
host.style.fontSize = "${p.fontSizePx}px";

const camera = ${cameraCtor}({ rotX: 0, rotY: 0, zoom: ${p.zoom} });

const scene = createGlyphScene(host, {
  camera,
  mode: "solid",
  autoSize: true,
  useColors: true,
  directionalLight: {
    direction: ${p.lightDir},
    intensity: ${p.lightIntensity},
    color: "${p.lightColor}",
  },
  ambientLight: { intensity: ${p.ambient} },
});

// Load the font, then regenerate the extruded-text mesh with the same
// options the page composed it with.
${mesh.statements.join("\n")}
scene.add(meshPolygons, { rotation: ${p.rotation}, scale: ${p.scale} });

createGlyphOrbitControls(scene, { drag: true, wheel: true });${buildSceneEffectBlock(p)}`;
}

function buildReact(p: Prepared, mesh: MeshBlock): string {
  const cameraComponentName = p.isOrtho ? "GlyphOrthographicCamera" : "GlyphPerspectiveCamera";
  const effectImport = p.effect ? `\nimport { GlyphEffects } from "@glyphcss/effects";` : "";
  const reactImports = `useEffect, useState${p.hasEffectClock ? ", useRef" : ""}`;
  const effectClock = p.hasEffectClock ? `
  const effectLayer = useRef<GlyphEffectLayerHandle<any>>(null);
  useEffect(() => {
    let raf = 0;
    let time = 0;
    let previous = performance.now();
    const frame = (now: number) => {
      time += Math.min((now - previous) / 1000, 0.1) * ${fmt(p.effect!.timeScale)};
      previous = now;
      if (effectLayer.current) effectLayer.current.params.time = time;
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);
` : "";
  const effectTag = p.effect
    ? `\n        <GlyphEffectLayer${p.hasEffectClock ? " ref={effectLayer}" : ""} effect={GlyphEffects.${p.effect.exportName}} params={${p.effectParamsJson}} blend="${p.effect.blend}" />`
    : "";

  return `import { ${reactImports} } from "react";
import {
  ${cameraComponentName},
  GlyphScene,
  GlyphMesh,
  GlyphOrbitControls,
${p.effect ? "  GlyphEffectLayer,\n" : ""}${p.hasEffectClock ? "  type GlyphEffectLayerHandle,\n" : ""}} from "@glyphcss/react";
import type { Polygon } from "@glyphcss/core";
import { ${mesh.imports.join(", ")} } from "@glyphcss/fonts";${effectImport}

${CENTER_POLYGONS_TS}

const directionalLight = {
  direction: ${p.lightDir},
  intensity: ${p.lightIntensity},
  color: "${p.lightColor}",
};
const ambientLight = { intensity: ${p.ambient} };

export function App() {
  const [polygons, setPolygons] = useState<Polygon[]>([]);

  // Load the font, then regenerate the extruded-text mesh with the same
  // options the page composed it with.
  useEffect(() => {
    let alive = true;
    (async () => {
      ${mesh.statements.join("\n      ")}
      if (alive) setPolygons(meshPolygons);
    })();
    return () => {
      alive = false;
    };
  }, []);
${effectClock}
  return (
    <${cameraComponentName} rotX={0} rotY={0} zoom={${p.zoom}}>
      <GlyphScene
        mode="solid"
        autoSize
        style={{ width: "100%", height: "100%", fontSize: ${p.fontSizePx} }}
        useColors
        directionalLight={directionalLight}
        ambientLight={ambientLight}
      >
        <GlyphOrbitControls drag wheel />
        <GlyphMesh polygons={polygons} rotation={${p.rotation}} scale={${p.scale}} />${effectTag}
      </GlyphScene>
    </${cameraComponentName}>
  );
}`;
}

function buildVue(p: Prepared, mesh: MeshBlock): string {
  const cameraComponentName = p.isOrtho ? "GlyphOrthographicCamera" : "GlyphPerspectiveCamera";
  const effectImport = p.effect ? `\nimport { GlyphEffects } from "@glyphcss/effects";` : "";
  const effectTag = p.effect
    ? `\n      <GlyphEffectLayer${p.hasEffectClock ? ` ref="effectLayer"` : ""} :effect="GlyphEffects.${p.effect.exportName}" :params="effectParams" blend="${p.effect.blend}" />`
    : "";
  const effectClock = p.hasEffectClock ? `
const effectLayer = ref<any>(null);
let effectRaf = 0;
onMounted(() => {
  let time = 0;
  let previous = performance.now();
  const frame = (now: number) => {
    time += Math.min((now - previous) / 1000, 0.1) * ${fmt(p.effect!.timeScale)};
    previous = now;
    if (effectLayer.value) effectLayer.value.params.time = time;
    effectRaf = requestAnimationFrame(frame);
  };
  effectRaf = requestAnimationFrame(frame);
});
onBeforeUnmount(() => cancelAnimationFrame(effectRaf));
` : "";

  return `<template>
  <${cameraComponentName} :rot-x="0" :rot-y="0" :zoom="${p.zoom}">
    <GlyphScene
      mode="solid"
      auto-size
      :style="{ width: '100%', height: '100%', fontSize: '${p.fontSizePx}px' }"
      use-colors
      :directional-light="directionalLight"
      :ambient-light="ambientLight"
    >
      <GlyphOrbitControls drag wheel />
      <GlyphMesh :polygons="polygons" :rotation="${p.rotation}" :scale="${p.scale}" />${effectTag}
    </GlyphScene>
  </${cameraComponentName}>
</template>

<script setup lang="ts">
import { onMounted, ref${p.hasEffectClock ? ", onBeforeUnmount" : ""} } from "vue";
import {
  ${cameraComponentName},
  GlyphScene,
  GlyphMesh,
  GlyphOrbitControls,
${p.effect ? "  GlyphEffectLayer,\n" : ""}} from "@glyphcss/vue";
import type { Polygon } from "@glyphcss/core";
import { ${mesh.imports.join(", ")} } from "@glyphcss/fonts";${effectImport}

${CENTER_POLYGONS_TS}

const polygons = ref<Polygon[]>([]);
${p.effect ? `const effectParams = ${p.effectParamsJson};` : ""}

// Load the font, then regenerate the extruded-text mesh with the same
// options the page composed it with.
onMounted(async () => {
  ${mesh.statements.join("\n  ")}
  polygons.value = meshPolygons;
});
${effectClock}

const directionalLight = {
  direction: ${p.lightDir},
  intensity: ${p.lightIntensity},
  color: "${p.lightColor}",
};
const ambientLight = { intensity: ${p.ambient} };
</script>`;
}

function buildHtml(p: Prepared, mesh: MeshBlock): string {
  const cameraTag = p.isOrtho ? "glyph-orthographic-camera" : "glyph-perspective-camera";
  const effectScript = p.effect ? `\n    <script type="module">
      import { GlyphEffects } from "https://esm.sh/@glyphcss/effects";

      const sceneElement = document.querySelector("#scene");
      const addEffect = () => {
        const effectLayer = sceneElement.getScene().addEffectLayer({
          effect: GlyphEffects.${p.effect.exportName},
          params: ${p.effectParamsJson},
          target: "surfaces",
          blend: "${p.effect.blend}",
        });${p.hasEffectClock ? `

        let effectTime = 0;
        let effectPrevious = performance.now();
        const animateEffect = (now) => {
          effectTime += Math.min((now - effectPrevious) / 1000, 0.1) * ${fmt(p.effect.timeScale)};
          effectPrevious = now;
          effectLayer.params.time = effectTime;
          requestAnimationFrame(animateEffect);
        };
        requestAnimationFrame(animateEffect);` : ""}
      };
      if (sceneElement.getScene()) addEffect();
      else sceneElement.addEventListener("glyphcss:scene-ready", addEffect, { once: true });
    </script>` : "";

  return `<!DOCTYPE html>
<html>
  <head>
    <script type="module" src="https://esm.sh/glyphcss/elements"></script>
    <style>
      /* Cell font-size sets the ASCII resolution; auto-size fills the box. */
      glyph-scene { display: block; width: 100%; height: 100vh; font-size: ${p.fontSizePx}px; }
    </style>
  </head>
  <body>
    <${cameraTag} rot-x="0" rot-y="0" zoom="${p.zoom}">
      <glyph-scene id="scene" mode="solid" auto-size use-colors>
        <glyph-orbit-controls drag wheel></glyph-orbit-controls>
      </glyph-scene>
    </${cameraTag}>

    <script type="module">
      import { createGlyphScene } from "https://esm.sh/glyphcss";
      import { ${mesh.imports.join(", ")} } from "https://esm.sh/@glyphcss/fonts";

      ${CENTER_POLYGONS_JS.split("\n").join("\n      ")}

      const sceneElement = document.querySelector("#scene");
      const setup = async () => {
        const scene = sceneElement.getScene();
        // <glyph-scene> has no attribute for direction/color — set the full
        // lighting config imperatively instead.
        scene.setOptions({
          directionalLight: {
            direction: ${p.lightDir},
            intensity: ${p.lightIntensity},
            color: "${p.lightColor}",
          },
          ambientLight: { intensity: ${p.ambient} },
        });
        // Load the font, then regenerate the extruded-text mesh with the
        // same options the page composed it with.
        ${mesh.statements.join("\n        ")}
        scene.add(meshPolygons, { rotation: ${p.rotation}, scale: ${p.scale} });
        scene.fit();
      };
      if (sceneElement.getScene()) setup();
      else sceneElement.addEventListener("glyphcss:scene-ready", setup, { once: true });
    </script>${effectScript}
  </body>
</html>`;
}

export function generateWordArtSnippets(input: WordArtSnippetInput): Record<WordArtTab, string> {
  const p = prepare(input);
  const meshJs = buildMeshBlock(input.compose, JSON.stringify);
  const meshHtml = buildMeshBlock(input.compose, jsonForScript);
  return {
    html: buildHtml(p, meshHtml),
    vanilla: buildVanilla(p, meshJs),
    react: buildReact(p, meshJs),
    vue: buildVue(p, meshJs),
  };
}

/**
 * The Export panel's own "CodePen" action — a self-contained, lib-based
 * (glyphcss + `@glyphcss/fonts` + `@glyphcss/effects` from the CDN) pen that
 * regenerates the mesh via `composeText` at runtime instead of shipping a
 * baked polygon literal. Mirrors `buildVanilla`'s `createGlyphScene` +
 * `scene.add` shape, split into CodePen's `html`/`css`/`js` prefill fields
 * (`js` stays empty — the module script lives inline in `html`, same
 * convention `buildGlyphInteractiveExport`'s own `pen` uses elsewhere on
 * this site).
 */
export function buildWordArtCodepenPen(input: WordArtSnippetInput, title: string): { action: string; data: string } {
  const p = prepare(input);
  const mesh = buildMeshBlock(input.compose, jsonForScript);
  const cameraCtor = p.isOrtho ? "createGlyphOrthographicCamera" : "createGlyphPerspectiveCamera";
  const effectsImport = p.effect ? `\nimport { GlyphEffects } from "https://esm.sh/@glyphcss/effects";` : "";

  const script = `import {
  ${cameraCtor},
  createGlyphScene,
  createGlyphOrbitControls,
} from "https://esm.sh/glyphcss";
import { ${mesh.imports.join(", ")} } from "https://esm.sh/@glyphcss/fonts";${effectsImport}

${CENTER_POLYGONS_JS}

const host = document.getElementById("glyph");

const camera = ${cameraCtor}({ rotX: 0, rotY: 0, zoom: ${p.zoom} });

const scene = createGlyphScene(host, {
  camera,
  mode: "solid",
  autoSize: true,
  useColors: true,
  directionalLight: {
    direction: ${p.lightDir},
    intensity: ${p.lightIntensity},
    color: "${p.lightColor}",
  },
  ambientLight: { intensity: ${p.ambient} },
});

${mesh.statements.join("\n")}
scene.add(meshPolygons, { rotation: ${p.rotation}, scale: ${p.scale} });

createGlyphOrbitControls(scene, { drag: true, wheel: true });${buildSceneEffectBlock(p)}`;

  const css = `html,body{margin:0;height:100%;background:#07090d}
#glyph{width:100vw;height:100vh;font-size:${p.fontSizePx}px}
#glyph pre.glyph-output{margin:0}`;

  const html = `<div id="glyph"></div>\n<script type="module">\n${script}\n</script>`;

  return {
    action: "https://codepen.io/pen/define",
    data: JSON.stringify({ title, html, css, js: "", editors: "110" }),
  };
}
