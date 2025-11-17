# VoxCSS examples

These examples are intentionally tiny static pages that pull framework runtimes from CDNs so we can sanity check the built package without cloning extra tooling. Steps:

1. Run `npm install` (first time only) and `npm run build` to refresh `dist/`.
2. Serve the repo root with any static server (`npx serve .`, `python -m http.server`).
3. Visit the example you want under `/examples/*`.

| Path | Notes |
| --- | --- |
| `/examples/react/` | React 18 + VoxCamera/VoxScene rendered via ReactDOM. |
| `/examples/vue/` | Vue 3 composition API sample. |
| `/examples/vue2/` | Legacy Vue 2 render. |
| `/examples/headless/` | Pure DOM/Pointer wiring using `createSceneHost` + `createSceneController`. |
| `/examples/svelte/` | Svelte components require compilation, so see the README in that folder. |

The CDN import maps keep `node_modules/` out of `examples/`, while relying on the locally built VoxCSS bundle (`dist/`).
