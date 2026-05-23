import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

export default defineConfig({
  plugins: [react()],
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
