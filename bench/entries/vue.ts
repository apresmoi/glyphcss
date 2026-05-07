/**
 * Bench entry — Vue 3. Bundled by bench/build.mjs into bench/polycss-vue.js
 * and loaded by bench/perf-vue.html.
 *
 * Mounts a <PolyCamera><PolyScene><PolyControls + mesh> tree and drives
 * per-frame state via reactive ref() updates from a shared rAF loop.
 * Measures Vue's reactivity flush + render cost on top of the polycss
 * renderer.
 *
 * Uses defineComponent + render functions (not SFC templates) so the
 * bundler doesn't need a Vue template compiler.
 */
import { createApp, defineComponent, h, onMounted, onBeforeUnmount, ref, computed } from "vue";
import {
  PolyCamera,
  PolyScene,
  PolyControls,
  PolyMesh,
  Poly,
} from "@polycss/vue";
import type { Polygon } from "@polycss/core";
import { loadMesh } from "@polycss/core";
// @ts-expect-error — sibling .mjs without types
import { parseUrlParams, dirFromAzEl, createPerfRecorder, PERF_OVERLAY_HTML, PERF_OVERLAY_CSS } from "../perf-shared.mjs";
// @ts-expect-error — sibling .mjs without types
import { getSynthMesh } from "../synth-mesh.mjs";

interface ParseResult { polygons: Polygon[]; dispose?: () => void }

const PerfApp = defineComponent({
  name: "PerfApp",
  props: {
    meshId: { type: String, required: true },
    mode: { type: String as () => "dynamic" | "baked", required: true },
    motion: { type: String as () => "light" | "rot" | "none", required: true },
    az: { type: Number, required: true },
    el: { type: Number, required: true },
    preset: { type: Object as () => any, required: true },
    parseResult: { type: Object as () => ParseResult | null, default: null },
  },
  setup(props) {
    const rotY = ref(props.preset.rotY);
    const lightDir = ref<[number, number, number]>(dirFromAzEl(props.az, props.el));

    const directionalLight = computed(() => ({
      direction: lightDir.value,
      color: "#ffffff",
      intensity: 1,
    }));
    const ambientLight = { color: "#ffffff", intensity: 0.4 };

    let raf: number | null = null;
    onMounted(() => {
      const polyCount = props.parseResult?.polygons?.length ?? 0;
      const recorder = createPerfRecorder({
        rendererLabel: "vue",
        meshId: props.meshId,
        mode: props.mode,
        motion: props.motion,
        polyCount,
      });

      let azimuth = props.az;
      let frameCount = 0;
      const tick = (now: number): void => {
        recorder.onFrame(now);
        frameCount += 1;
        if (props.motion === "light") {
          azimuth = (azimuth + 0.5) % 360;
          lightDir.value = dirFromAzEl(azimuth, props.el);
        } else if (props.motion === "rot") {
          rotY.value = (((props.preset.rotY + frameCount * 0.5) % 360) + 360) % 360;
        }
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    });
    onBeforeUnmount(() => {
      if (raf !== null) cancelAnimationFrame(raf);
    });

    return () => h(
      PolyCamera,
      { rotX: props.preset.rotX, rotY: rotY.value, zoom: props.preset.zoom },
      {
        default: () => h(
          PolyScene,
          {
            directionalLight: directionalLight.value,
            ambientLight,
            textureLighting: props.mode,
            autoCenter: true,
          },
          {
            default: () => [
              h(PolyControls, { drag: true, wheel: true, animate: false }),
              props.parseResult
                ? props.parseResult.polygons.map((p, i) => h(Poly, { key: i, ...p }))
                : props.preset.url
                  ? h(PolyMesh, { src: props.preset.url, mtlUrl: props.preset.mtlUrl })
                  : null,
            ],
          },
        ),
      },
    );
  },
});

async function main(): Promise<void> {
  const css = document.createElement("style");
  css.textContent = PERF_OVERLAY_CSS;
  document.head.appendChild(css);
  document.body.insertAdjacentHTML("beforeend", PERF_OVERLAY_HTML);

  const params = parseUrlParams() as {
    meshId: string;
    mode: "dynamic" | "baked";
    motion: "light" | "rot" | "none";
    az: number;
    el: number;
    isSynth: boolean;
    preset: any;
  };

  let parseResult: ParseResult | null = null;
  if (params.isSynth) {
    parseResult = getSynthMesh(params.meshId);
  } else if (params.preset.url) {
    parseResult = await loadMesh(params.preset.url, {
      ...(params.preset.mtlUrl ? { mtlUrl: params.preset.mtlUrl } : {}),
      objOptions: params.preset.options,
    });
  }

  const host = document.getElementById("host")!;
  createApp(PerfApp, {
    meshId: params.meshId,
    mode: params.mode,
    motion: params.motion,
    az: params.az,
    el: params.el,
    preset: params.preset,
    parseResult,
  }).mount(host);
}

main().catch((err) => {
  console.error("perf-vue entry failed", err);
  const fpsNow = document.getElementById("fps-now");
  if (fpsNow) fpsNow.textContent = "ERR";
});
