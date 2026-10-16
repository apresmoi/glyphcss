# website — agent guide

Root `AGENTS.md` applies.

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
- `CodePanel` owns every workbench code export: one header with a format dropdown, Copy code, optional CodePen, and Close; no panel footer. Features supply snippets and settings. Copy ASCII/ANSI, SVG and link actions stay in the render footer on every viewport. Unsupported code formats are disabled with a reason; never repeat vanilla code under framework labels. Diagrams and 2D Charts generate HTML/React/Vue integrations directly over their cell renderers, without scene bindings.
- Rails and the right Dock have constrained widths. Content must never enlarge them; use `min-width: 0`, wrapping, or ellipsis for long titles and validation feedback. Desktop controls occupy their own columns; controls switch to drawers at 1100px. Both sidebars use the same horizontal inset.
- Render viewports and their descendants never show scrollbars, including terminal/chat previews. Oversized text previews remain scrollable. Editors, panels, and preset trays use the shared dark scrollbar theme.

## Behavioral contracts

- Fresh `/maps` starts at zero tilt and bearing; shared links retain their saved pose.
- Preserve existing URLs, serialized state versions, dataset identifiers, rendering results, and export contents during UI refactors. URL state is append-only: new fields are optional, malformed fields degrade to absent, and only incompatible reshapes bump a version prefix. Shipped dataset IDs are frozen; renames require an alias map.
- The landing version links to the npm registry's current `latest` release; show an honest package link if unavailable, never a hardcoded fallback version.
- Scenes, animations, listeners, observers, subscriptions, and requests each have one lifecycle owner and cleanup. Lazy demo loading must tolerate unmounts and React StrictMode effect replay.
- Show only render, controls, presets, and exports. Feedback belongs on controls; unavailable controls are dimmed with an accessible reason, not hidden or explained inside the viewport.
- Every glyph `<pre>` uses the render font token (Glyph Mono first), `line-height: 1`. Live `.glyph-output` specificity exceeds glyphcss's injected two-class selector. Chat uses UI monospace to reproduce paste behavior.
- Every glyph emitted by a canvas tier must exist in the Glyph Mono subset (`TargetPreview/glyphMonoCmap.test.ts`).
- Copy ASCII/ANSI reads a separate logical render, never the dense preview grid or preview-only effects.
- Diagrams: 2D; resize changes cells. Library owns wrap/spacing/direction; web expands and pans. Native options in exports; code HTML/TS/React/Vue, source Mermaid/JSON/Git log.
- Charts keeps bindings above choices and compatible columns on type changes. 3D tables expose XYZ and retain metadata. Title once; brief metadata and reasons in tooltips.

- Mermaid: `features/mermaid/data/examples.json` holds showcases, separate from CLI smoke fixtures. Test both. Tiles load source into the rail/readers into the canvas; ledgers stay in the rail. Only flowchart/graph has guided fields; other headers use plain text. Preserve source when browsing JSON. Edits re-render. Chart source is URL-optional; dim native controls while it owns the chart.

## Verification

- `pnpm --filter @glyphcss/website check` audits ownership, imports, runtime cycles, inline presentation, tokens, and formatting. `format` formats; `test:architecture` tests rules with invalid fixtures. No violation baselines or wildcard exemptions.
- During owner changes, run focused behavior/style checks, then `pnpm test && pnpm build`. Preserve every assertion; update moved imports and stylesheet ownership.
- Vitest: 2 workers (avoids starvation), `Europe/Berlin` set before forks (calendar snapshots; runtime uses the caller's zone), one event-loop yield per test (frees happy-dom WeakRef DOM; keep the retention test).
- Browser-check desktop/mobile, keyboard, long content, URL restore, exports, search, cleanup. Await content, never fixed sleeps.
- Astro dev/build must not share active caches. Stop only owned dev before the final standard build; restart afterward.
