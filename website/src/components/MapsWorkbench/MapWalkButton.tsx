/**
 * The map's way INTO street level — and, while you are down there, the way
 * back out.
 *
 * ## Why it is here and not in the Dock
 *
 * It shipped as a checkbox in the Dock's View folder and was rejected as
 * one: "that walk shouldn't be a toggle ... it feels stupid as a checkbox".
 * The objection is right and it is the same one the compass answers. Walk is
 * a MODE — the reader leaves the map they are looking at and stands in it —
 * and a mode is not a preference you tick beside a slider. Every map product
 * that ships one puts it ON the map: Google Maps' pegman sits permanently in
 * a corner, greyed where the mode cannot be entered, and is an ICON rather
 * than a word and a tick, because what it offers is a change of place rather
 * than a change of setting.
 *
 * So this is the third of the page's map overlays, built to match the two
 * that were already there — `MapCompass` (top right) and `MapSearchBox` (top
 * centre): `position: absolute` inside `InstrumentMain`, `z-index: 20`,
 * `pointer-events: auto`, covering only its own box so every drag and wheel
 * gesture on the rest of the surface is untouched. It takes the bottom-right
 * corner, which is the one corner nothing else on this page claims
 * (`.synth-export-bar` is bottom left, `.maps-attribution` bottom centre).
 *
 * ## Unlike the compass, it is ALWAYS rendered
 *
 * The compass appears only once the camera is off home, because it is
 * FEEDBACK about a state the reader put the map into. This is an ENTRANCE,
 * and an entrance nobody can find is not one — which was the whole complaint
 * about the Dock row.
 *
 * ## The gate keeps its voice
 *
 * `mapsWalk.ts`'s `mapWalkReason` is unchanged and still owns the words. The
 * page's established idiom for a control the reader cannot use
 * (`mapDirectionLocked`'s Azimuth/Elev rows, `charModeReason`) is dim it and
 * say why ON it, never hide it and never leave it silently inert — so the
 * reason rides the disabled button's `title` and its `aria-label`, verbatim.
 *
 * The gate is about ENTERING, so it is ignored while walking: a walker is
 * inside it by construction, and a gate that went stale under someone's feet
 * must never be able to lock them at eye height.
 */
export interface MapWalkButtonProps {
  /** Whether the walker is live (`map.getWalk() !== null`, mirrored in page state). */
  readonly walking: boolean;
  /** `mapsWalk.ts`' {@link mapWalkReason} — why walk mode cannot be ENTERED, or `null` when it can. */
  readonly reason: string | null;
  /** `mapsWalk.ts`' {@link mapWalkBudgetLabel} — the walker's horizon and what it costs in tiles. */
  readonly budget: string;
  readonly onToggle: (walk: boolean) => void;
}

const ENTER_TITLE =
  "Walk — stand on the ground at eye height (1.7 m) under a real perspective camera. "
  + "Click the map to look around, WASD or the arrow keys to walk, Shift to run, G to walk through walls, Esc to release the mouse. "
  + "Buildings are solid; everything else is not. Leaving puts the view back exactly where it was.";

/**
 * The walker. A pegman in the page's own register: two strokes for the legs
 * mid-stride, one for the leading arm, a head. Drawn rather than set as a
 * glyph because the surface behind it is already made of glyphs, and a
 * character on top of a character grid reads as part of the map.
 */
function WalkerIcon() {
  return (
    <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true" focusable="false">
      <circle cx="8.6" cy="2.6" r="1.8" fill="currentColor" />
      <g fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <path d="M8.4 5.2 L7.4 9.2" />
        <path d="M7.4 9.2 L9.6 12.2 L10.2 14.6" />
        <path d="M7.4 9.2 L5.0 11.6 L4.2 14.4" />
        <path d="M8.2 6.4 L11.4 7.8" />
        <path d="M8.2 6.4 L5.2 7.4" />
      </g>
    </svg>
  );
}

export function MapWalkButton({ walking, reason, budget, onToggle }: MapWalkButtonProps) {
  const gated = !walking && reason !== null;
  const title = walking
    ? `Walking. ${budget}. Click the map to look around, WASD or the arrow keys to walk, Shift to run, G to walk through walls, Esc to release the mouse. Click here to come back up.`
    : gated
      ? reason!
      : ENTER_TITLE;
  return (
    <div className="maps-walk">
      {/* Only while walking: the keys, because the reader has just lost the
          gestures they know and pointer lock hides the cursor that would
          otherwise hint at them — the same legend the parthenon's FPV shows
          in its sidebar, and for the same reason. */}
      {walking && (
        <p className="maps-walk__legend">
          <span><kbd>WASD</kbd> walk</span>
          <span><kbd>Shift</kbd> run</span>
          {/* Buildings are solid while walking, and a reader who ends up
              somewhere they cannot get out of needs a way out that is not
              "leave the mode". Held rather than toggled, like Shift, so the
              legend can state it without the page having to mirror a state. */}
          <span><kbd>G</kbd> ghost</span>
          <span><kbd>click</kbd> look</span>
          <span><kbd>Esc</kbd> release</span>
          {/* The horizon and its tile cost stay on screen, where they were in
              the Dock: it is the one number that says what this mode is
              spending, and it is the reason the horizon is capped well
              inside a 1.7 m eye's real 4.65 km one. */}
          <span className="maps-walk__budget">{budget}</span>
        </p>
      )}
      <button
        type="button"
        className={`maps-walk__toggle${walking ? " is-walking" : ""}`}
        disabled={gated}
        aria-pressed={walking}
        title={title}
        aria-label={walking
          ? "Leave walk mode and go back to the map"
          : gated
            ? `Walk mode is unavailable: ${reason}`
            : "Walk — stand on the ground at eye height"}
        onClick={() => onToggle(!walking)}
      >
        <WalkerIcon />
        <span className="maps-walk__label" aria-hidden="true">{walking ? "Exit" : "Walk"}</span>
      </button>
    </div>
  );
}
