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
      description: 'An ASCII polygon mesh engine. DOM-native 3D rendering in a character grid.',
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
            { label: 'GlyphCamera', slug: 'components/glyph-camera' },
            { label: 'GlyphOrbitControls', slug: 'components/glyph-controls' },
            { label: 'GlyphHotspot', slug: 'components/glyph-hotspot' },
          ],
        },
        {
          label: 'Guides',
          items: [
            { label: 'Loading Meshes', slug: 'guides/meshes' },
            { label: 'Hit Layer Interactivity', slug: 'guides/hit-layer' },
            { label: 'Performance', slug: 'guides/performance' },
            { label: 'Render Modes', slug: 'guides/render-modes' },
          ],
        },
        {
          label: 'API Reference',
          items: [
            { label: 'Headless API', slug: 'api/headless' },
            { label: 'Core Types', slug: 'api/types' },
          ],
        },
      ],
    }),
  ],
});
