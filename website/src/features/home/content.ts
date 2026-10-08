import hljs from "highlight.js/lib/core";
import javascript from "highlight.js/lib/languages/javascript";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";

hljs.registerLanguage("html", xml);
hljs.registerLanguage("xml", xml);
hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("tsx", typescript);
hljs.registerLanguage("vue", xml);

export function highlight(code: string, lang: string): string {
  return hljs.highlight(code, { language: lang }).value;
}

export const title = "glyphcss — turn 3D models into ASCII art (browser, React/Vue & terminal)";
export const description =
  "Render 3D models (OBJ, glTF, GLB, STL, .vox) as ASCII art — in the browser, in React or Vue, or straight in your terminal. A three.js-style API with no WebGL and no canvas: just text in a single <pre>.";
export const siteUrl = "https://glyphcss.com";
export const ogImage = `${siteUrl}/og.png`;

export const frameworkTabs = [
  {
    id: "vanilla",
    label: "vanilla js",
    language: "html",
    code: `<script type="module" src="https://esm.sh/glyphcss/elements"></script>

<glyph-camera rot-x="23" zoom="1.3">
  <glyph-scene>
    <glyph-orbit-controls drag wheel></glyph-orbit-controls>
    <glyph-mesh geometry="dodecahedron">
      <glyph-hotspot at="0,1,0"></glyph-hotspot>
    </glyph-mesh>
  </glyph-scene>
</glyph-camera>`,
  },
  {
    id: "react",
    label: "React",
    language: "tsx",
    code: `import { GlyphCamera, GlyphScene, GlyphOrbitControls, GlyphMesh, GlyphHotspot } from "@glyphcss/react";

export function App() {
  return (
    <GlyphCamera rotX={23} zoom={1.3}>
      <GlyphScene>
        <GlyphOrbitControls drag wheel />
        <GlyphMesh geometry="dodecahedron">
          <GlyphHotspot at={[0, 1.2, 0]} onClick={() => alert("vertex")} />
        </GlyphMesh>
      </GlyphScene>
    </GlyphCamera>
  );
}`,
  },
  {
    id: "vue",
    label: "Vue",
    language: "vue",
    code: `<template>
  <GlyphCamera :rot-x="23" :zoom="1.3">
    <GlyphScene>
      <GlyphOrbitControls drag wheel />
      <GlyphMesh geometry="dodecahedron">
        <GlyphHotspot :at="[0, 1.2, 0]" @click="onVertex" />
      </GlyphMesh>
    </GlyphScene>
  </GlyphCamera>
</template>
<script setup lang="ts">
import { GlyphCamera, GlyphScene, GlyphOrbitControls, GlyphMesh, GlyphHotspot } from "@glyphcss/vue";
function onVertex() { alert("vertex"); }
</script>`,
  },
].map((tab) => ({
  ...tab,
  highlighted: highlight(tab.code, tab.language),
}));

export const installCmds = ["npm install glyphcss", "npm install @glyphcss/react", "npm install @glyphcss/vue"].map(
  (cmd) => ({ code: cmd, highlighted: highlight(cmd, "javascript") }),
);

export const ldJson = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "glyphcss",
  applicationCategory: "DeveloperApplication",
  operatingSystem: "Web, Node.js",
  description,
  url: siteUrl,
  image: ogImage,
  keywords:
    "ASCII art, 3D to ASCII, ASCII renderer, OBJ to ASCII, glTF, GLB, terminal 3D, ASCII art generator, three.js alternative, polycss",
  offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
  sameAs: ["https://github.com/apresmoi/glyphcss"],
  publisher: { "@type": "Organization", name: "glyphcss", url: siteUrl },
};
