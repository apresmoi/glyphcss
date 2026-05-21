<template>
  <div class="scene-host">
    <GlyphPerspectiveCamera :rot-x="0.5" :rot-y="0.4" :zoom="0.4" :distance="100">
      <GlyphOrbitControls :drag="true" :wheel="true" />
      <GlyphScene>
        <GlyphMesh geometry="cube" color="#4488ff" />
        <GlyphHotspot id="corner" :at="[1, 1, 1]" @click="onCornerClick">
          <span class="hotspot-label">corner</span>
        </GlyphHotspot>
      </GlyphScene>
    </GlyphPerspectiveCamera>
  </div>
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
.scene-host { width: 100%; height: 100vh; }
.scene-host .glyphcss-camera { width: 100%; height: 100%; }
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
