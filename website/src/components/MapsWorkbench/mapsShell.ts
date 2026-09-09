/**
 * The page SHELL contract for /maps — the two class strings that decide where
 * this page's chrome actually lands, and why they are not spelled inline.
 *
 * /maps reuses `InstrumentWorkbench`'s shell (the same one /synth mounts) and
 * `GalleryWorkbench`'s `CodePanel`. Both reuses were right; both had a hole
 * that only shows up in a real browser, because happy-dom has no layout:
 *
 * 1. **The code window had no `synth-code-panel` class.** /synth mounts its
 *    own `SynthCodePanel`, which spells `gw-code-panel synth-code-panel`, and
 *    instrument-workbench.css positions the window entirely off that COMPOUND
 *    selector — `bottom: calc(12px + 34px)` (just above the export bar) on
 *    desktop, and the whole mobile bottom-drawer block
 *    (`bottom: var(--mobile-panel-bottom)`, full width, `z-index: 25`).
 *    Gallery's `CodePanel` emits only `gw-code-panel`, so /maps fell through
 *    to gallery-workbench.css's BASE rule, which is written for the gallery's
 *    own shell: `bottom: var(--overlay-bottom)` and a `- 60vh` max-height.
 *    Measured on the built page at 1440x900, that put the window at
 *    `bottom: 158px` and 120px tall — floating in mid-air, detached from the
 *    export bar it belongs to (the reported defect) — and at 390x844 it
 *    opened 322px wide at `bottom: 12px`, straight through the mobile tab bar
 *    instead of resting above it.
 *
 * 2. **The shell reserved 146px of footer that does not exist here.**
 *    `.synth-shell.dn-root` sets `--synth-footer-height: 146px` — the natural
 *    height of /synth's `InstrumentTray` preset strip — and folds it into
 *    `--overlay-bottom` above 760px so the Dock and the lil-gui panel stop
 *    before that strip. /maps mounts NO tray, so those 146px are a phantom:
 *    the Dock ended at y=728 on a 900px viewport with 172px of nothing under
 *    it. `maps-workbench.css` zeroes the variable on `.dn-root.maps-shell`,
 *    which is what {@link MAPS_SHELL_CLASS} exists to put on the root.
 *
 * Pure strings, so the wiring is testable without mounting
 * `MapsWorkbench.tsx` (which this vitest config cannot do) — the geometry
 * itself is only checkable in a real browser, and is recorded above.
 */

/**
 * Extra root class for /maps' `InstrumentShell`, so page-specific shell
 * overrides can be scoped without a third `kind` (every layout rule in
 * instrument-workbench.css is keyed on `:is(.dn-root--synth,
 * .dn-root--generative)`, and /maps genuinely wants all of them).
 */
export const MAPS_SHELL_CLASS = "maps-shell";

/**
 * The class list for /maps' code window.
 *
 * `synth-code-panel` is not decoration: it is the selector half of
 * instrument-workbench.css's `.synth-code-panel.gw-code-panel` override, so
 * dropping it silently returns the window to the gallery's own coordinates
 * (see this module's header).
 */
export function mapsCodePanelClassName(mobilePanel: string | null): string {
  return mobilePanel === "code" ? "synth-code-panel is-mobile-open" : "synth-code-panel";
}
