import { analyticsHead } from './src/config/analytics.mjs';
import { docsSidebar } from './src/config/docsSidebar.mjs';
import { ogGeneratorRoutes } from './src/config/ogRoutes.mjs';
// @ts-check
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import sitemap from '@astrojs/sitemap';
import react from '@astrojs/react';
import { sitemapLastmod } from './scripts/metadata.mjs';

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
        { find: /^@glyphcss\/fluid\/reader$/, replacement: repoPath('../packages/fluid/src/reader/index.ts') },
        // The worker entry, for `@glyphcss/fluid/worker?worker` (the package's default
        // `new URL("./worker.js")` only exists next to its built dist). The lookahead leaves
        // the `?worker` query on the specifier for Vite's worker plugin.
        { find: /^@glyphcss\/fluid\/worker(?=\?|$)/, replacement: repoPath('../packages/fluid/src/runtime/worker.ts') },
        {
          find: /^@glyphcss\/fluid$/,
          replacement: repoPath('../packages/fluid/src/index.ts'),
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
    ogGeneratorRoutes(),
    react(),
    sitemap({ serialize: (item) => ({ ...item, lastmod: sitemapLastmod(item.url) }) }),
    starlight({
      title: 'glyphcss',
      description: 'Render 3D models, Mermaid diagrams and data charts as ASCII text. Use JavaScript, React, Vue or the CLI for chat, terminal and web output.',
      lastUpdated: true,
      routeMiddleware: './src/integrations/starlight/routeData.ts',
      head: [
        ...(process.env.NODE_ENV === 'production' ? analyticsHead : []),
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
      sidebar: docsSidebar,
    }),
  ],
});
