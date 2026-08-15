// @ts-check
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import sitemap from '@astrojs/sitemap';
import react from '@astrojs/react';

/** @param {string} path */
const repoPath = (path) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  site: 'https://glyphcss.com',
  devToolbar: { enabled: false },
  vite: {
    resolve: {
      dedupe: ['react', 'react-dom'],
      alias: [
        {
          find: /^@glyphcss\/core$/,
          replacement: repoPath('../packages/core/src/index.ts'),
        },
        {
          find: /^@glyphcss\/react$/,
          replacement: repoPath('../packages/react/src/index.ts'),
        },
        {
          find: /^@glyphcss\/effects$/,
          replacement: repoPath('../packages/effects/src/index.ts'),
        },
        {
          find: /^@glyphcss\/vue$/,
          replacement: repoPath('../packages/vue/src/index.ts'),
        },
        {
          find: /^glyphcss\/elements$/,
          replacement: repoPath('../packages/glyphcss/src/elements/index.ts'),
        },
        {
          find: /^glyphcss$/,
          replacement: repoPath('../packages/glyphcss/src/index.ts'),
        },
      ],
    },
  },
  integrations: [
    react(),
    sitemap(),
    starlight({
      title: 'glyphcss',
      description: 'Render 3D models (OBJ, glTF, GLB, STL, .vox) as ASCII art — in the browser, React/Vue, or your terminal. A three.js-style API with no WebGL.',
      head: [
        // Google Analytics (gtag.js) — covers all Starlight docs pages; custom
        // pages render the same tag via src/components/Analytics.astro.
        ...(process.env.NODE_ENV === 'production' ? [
          { tag: 'script', attrs: { async: true, src: 'https://www.googletagmanager.com/gtag/js?id=G-PHHY1R5B58' } },
          { tag: 'script', content: "window.dataLayer = window.dataLayer || [];\nfunction gtag(){dataLayer.push(arguments);}\ngtag('js', new Date());\ngtag('config', 'G-PHHY1R5B58');" },
        ] : []),
        // Social preview image for docs pages (Starlight emits og:title/description/url itself).
        { tag: 'meta', attrs: { property: 'og:image', content: 'https://glyphcss.com/og.png' } },
        { tag: 'meta', attrs: { name: 'twitter:image', content: 'https://glyphcss.com/og.png' } },
        { tag: 'meta', attrs: { name: 'twitter:card', content: 'summary_large_image' } },
      ],
      components: {
        Header: './src/components/DocsHeader.astro',
        ThemeSelect: './src/components/EmptyThemeSelect.astro',
        SiteTitle: './src/components/SiteTitle.astro',
      },
      social: [
        { icon: 'github', label: 'GitHub', href: 'https://github.com/apresmoi/glyphcss' },
      ],
      customCss: ['./src/styles/custom.css'],
      sidebar: [
        {
          label: 'Getting Started',
          items: [
            { label: 'Introduction', slug: 'introduction' },
            { label: 'Quickstart', slug: 'quickstart' },
            { label: 'Core Concepts', slug: 'core-concepts' },
          ],
        },
        {
          label: 'Components',
          items: [
            { label: 'GlyphScene', slug: 'components/glyph-scene' },
            { label: 'Cameras', slug: 'components/glyph-camera' },
            { label: 'Controls', slug: 'components/glyph-controls' },
            { label: 'GlyphHotspot', slug: 'components/glyph-hotspot' },
          ],
        },
        {
          label: 'Guides',
          items: [
            { label: 'Loading Meshes', slug: 'guides/meshes' },
            { label: 'Creating Shapes', slug: 'guides/creating-shapes' },
            { label: 'Hit Layer Interactivity', slug: 'guides/hit-layer' },
            { label: 'Performance', slug: 'guides/performance' },
            { label: 'Render Modes', slug: 'guides/render-modes' },
            { label: 'Density & Detail', slug: 'guides/density' },
            { label: 'Glyph Effects', slug: 'guides/effects' },
            { label: 'Compiling to Static', slug: 'guides/compile' },
            { label: 'Coding agents', slug: 'guides/coding-agents' },
          ],
        },
        {
          label: 'API Reference',
          items: [
            { label: 'React API', slug: 'api/react' },
            { label: 'Vue API', slug: 'api/vue' },
            { label: 'HTML API', slug: 'api/html' },
            { label: 'Headless API', slug: 'api/headless' },
            { label: 'Three.js Parity API', slug: 'api/three-parity' },
            { label: 'Core Types', slug: 'api/types' },
          ],
        },
      ],
    }),
  ],
});
