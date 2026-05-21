import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { resolve } from "path";

export default defineConfig({
  plugins: [vue()],
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        "baked-shapes": resolve(__dirname, "baked-shapes/index.html"),
        "solid-mesh": resolve(__dirname, "solid-mesh/index.html"),
        hotspot: resolve(__dirname, "hotspot/index.html"),
      },
    },
  },
});
