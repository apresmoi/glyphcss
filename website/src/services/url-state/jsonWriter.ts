import { type JsonUrlEnvelope } from "../../utils/url-state/jsonEnvelope";
import { writeUrlParam } from "./history";

/** One state → one query param, debounced and de-duplicated. Every state
 *  change reschedules the timer (so a burst of edits produces one write,
 *  not one per keystroke); a slow `encode()` that resolves after a NEWER
 *  state was already scheduled is discarded rather than clobbering the
 *  newer write; an encode that resolves to the same string already on the
 *  URL never calls `history.replaceState` at all. `onEncoded` fires on
 *  every settled encode (including a skipped write) so a caller can show a
 *  live "link is N KB" readout without re-encoding itself. Uses
 *  `writeUrlParam` (urlState.ts) for the actual write, so it inherits that
 *  function's own WebKit burst-safety limiting on top of this debounce. */
export function createDebouncedJsonUrlWriter<S>(
  envelope: JsonUrlEnvelope<S>,
  param: string,
  delayMs: number,
  onEncoded?: (info: { raw: string; sizeBytes: number }) => void,
): (state: S) => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastWritten: string | null = null;
  let generation = 0;
  return (state: S) => {
    if (typeof window === "undefined") return;
    const generationAtSchedule = ++generation;
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void envelope.encode(state).then((raw) => {
        if (generationAtSchedule !== generation) return; // superseded by a later state change
        onEncoded?.({ raw, sizeBytes: new TextEncoder().encode(raw).length });
        if (raw === lastWritten) return;
        lastWritten = raw;
        writeUrlParam(param, raw || null);
      });
    }, delayMs);
  };
}
