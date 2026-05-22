<template>
  <GlyphPerspectiveCamera :rot-x="0.5" :rot-y="0.4" :zoom="0.35" :distance="100" style="width:100%;height:100vh">
    <GlyphScene>
      <GlyphOrbitControls :drag="true" :wheel="true" />
      <GlyphMesh v-if="polygons" :polygons="polygons" />
    </GlyphScene>
  </GlyphPerspectiveCamera>
</template>

<script setup lang="ts">
import { ref, onMounted } from "vue";
import {
  GlyphPerspectiveCamera,
  GlyphScene,
  GlyphOrbitControls,
  GlyphMesh,
  loadMesh,
} from "@glyphcss/vue";
import { computeSceneBbox } from "@glyphcss/vue";
import type { Polygon, Vec3 } from "@glyphcss/vue";

const GLB_URL = "/apple.glb";

/** Center and scale polygons to fit a 2-unit bounding box at origin. */
function fitToUnitBbox(polys: Polygon[]): Polygon[] {
  const bbox = computeSceneBbox(polys);
  const cx = (bbox.min[0] + bbox.max[0]) / 2;
  const cy = (bbox.min[1] + bbox.max[1]) / 2;
  const cz = (bbox.min[2] + bbox.max[2]) / 2;
  const size = Math.max(
    bbox.max[0] - bbox.min[0],
    bbox.max[1] - bbox.min[1],
    bbox.max[2] - bbox.min[2],
  ) || 1;
  const k = 2 / size;
  return polys.map((p) => ({
    ...p,
    vertices: p.vertices.map((v): Vec3 => [
      (v[0] - cx) * k,
      (v[1] - cy) * k,
      (v[2] - cz) * k,
    ]),
  }));
}

const polygons = ref<Polygon[] | undefined>();

onMounted(() => {
  loadMesh(GLB_URL).then((result) => {
    polygons.value = fitToUnitBbox(result.polygons);
  });
});
</script>

<style>
html, body { margin: 0; height: 100%; background: #111; }
</style>
