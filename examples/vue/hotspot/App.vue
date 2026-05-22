<template>
  <GlyphPerspectiveCamera :rot-x="1.13" :rot-y="0.785" :zoom="0.25" :distance="100" style="width:100%;height:100vh">
    <GlyphScene>
      <GlyphOrbitControls :drag="true" :wheel="true" />
      <GlyphMesh geometry="cube" color="#4488ff" />
      <GlyphHotspot id="corner" :at="[-0.5, -0.5, 0.5]" @click="onCornerClick">
        <span class="hotspot-label">corner</span>
      </GlyphHotspot>
    </GlyphScene>
  </GlyphPerspectiveCamera>
</template>

<script setup lang="ts">
import {
  GlyphPerspectiveCamera,
  GlyphScene,
  GlyphOrbitControls,
  GlyphMesh,
  GlyphHotspot,
} from "@glyphcss/vue";

function onCornerClick() {
  alert("corner");
}
</script>

<style>
html, body { margin: 0; height: 100%; background: #111; }
.hotspot-label {
  cursor: pointer;
  background: #ff6644;
  color: #fff;
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 12px;
  white-space: nowrap;
}
</style>
