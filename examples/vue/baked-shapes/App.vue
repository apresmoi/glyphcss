<template>
  <GlyphPerspectiveCamera :rot-x="0.5" :rot-y="0.4" :zoom="0.4" :distance="100" style="width:100%;height:100vh">
    <GlyphScene :auto-size="true">
      <GlyphOrbitControls :drag="true" :wheel="true" />
      <GlyphMesh geometry="dodecahedron" color="#ff6644" />
    </GlyphScene>
  </GlyphPerspectiveCamera>
</template>

<script setup lang="ts">
import {
  GlyphPerspectiveCamera,
  GlyphScene,
  GlyphOrbitControls,
  GlyphMesh,
} from "@glyphcss/vue";
</script>

<style>
html, body { margin: 0; height: 100%; background: #111; }
</style>
