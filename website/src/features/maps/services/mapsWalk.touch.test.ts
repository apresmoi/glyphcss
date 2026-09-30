import { describe, expect, it } from "vitest";

import { mapWalkAvailable, mapWalkInputReason, mapWalkLinkEntry, mapWalkReason } from "./mapsWalk";

/**
 * Walk mode's ACTUAL inputs, read off the widget rather than assumed:
 * `widget.ts` moves the walker from `keydown`/`keyup` (`w`/`a`/`s`/`d`, the
 * arrow keys, `Shift`, `g`) and turns the head from `mousemove` deltas
 * delivered under `requestPointerLock`, released with `Esc`
 * (`widget.walk.test.ts`, `widget.walkCollision.test.ts`,
 * `widget.walkLook.test.ts`). A touch device has neither: iOS Safari does not
 * implement the Pointer Lock API at all, and a phone has no keyboard to send
 * those keys from.
 *
 * So the honest answer is that the mode cannot be DRIVEN there, and the
 * page's established idiom for that is the one `mapWalkReason` already
 * embodies: dim the control and say why on it, never hide it and never leave
 * it silently inert. This adds the clause; it does not add touch controls,
 * which would be a real feature rather than a gate.
 */
const GLOBE_AT_STREET = { projectionId: "globe", span: 0.004 } as const;

describe("walk is gated on a device that cannot drive it", () => {
  it("is available on the globe at street scale with a keyboard and pointer lock", () => {
    expect(mapWalkReason({ ...GLOBE_AT_STREET, input: { coarsePointer: false, pointerLock: true } })).toBeNull();
    expect(mapWalkAvailable({ ...GLOBE_AT_STREET, input: { coarsePointer: false, pointerLock: true } })).toBe(true);
  });

  it("is refused on a coarse-pointer device even where every other gate passes", () => {
    const reason = mapWalkReason({ ...GLOBE_AT_STREET, input: { coarsePointer: true, pointerLock: true } });
    expect(reason).not.toBeNull();
    expect(reason).toMatch(/keyboard/i);
  });

  it("is refused where the browser has no Pointer Lock API", () => {
    const reason = mapWalkReason({ ...GLOBE_AT_STREET, input: { coarsePointer: false, pointerLock: false } });
    expect(reason).not.toBeNull();
    expect(reason).toMatch(/mouse|pointer/i);
  });

  // Ordering matters: telling a phone reader to "zoom in to about 400 m" is a
  // lie, because zooming in will not make the mode enterable. The clause the
  // reader cannot act on has to come first, so it is the one they are told.
  it("names the device before it names the view or the projection", () => {
    const reason = mapWalkReason({
      projectionId: "mercator",
      span: 90,
      input: { coarsePointer: true, pointerLock: false },
    });
    expect(reason).toMatch(/keyboard/i);
    expect(reason).not.toMatch(/globe/i);
  });

  // Backwards-compatible on purpose: every other caller of this gate
  // (`mapWalkLinkEntry`, the URL-state tests) passes no `input` and must keep
  // the verdict it had.
  it("assumes a drivable device when the caller says nothing", () => {
    expect(mapWalkReason(GLOBE_AT_STREET)).toBeNull();
    expect(mapWalkLinkEntry({ walk: true, projectionId: "globe", span: 0.004, tilt: 90 }).walking).toBe(true);
  });
});

describe("mapWalkInputReason reads the environment", () => {
  it("passes a desktop browser", () => {
    expect(mapWalkInputReason({ coarsePointer: false, pointerLock: true })).toBeNull();
  });
  it("fails a touch phone", () => {
    expect(mapWalkInputReason({ coarsePointer: true, pointerLock: false })).not.toBeNull();
  });
});
