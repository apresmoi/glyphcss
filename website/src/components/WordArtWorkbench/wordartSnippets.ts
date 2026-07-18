/**
 * wordartSnippets — generate /wordart's "use the libs" export code (HTML
 * custom elements / vanilla JS / React / Vue), each importing glyphcss (+
 * `@glyphcss/effects` when an effect is mounted) from a CDN and reconstructing
 * the current extruded-text mesh: inlined polygons, camera, lighting, and
 * (if set) the live Glyph Effects layer + a time clock.
 *
 * Sibling to `../SynthWorkbench/synthSnippets.ts` (same shape: one function
 * per framework, rendered by the same-look `WordArtCodePanel`) and to
 * `../GalleryWorkbench/CodePanel.tsx`'s `generateSnippets` (same mesh + camera
 * + lighting + effect reconstruction) — kept separate because WordArt's mesh
 * has no `src`/`geometry` reference to point at: the polygons are generated
 * from a font at compose time, so they're inlined as a literal instead of
 * fetched. Colors are flattened to each polygon's base `color` (front/side/
 * back), the same simplification `buildGlyphInteractiveExport`'s own
 * `serializePolygons` makes for the CodePen payload (gradient/rainbow/
 * texture/image fills bake down to their authored base tint, not the sampled
 * pattern) — a snippet can't ship the runtime canvas/image sampling those
 * fills use live.
 */
import type { Polygon, Vec3 } from "@glyphcss/core";

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

export interface WordArtSnippetInput {
  /** Bbox-centered mesh polygons (unscaled, unrotated — scale/rotation are separate props). */
  polygons: Polygon[];
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

function round(n: number): number {
  return Math.round(n * 1e4) / 1e4;
}

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

/** `[[x,y,z], color]` tuples — same shape `buildGlyphInteractiveExport`'s
 *  `serializePolygons` emits, so every tab maps it back the same way. */
function polygonLiteral(polygons: Polygon[]): string {
  const arr = polygons.map((p) => [
    p.vertices.map((v) => [round(v[0]), round(v[1]), round(v[2])]),
    p.color ?? "#cccccc",
  ]);
  return JSON.stringify(arr);
}

interface Prepared {
  fontSizePx: number;
  polysJson: string;
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
  const { polygons, scaleX, scaleY, rotation, perspective, zoom, lightDir, lightIntensity, lightColor, ambient, density, effect } = input;
  return {
    fontSizePx: Math.round((BASE_FONT_PX / density) * 100) / 100,
    polysJson: polygonLiteral(polygons),
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

function buildVanilla(p: Prepared): string {
  const cameraCtor = p.isOrtho ? "createGlyphOrthographicCamera" : "createGlyphPerspectiveCamera";
  const imports = [`import {\n  ${cameraCtor},\n  createGlyphScene,\n  createGlyphOrbitControls,\n} from "glyphcss";`];
  if (p.effect) imports.push(`import { GlyphEffects } from "@glyphcss/effects";`);

  const effectBlock = p.effect ? `

const effectLayer = scene.addEffectLayer({
  effect: GlyphEffects.${p.effect.exportName},
  params: ${p.effectParamsJson},
  target: "surfaces",
  blend: "${p.effect.blend}",
});${p.hasEffectClock ? `

let effectTime = 0;
let effectPrevious = performance.now();
function animateEffect(now: number) {
  effectTime += Math.min((now - effectPrevious) / 1000, 0.1) * ${fmt(p.effect.timeScale)};
  effectPrevious = now;
  effectLayer.params.time = effectTime;
  requestAnimationFrame(animateEffect);
}
requestAnimationFrame(animateEffect);` : ""}` : "";

  return `${imports.join("\n")}

const host = document.querySelector<HTMLElement>("#scene")!;
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

const polygons = ${p.polysJson}.map(([vertices, color]) => ({ vertices, color }));
scene.add(polygons, { rotation: ${p.rotation}, scale: ${p.scale} });

createGlyphOrbitControls(scene, { drag: true, wheel: true });${effectBlock}`;
}

function buildReact(p: Prepared): string {
  const cameraComponentName = p.isOrtho ? "GlyphOrthographicCamera" : "GlyphPerspectiveCamera";
  const effectImport = p.effect ? `\nimport { GlyphEffects } from "@glyphcss/effects";` : "";
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

  return `${p.hasEffectClock ? `import { useEffect, useMemo, useRef } from "react";\n` : `import { useMemo } from "react";\n`}import {
  ${cameraComponentName},
  GlyphScene,
  GlyphMesh,
  GlyphOrbitControls,
${p.effect ? "  GlyphEffectLayer,\n" : ""}${p.hasEffectClock ? "  type GlyphEffectLayerHandle,\n" : ""}} from "@glyphcss/react";
import type { Polygon } from "@glyphcss/core";${effectImport}

const directionalLight = {
  direction: ${p.lightDir},
  intensity: ${p.lightIntensity},
  color: "${p.lightColor}",
};
const ambientLight = { intensity: ${p.ambient} };

export function App() {
  const polygons = useMemo<Polygon[]>(
    () => ${p.polysJson}.map(([vertices, color]) => ({ vertices, color })),
    [],
  );
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

function buildVue(p: Prepared): string {
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
${p.hasEffectClock ? `import { onBeforeUnmount, onMounted, ref } from "vue";\n` : ""}import {
  ${cameraComponentName},
  GlyphScene,
  GlyphMesh,
  GlyphOrbitControls,
${p.effect ? "  GlyphEffectLayer,\n" : ""}} from "@glyphcss/vue";
import type { Polygon } from "@glyphcss/core";${effectImport}

const polygons: Polygon[] = ${p.polysJson}.map(([vertices, color]) => ({ vertices, color }));
${p.effect ? `const effectParams = ${p.effectParamsJson};` : ""}
${effectClock}

const directionalLight = {
  direction: ${p.lightDir},
  intensity: ${p.lightIntensity},
  color: "${p.lightColor}",
};
const ambientLight = { intensity: ${p.ambient} };
</script>`;
}

function buildHtml(p: Prepared): string {
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

      const polygons = ${p.polysJson}.map(([vertices, color]) => ({ vertices, color }));
      const sceneElement = document.querySelector("#scene");
      const setup = () => {
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
        scene.add(polygons, { rotation: ${p.rotation}, scale: ${p.scale} });
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
  return {
    html: buildHtml(p),
    vanilla: buildVanilla(p),
    react: buildReact(p),
    vue: buildVue(p),
  };
}
