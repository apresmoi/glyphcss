<template>
  <GlyphPerspectiveCamera :rot-x="25" :rot-y="25" :zoom="0.35" :distance="100" style="width:100%;height:100vh">
    <GlyphScene :auto-size="true">
      <GlyphOrbitControls :drag="true" :wheel="true" />
      <!-- `src` fetches + parses the mesh; `auto-center` recenters it to its
           own center. No manual loadMesh / recenter boilerplate. -->
      <GlyphMesh src="/apple.glb" auto-center />
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
