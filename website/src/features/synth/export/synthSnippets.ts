/**
 * synthSnippets — generate the /synth page's "use the libs" export code
 * (HTML custom elements / vanilla JS / React / Vue), each importing glyphcss
 * + `@glyphcss/effects` from a CDN and mounting the live field-synth patch
 * (current params + a rAF time clock) on the current shape + camera.
 *
 * Sibling to the gallery's `CodePanel.tsx` `generateSnippets` — same shape
 * (one function per framework, rendered by the same-look `SynthCodePanel`)
 * — kept separate rather than reused directly because the synth scene has
 * no primitive/src mesh, no perspective camera, and needs its own
 * per-face-UV shape builder (`shapePolys`/`withFaceUvs`, mirroring
 * `SynthWorkbench.tsx`) inlined into every snippet: `@glyphcss/core` has no
 * `"plane"` geometry and `resolveGeometry` never generates UVs, so a
 * faithful export has to ship that helper rather than call a lib function.
 */

export type SynthTab = "html" | "vanilla" | "react" | "vue";

export interface SynthLighting {
  azimuth: number;
  elevation: number;
  keyIntensity: number;
  keyColor: string;
  ambient: number;
}

export interface SynthSnippetInput {
  shape: string;
  /** Live field-synth params, minus `time` (the emitted clock owns it). */
  params: Record<string, number | string | boolean>;
  timeScale: number;
  paused: boolean;
  density: number;
  lighting: SynthLighting;
  camera: { rotX: number; rotY: number; zoom: number };
}

/** The ONE blend both scene.addEffectLayer() calls in SynthWorkbench mount the
 *  layer with — kept in sync with `SYNTH_EFFECT_BLEND` there. */
export const SYNTH_EFFECT_BLEND = "replace";

export const isFlatShape = (shape: string): boolean => shape === "plane";

function fmt(n: number): string {
  if (!Number.isFinite(n)) return "0";
  return String(Number(n.toFixed(2)));
}

function vec3(v: [number, number, number]): string {
  return `[${fmt(v[0])}, ${fmt(v[1])}, ${fmt(v[2])}]`;
}

function dirFromSpherical(azimuthDeg: number, elevationDeg: number): [number, number, number] {
  const az = (azimuthDeg * Math.PI) / 180;
  const el = (elevationDeg * Math.PI) / 180;
  return [Math.cos(el) * Math.cos(az), Math.cos(el) * Math.sin(az), Math.sin(el)];
}

function jsonForScript(value: unknown): string {
  const json = JSON.stringify(value);
  if (json === undefined) throw new TypeError("Synth snippet values must be JSON-serializable.");
  return json
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

/**
 * Inlined verbatim (functionally) from `SynthWorkbench.tsx`'s `flatQuad` /
 * `withFaceUvs` / `shapePolys` so the exported snippet reproduces the exact
 * per-face UV mapping the live page renders with.
 */
function shapePolysHelperSrc(shape: string): string {
  if (isFlatShape(shape)) {
    return `function shapePolys() {
  const size = 3;
  return [{
    vertices: [[-size, -size, 0], [size, -size, 0], [size, size, 0], [-size, size, 0]],
    uvs: [[0, 0], [1, 0], [1, 1], [0, 1]],
  }];
}`;
  }
  return `function withFaceUvs(polys) {
  return polys.map((p) => {
    const vs = p.vertices;
    const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
    const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
    const n = norm(cross(sub(vs[1], vs[0]), sub(vs[2], vs[0])));
    const u = norm(sub(vs[1], vs[0]));
    const v = cross(n, u);
    const proj = vs.map((w) => { const d = sub(w, vs[0]); return [dot(d, u), dot(d, v)]; });
    let mnu = Infinity, mxu = -Infinity, mnv = Infinity, mxv = -Infinity;
    for (const [pu, pv] of proj) { if (pu < mnu) mnu = pu; if (pu > mxu) mxu = pu; if (pv < mnv) mnv = pv; if (pv > mxv) mxv = pv; }
    const su = (mxu - mnu) || 1, sv = (mxv - mnv) || 1;
    return { ...p, uvs: proj.map(([pu, pv]) => [(pu - mnu) / su, (pv - mnv) / sv]) };
  });
}
function shapePolys() {
  return withFaceUvs(resolveGeometry(${JSON.stringify(shape)}, { size: 3 }));
}`;
}

interface Prepared {
  flat: boolean;
  fontSizePx: number;
  lightDir: [number, number, number];
  effectParams: string;
  effectTimeScale: string;
  helperSrc: string;
  rotX: string;
  rotY: string;
  zoom: string;
  lighting: SynthLighting;
}

function prepare(input: SynthSnippetInput): Prepared {
  const { shape, params, timeScale, paused, density, lighting, camera } = input;
  return {
    flat: isFlatShape(shape),
    fontSizePx: Math.round((13 / density) * 100) / 100,
    lightDir: dirFromSpherical(lighting.azimuth, lighting.elevation),
    effectParams: jsonForScript(params),
    effectTimeScale: fmt(paused ? 0 : timeScale),
    helperSrc: shapePolysHelperSrc(shape),
    rotX: fmt(camera.rotX),
    rotY: fmt(camera.rotY),
    zoom: fmt(camera.zoom),
    lighting,
  };
}

function buildVanilla(p: Prepared): string {
  const imports = [
    `import {\n  createGlyphOrthographicCamera,\n  createGlyphScene,${p.flat ? "" : "\n  createGlyphOrbitControls,"}\n} from "glyphcss";`,
  ];
  if (!p.flat) imports.push(`import { resolveGeometry } from "@glyphcss/core";`);
  imports.push(`import { GlyphEffects } from "@glyphcss/effects";`);

  return `${imports.join("\n")}

${p.helperSrc}

const host = document.querySelector<HTMLElement>("#scene")!;
// Cell font-size sets the ASCII resolution; autoSize fills the host's box.
host.style.fontSize = "${p.fontSizePx}px";

const camera = createGlyphOrthographicCamera({ rotX: ${p.rotX}, rotY: ${p.rotY}, zoom: ${p.zoom} });

const scene = createGlyphScene(host, {
  camera,
  mode: "solid",
  autoSize: true,
  useColors: true,
  glyphPalette: "default",
  doubleSided: ${p.flat},
  directionalLight: {
    direction: ${vec3(p.lightDir)},
    intensity: ${fmt(p.lighting.keyIntensity)},
    color: "${p.lighting.keyColor}",
  },
  ambientLight: { intensity: ${fmt(p.lighting.ambient)} },
});

scene.add(shapePolys());
scene.fit();
${p.flat ? "" : "createGlyphOrbitControls(scene, { drag: true, wheel: true });\n"}
const effectLayer = scene.addEffectLayer({
  effect: GlyphEffects.fieldSynth,
  params: ${p.effectParams},
  target: "surfaces",
  blend: "${SYNTH_EFFECT_BLEND}",
});

let effectTime = 0;
let effectPrevious = performance.now();
function animateEffect(now: number) {
  effectTime += Math.min((now - effectPrevious) / 1000, 0.1) * ${p.effectTimeScale};
  effectPrevious = now;
  effectLayer.params.time = effectTime;
  requestAnimationFrame(animateEffect);
}
requestAnimationFrame(animateEffect);`;
}

function buildReact(p: Prepared): string {
  const coreSpecifiers = p.flat ? "type Polygon" : "resolveGeometry, type Polygon";
  return `import { useEffect, useMemo, useRef } from "react";
import {
  GlyphOrthographicCamera,
  GlyphScene,
  GlyphMesh,${p.flat ? "" : "\n  GlyphOrbitControls,"}
  GlyphEffectLayer,
  type GlyphEffectLayerHandle,
} from "@glyphcss/react";
import { ${coreSpecifiers} } from "@glyphcss/core";
import { GlyphEffects } from "@glyphcss/effects";

${p.helperSrc}

const directionalLight = {
  direction: ${vec3(p.lightDir)},
  intensity: ${fmt(p.lighting.keyIntensity)},
  color: "${p.lighting.keyColor}",
};
const ambientLight = { intensity: ${fmt(p.lighting.ambient)} };

export function App() {
  const polygons = useMemo<Polygon[]>(() => shapePolys(), []);
  const effectLayer = useRef<GlyphEffectLayerHandle<any>>(null);

  useEffect(() => {
    let raf = 0;
    let time = 0;
    let previous = performance.now();
    const frame = (now: number) => {
      time += Math.min((now - previous) / 1000, 0.1) * ${p.effectTimeScale};
      previous = now;
      if (effectLayer.current) effectLayer.current.params.time = time;
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <GlyphOrthographicCamera rotX={${p.rotX}} rotY={${p.rotY}} zoom={${p.zoom}}>
      <GlyphScene
        mode="solid"
        autoSize
        style={{ width: "100%", height: "100%", fontSize: ${p.fontSizePx} }}
        useColors
        doubleSided={${p.flat}}
        directionalLight={directionalLight}
        ambientLight={ambientLight}
      >
        ${p.flat ? "" : "<GlyphOrbitControls drag wheel />\n        "}<GlyphMesh polygons={polygons} />
        <GlyphEffectLayer ref={effectLayer} effect={GlyphEffects.fieldSynth} params={${p.effectParams}} blend="${SYNTH_EFFECT_BLEND}" />
      </GlyphScene>
    </GlyphOrthographicCamera>
  );
}`;
}

function buildVue(p: Prepared): string {
  const coreSpecifiers = p.flat ? "type Polygon" : "resolveGeometry, type Polygon";
  return `<template>
  <GlyphOrthographicCamera :rot-x="${p.rotX}" :rot-y="${p.rotY}" :zoom="${p.zoom}">
    <GlyphScene
      mode="solid"
      auto-size
      :style="{ width: '100%', height: '100%', fontSize: '${p.fontSizePx}px' }"
      use-colors
      :double-sided="${p.flat}"
      :directional-light="directionalLight"
      :ambient-light="ambientLight"
    >
      ${p.flat ? "" : "<GlyphOrbitControls drag wheel />\n      "}<GlyphMesh :polygons="polygons" />
      <GlyphEffectLayer ref="effectLayer" :effect="GlyphEffects.fieldSynth" :params="effectParams" blend="${SYNTH_EFFECT_BLEND}" />
    </GlyphScene>
  </GlyphOrthographicCamera>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import {
  GlyphOrthographicCamera,
  GlyphScene,
  GlyphMesh,${p.flat ? "" : "\n  GlyphOrbitControls,"}
  GlyphEffectLayer,
} from "@glyphcss/vue";
import { ${coreSpecifiers} } from "@glyphcss/core";
import { GlyphEffects } from "@glyphcss/effects";

${p.helperSrc}

const polygons: Polygon[] = shapePolys();
const effectParams = ${p.effectParams};
const effectLayer = ref<any>(null);
let effectRaf = 0;
onMounted(() => {
  let time = 0;
  let previous = performance.now();
  const frame = (now: number) => {
    time += Math.min((now - previous) / 1000, 0.1) * ${p.effectTimeScale};
    previous = now;
    if (effectLayer.value) effectLayer.value.params.time = time;
    effectRaf = requestAnimationFrame(frame);
  };
  effectRaf = requestAnimationFrame(frame);
});
onBeforeUnmount(() => cancelAnimationFrame(effectRaf));

const directionalLight = {
  direction: ${vec3(p.lightDir)},
  intensity: ${fmt(p.lighting.keyIntensity)},
  color: "${p.lighting.keyColor}",
};
const ambientLight = { intensity: ${fmt(p.lighting.ambient)} };
</script>`;
}

function buildHtml(p: Prepared): string {
  const imports = [`import { GlyphEffects } from "https://esm.sh/@glyphcss/effects";`];
  if (!p.flat) imports.unshift(`import { resolveGeometry } from "https://esm.sh/@glyphcss/core";`);

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
    <glyph-orthographic-camera rot-x="${p.rotX}" rot-y="${p.rotY}" zoom="${p.zoom}">
      <glyph-scene id="scene" mode="solid" auto-size use-colors>
        ${p.flat ? "" : "<glyph-orbit-controls drag wheel></glyph-orbit-controls>\n        "}
      </glyph-scene>
    </glyph-orthographic-camera>

    <script type="module">
      ${imports.join("\n      ")}

      ${p.helperSrc}

      const sceneElement = document.querySelector("#scene");
      const setup = () => {
        const scene = sceneElement.getScene();
        // <glyph-scene> has no attribute for direction/color/doubleSided —
        // set the full lighting + shading config imperatively instead.
        scene.setOptions({
          doubleSided: ${p.flat},
          directionalLight: {
            direction: ${vec3(p.lightDir)},
            intensity: ${fmt(p.lighting.keyIntensity)},
            color: "${p.lighting.keyColor}",
          },
          ambientLight: { intensity: ${fmt(p.lighting.ambient)} },
        });
        scene.add(shapePolys());
        scene.fit();

        const effectLayer = scene.addEffectLayer({
          effect: GlyphEffects.fieldSynth,
          params: ${p.effectParams},
          target: "surfaces",
          blend: "${SYNTH_EFFECT_BLEND}",
        });

        let effectTime = 0;
        let effectPrevious = performance.now();
        const animateEffect = (now) => {
          effectTime += Math.min((now - effectPrevious) / 1000, 0.1) * ${p.effectTimeScale};
          effectPrevious = now;
          effectLayer.params.time = effectTime;
          requestAnimationFrame(animateEffect);
        };
        requestAnimationFrame(animateEffect);
      };
      if (sceneElement.getScene()) setup();
      else sceneElement.addEventListener("glyphcss:scene-ready", setup, { once: true });
    </script>
  </body>
</html>`;
}

export function generateSynthSnippets(input: SynthSnippetInput): Record<SynthTab, string> {
  const p = prepare(input);
  return {
    html: buildHtml(p),
    vanilla: buildVanilla(p),
    react: buildReact(p),
    vue: buildVue(p),
  };
}
