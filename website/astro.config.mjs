import { analyticsHead } from './src/config/analytics.mjs';
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
  redirects: {
    '/guides/diagrams/': '/diagrams/overview/',
  },
  devToolbar: { enabled: false },
  vite: {
    resolve: {
      dedupe: ['react', 'react-dom'],
      alias: [
        { find: /^@glyphcss\/diagrams\/sequence$/, replacement: repoPath('../packages/diagrams/src/sequence/index.ts') },
        { find: /^@glyphcss\/diagrams\/lanes$/, replacement: repoPath('../packages/diagrams/src/lanes/index.ts') },
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
          find: /^@glyphcss\/charts$/,
          replacement: repoPath('../packages/charts/src/index.ts'),
        },
        {
          find: /^@glyphcss\/diagrams$/,
          replacement: repoPath('../packages/diagrams/src/index.ts'),
        },
        {
          find: /^@glyphcss\/vue$/,
          replacement: repoPath('../packages/vue/src/index.ts'),
        },
        {
          // Root entry only — `@glyphcss/maps/node` is fs-backed and never
          // reaches the browser bundle.
          find: /^@glyphcss\/maps$/,
          replacement: repoPath('../packages/maps/src/index.ts'),
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
        ...(process.env.NODE_ENV === 'production' ? analyticsHead : []),
        // Social preview image for docs pages (Starlight emits og:title/description/url itself).
        { tag: 'meta', attrs: { property: 'og:image', content: 'https://glyphcss.com/og.png' } },
        { tag: 'meta', attrs: { name: 'twitter:image', content: 'https://glyphcss.com/og.png' } },
        { tag: 'meta', attrs: { name: 'twitter:card', content: 'summary_large_image' } },
      ],
      components: {
        Header: './src/integrations/starlight/Header.astro',
        ThemeSelect: './src/integrations/starlight/ThemeSelect.astro',
        ThemeProvider: './src/integrations/starlight/ThemeProvider.astro',
        SiteTitle: './src/integrations/starlight/SiteTitle.astro',
      },
      social: [
        { icon: 'github', label: 'GitHub', href: 'https://github.com/apresmoi/glyphcss' },
      ],
      customCss: ['./src/integrations/starlight/starlight.css'],
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
            { label: 'Color Encoding', slug: 'guides/color-encoding' },
            { label: 'Render Modes', slug: 'guides/render-modes' },
            { label: 'Density & Detail', slug: 'guides/density' },
            { label: 'Glyph Effects', slug: 'guides/effects' },
            { label: 'Compiling to Static', slug: 'guides/compile' },
          ],
        },
        {
          label: 'Diagrams',
          items: [
            { label: 'Overview', slug: 'diagrams/overview' },
            { label: 'Flowcharts', slug: 'diagrams/flowcharts' },
            { label: 'Sequence diagrams', slug: 'diagrams/sequence' },
            { label: 'State diagrams', slug: 'diagrams/state' },
            { label: 'Class diagrams', slug: 'diagrams/class' },
            { label: 'Entity relationships', slug: 'diagrams/er' },
            { label: 'Mindmaps', slug: 'diagrams/mindmap' },
            { label: 'Git history & lanes', slug: 'diagrams/gitgraph' },
            { label: 'Block diagrams', slug: 'diagrams/block' },
            { label: 'Architecture diagrams', slug: 'diagrams/architecture' },
            { label: 'Requirements', slug: 'diagrams/requirements' },
            { label: 'C4 diagrams', slug: 'diagrams/c4' },
            { label: 'Options & sizing', slug: 'diagrams/options' },
            { label: 'Node shapes', slug: 'diagrams/shapes' },
            { label: 'CLI', slug: 'diagrams/cli' },
            { label: 'JSON & schema', slug: 'diagrams/json' },
            { label: 'Vanilla, React & Vue', slug: 'diagrams/frameworks' },
            { label: 'Troubleshooting', slug: 'diagrams/troubleshooting' },
            { label: 'Comparison', slug: 'diagrams/comparison' },
          ],
        },
        {
          label: 'Charts',
          items: [
            { label: 'Overview', slug: 'charts/overview' },
            { label: 'Spec reference', slug: 'charts/spec' },
            { label: 'Line & area', slug: 'charts/line-area' },
            { label: 'Bar charts', slug: 'charts/bar' },
            { label: 'Scatter plots', slug: 'charts/scatter' },
            { label: 'Pie & donut', slug: 'charts/arc' },
            { label: 'Heatmaps', slug: 'charts/cell' },
            { label: 'Text & rule annotations', slug: 'charts/annotations' },
            { label: 'Sankey flows', slug: 'charts/sankey' },
            { label: 'Funnels', slug: 'charts/funnel' },
            { label: 'Treemaps', slug: 'charts/treemap' },
            { label: 'Mermaid charts', slug: 'charts/mermaid' },
            { label: 'Gantt, journey & timeline', slug: 'charts/mermaid-schedules' },
            { label: 'Packet & kanban', slug: 'charts/mermaid-structures' },
            { label: 'Charsets, color & targets', slug: 'charts/targets' },
            { label: '3D charts', slug: 'charts/3d' },
            { label: 'CLI', slug: 'charts/cli' },
            { label: 'Vanilla, React & Vue', slug: 'charts/frameworks' },
            { label: 'Troubleshooting', slug: 'charts/troubleshooting' },
          ],
        },
        {
          label: 'Coding agents',
          items: [
            { label: 'Overview', slug: 'guides/coding-agents' },
            { label: 'Install by host', slug: 'coding-agents/install' },
          ],
        },
        {
          label: 'Maps',
          items: [
            { label: 'Overview', slug: 'maps/overview' },
            { label: 'Projections', slug: 'maps/projections' },
            { label: 'Layers', slug: 'maps/layers' },
            { label: 'Camera & Navigation', slug: 'maps/camera' },
            { label: 'Terrain', slug: 'maps/terrain' },
            { label: 'OpenStreetMap', slug: 'maps/openstreetmap' },
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
