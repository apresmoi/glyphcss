// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import sitemap from '@astrojs/sitemap';
import react from '@astrojs/react';

export default defineConfig({
  site: 'https://polycss.com',
  integrations: [
    react(),
    sitemap(),
    starlight({
      title: 'Polycss',
      description: 'A CSS polygon mesh engine. DOM-native 3D rendering.',
      components: {
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
            { label: 'PolyCamera', slug: 'components/vox-camera' },
            { label: 'PolyScene', slug: 'components/vox-scene' },
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
