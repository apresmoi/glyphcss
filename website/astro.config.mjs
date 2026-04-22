// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://voxcss.com',
  integrations: [
    sitemap(),
    starlight({
      title: 'VoxCSS',
      description: 'A CSS voxel engine. A 3D grid for the DOM.',
      components: {
        ThemeSelect: './src/components/EmptyThemeSelect.astro',
        SiteTitle: './src/components/SiteTitle.astro',
      },
      social: [
        { icon: 'github', label: 'GitHub', href: 'https://github.com/LayoutitStudio/voxcss' },
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
            { label: 'VoxCamera', slug: 'components/vox-camera' },
            { label: 'VoxScene', slug: 'components/vox-scene' },
          ],
        },
        {
          label: 'Guides',
          items: [
            { label: 'Shapes', slug: 'guides/shapes' },
            { label: 'Textures', slug: 'guides/textures' },
            { label: 'Projections', slug: 'guides/projections' },
            { label: 'Performance', slug: 'guides/performance' },
            { label: 'Loading .vox Files', slug: 'guides/vox-files' },
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
