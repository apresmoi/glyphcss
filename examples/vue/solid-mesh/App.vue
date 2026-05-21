<template>
  <div class="scene-host">
    <GlyphPerspectiveCamera :rot-x="0.5" :rot-y="0.4" :zoom="0.35" :distance="100">
      <GlyphOrbitControls :drag="true" :wheel="true" />
      <GlyphScene>
        <GlyphMesh v-if="polygons" :polygons="polygons" />
      </GlyphScene>
    </GlyphPerspectiveCamera>
  </div>
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
import type { Polygon } from "@glyphcss/vue";

const GLB_URL = "https://glyphcss.com/gallery/glb/poly-pizza/human-dude-guy.glb";

const polygons = ref<Polygon[] | undefined>();

onMounted(() => {
  loadMesh(GLB_URL).then((result) => {
    polygons.value = result;
  });
});
</script>

<style>
html, body { margin: 0; height: 100%; background: #111; }
.scene-host { width: 100%; height: 100vh; }
.scene-host .glyphcss-camera { width: 100%; height: 100%; }
</style>
