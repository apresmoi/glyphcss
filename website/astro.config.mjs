// @ts-check
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import sitemap from '@astrojs/sitemap';
import react from '@astrojs/react';

/** @param {string} path */
const repoPath = (path) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  site: 'https://polycss.com',
  vite: {
    resolve: {
      dedupe: ['react', 'react-dom'],
      alias: [
        {
          find: /^@polycss\/core$/,
          replacement: repoPath('../packages/core/src/index.ts'),
        },
        {
          find: /^@polycss\/react$/,
          replacement: repoPath('../packages/react/src/index.ts'),
        },
        {
          find: /^@polycss\/vue$/,
          replacement: repoPath('../packages/vue/src/index.ts'),
        },
        {
          find: /^@layoutit\/polycss\/elements$/,
          replacement: repoPath('../packages/polycss/src/elements/index.ts'),
        },
        {
          find: /^@layoutit\/polycss$/,
          replacement: repoPath('../packages/polycss/src/index.ts'),
        },
      ],
    },
  },
  integrations: [
    react(),
    sitemap(),
    starlight({
      title: 'Polycss',
      description: 'A CSS polygon mesh engine. DOM-native 3D rendering.',
      components: {
        Header: './src/components/DocsHeader.astro',
        ThemeSelect: './src/components/EmptyThemeSelect.astro',
        SiteTitle: './src/components/SiteTitle.astro',
      },
      social: [
        { icon: 'github', label: 'GitHub', href: 'https://github.com/LayoutitStudio/polycss' },
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
            { label: 'PolyScene', slug: 'components/poly-scene' },
            { label: 'PolyCamera', slug: 'components/poly-camera' },
            { label: 'PolyOrbitControls / PolyMapControls', slug: 'components/poly-controls' },
          ],
        },
        {
          label: 'Guides',
          items: [
            { label: 'Loading Meshes', slug: 'guides/textures' },
            { label: 'Per-polygon Interaction', slug: 'guides/shapes' },
            { label: 'Performance', slug: 'guides/performance' },
            { label: 'Projections', slug: 'guides/projections' },
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
