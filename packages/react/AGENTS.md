# @glyphcss/react — agent guide

A thin binding over `@glyphcss/core` and `glyphcss`. General rules are in the root `AGENTS.md`.

## Invariants

- **This package mirrors `@glyphcss/vue`.** Every public component, hook/composable, prop, default and return shape lands in both packages in the same PR. The only allowed differences are idioms (refs vs reactives, `useEffect` vs `watchEffect`).
- A new option on a `glyphcss` factory or scene is exposed here in the same PR. Scene-handle methods need no wrapper.
- Bindings hold no render logic. They forward to `createGlyphScene` and friends.
- Array effect targets are diffed by mesh id set; a changed set remounts the layer. Effect `program`/`colorProgram` are forwarded at creation only.
- `GlyphSceneStatic` mirrors `compileScene`'s full option set (including `objects` and `textureSamplers`) and ships no client runtime.
- `GlyphObject` / `useGlyphObject` mount a `GlyphSceneObject`, with `position`/`rotation`/`scale`.
- `./three` exports `GlyphThreePerspectiveCamera`, `GlyphThreeOrthographicCamera` and `GlyphThreeMesh`.

Contracts behind the props: `packages/glyphcss/AGENTS.md`.
