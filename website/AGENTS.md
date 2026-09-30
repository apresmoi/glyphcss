# website — agent guide

Astro + Starlight documentation and interactive workbenches. Not published. The root `AGENTS.md` applies.

## Ownership and composition

- `src/pages/` holds thin Astro routes. Compose `SiteLayout`, `WorkbenchLayout`, `ExampleLayout`, or `ContentLayout` from `src/layouts/`; page-specific rendering and browser setup belong to components and features.
- `src/components/Name/Name.tsx` is the main component; `index.ts` contains explicit named/type exports for its public surface. Small private children, hooks, types, and helpers stay beside their owner. A complex child gets its own matching folder, main file, and barrel. Import another component owner through its public barrel; never use wildcard exports or old-path compatibility wrappers.
- Components use React. `.astro` files belong only in pages, layouts, and `src/integrations/{astro,starlight}/` adapters. Starlight Search stays in its Astro adapter and is passed to the shared `SiteHeader` as a slot.
- `src/hooks/` contains reusable React lifecycle/measurement hooks. A feature-specific hook stays with that feature or its component. Dock context hooks remain private to Dock.
- `src/utils/` contains pure, reusable transformations; `src/services/` owns shared browser I/O, lifecycle, rendering integration, and exports. Neither imports UI.
- `src/features/<feature>/model/` owns state, types, codecs, and pure transformations. `services/` owns browser and network I/O; `render/`, `export/`, `data/`, and `providers/` exist where needed. Feature code must not import components. Shared controls must not import workbenches or feature catalogs.
- `src/content.config.ts` remains Astro's content-registration entry. `services/glyph-scene/` owns the former demo runtime; components mount and dispose it. There is no `src/lib` or standalone gallery runtime.
- `src/content/docs/**` is public documentation; update it with user-visible package changes.

## Styling and shared UI

- `styles/tokens.css` is the source of UI colors, typography, spacing, and layout dimensions. `global.css` imports only tokens, fonts, base rules, and page layout. Starlight's adapter stylesheet lives under its integration.
- Components own CSS Modules. Scope vendor/runtime selectors beneath the owning module root; Dock owns the lil-gui adapter, StatsOverlay owns stats-js styling, and GlyphScene/GlyphDemo own renderer host styling. Workbenches must not import another workbench's stylesheet.
- Static presentation belongs in CSS. Inline values are allowed for measured geometry, runtime colors/coordinates, CSS variables driven by state, and portable generated export documents.
- Reuse `InstrumentWorkbench` and its body, rail, main, viewport, footer, section heading, mobile tabs, and PresetTray. Reuse `BracketSelect`, `IconToggle`/`ChoiceButton`, `ActionButton`, `SliderRow`/`SliderTrack`, `RangeSlider`, `EditableReadout`, `ColorSwatch`, and `ControlSection`; don't fork their chrome.
- Visible dropdowns use `BracketSelect` on both sides, including lil-gui widgets mounted through Dock portals. Selects hug their current labels. Use the shared bracketed choices for two-option Color encoding; the diagram editor alone owns invisible text-overlay selects.
- `CollapsibleSection` owns the open/closed UI for Synth groups, Charts marks/series, and Gallery categories. Gallery uses its sticky header and count; categories toggle independently, including during search, and clearing search restores the browsing state. List choices use `ChoiceButton`'s start alignment so labels and selection brackets line up. Don't add a second divider around sections or an empty Data heading. Keyboard focus uses cyan/underline, without an outline or filled selection.
- The visual language is monospace ASCII: bracketed choices and dropdowns, cyan selected text, transparent selected backgrounds, and plain divider lines. Presets has one divider with its title inline. Copy/download/export actions stay in the render area's footer. Mobile actions wrap above tabs.
- `CodePanel` owns every workbench code export: one header with a compact format dropdown, Copy code, optional CodePen, and Close; no panel footer. Feature owners supply snippets and optional settings. Copy ASCII/ANSI, SVG and link actions stay in the standalone render footer on desktop and mobile. Unsupported code formats are disabled with a reason; never repeat vanilla code under framework labels. Diagrams and 2D Charts generate HTML/React/Vue integrations directly over their cell renderers, without scene bindings.
- Rails and the right Dock have constrained widths. Content must never enlarge them; use `min-width: 0`, wrapping, or ellipsis for long titles and validation feedback. Desktop controls occupy their own columns; controls switch to drawers at 1100px. Both sidebars use the same horizontal inset.
- Render viewports and their descendants never show scrollbars, including terminal/chat previews. Oversized text previews remain scrollable. Editors, panels, and preset trays use the shared dark scrollbar theme.

## Behavioral contracts

- Fresh `/maps` starts at zero tilt and bearing; shared links retain their saved pose.
- Preserve existing URLs, serialized state versions, dataset identifiers, rendering results, and export contents during UI refactors. URL state is append-only: new fields are optional, malformed fields degrade to absent, and only incompatible reshapes bump a version prefix. Shipped dataset IDs are frozen; renames require an alias map.
- The landing version links to the npm registry's current `latest` release; show an honest package link if unavailable, never a hardcoded fallback version.
- Each mounted scene, animation, listener, observer, subscription, or request has one lifecycle owner and cleanup. Lazy demo loading must tolerate unmounts and React StrictMode effect replay.
- Show only render, controls, presets, and exports. Feedback belongs on controls; unavailable controls are dimmed with an accessible reason, not hidden or explained inside the viewport.
- Every glyph `<pre>` explicitly uses the render font token (Glyph Mono first) and `line-height: 1`. Live `.glyph-output` rules need greater specificity than glyphcss's injected two-class selector. Chat previews deliberately use the UI monospace font to reproduce paste behavior.
- Every glyph emitted by a canvas tier must exist in the Glyph Mono subset (`TargetPreview/glyphMonoCmap.test.ts`).
- Copy ASCII/ANSI reads a separate logical render, never the dense preview grid or preview-only effects.
- Diagrams supports only 2D Graph, Sequence, and Lanes forms. It has no dimension, camera, or scene-effect controls and no 3D presets. Direction uses the shared bracketed choices. Code export offers HTML, TypeScript, React, and Vue; Mermaid, JSON, and Git log belong to the source editor.
- Charts keeps bindings above chart choices and preserves compatible columns on type changes. Table-based 3D charts expose XYZ fields and retain About/source metadata. Show the title once; keep metadata brief with descriptions and disabled reasons in tooltips.

## Verification

- `pnpm --filter @glyphcss/website check` checks ownership, imports, runtime cycles, inline presentation, tokens, and formatting. `format` applies formatting; `test:architecture` verifies the enforcement rules with invalid fixtures. No violation baseline or wildcard exemptions.
- Run focused behavior/style checks while changing owners, then the root-required `pnpm test && pnpm build`. Preserve every assertion; update imports and stylesheet ownership when code moves.
- Verify desktop and mobile rendering, keyboard controls, long content, URL restoration, copy/download exports, docs search, and renderer cleanup in a browser. Settle on component readiness/rendered content rather than fixed sleeps.
- Astro dev and production builds must not share active caches. Stop the owned dev process before the final standard build and restart it afterward; do not kill unrelated processes.
