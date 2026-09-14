// Shared JSON+deflate single-query-param envelope for a page whose state is
// an open-ended TREE (an arbitrary number of marks/nodes/edges, each an
// arbitrary record) rather than urlState.ts's flat, statically-known field
// set. `createUrlCodec` there packs a fixed schema into short per-field
// base36 tokens; that packer has no way to express "N marks, each with its
// own channels/options" without inventing a second schema layer on top of
// the first, so /charts and /diagrams instead pack their WHOLE state as one
// JSON blob (see chartsUrlState.ts / diagramsUrlState.ts).
//
// Wire format: "<version>.<base64url(deflate-raw(JSON))>" (compressed,
// preferred) or "<version>j.<base64url(JSON)>" (plain-JSON fallback, used
// only when this browser has no CompressionStream/DecompressionStream — old
// Safari; Node >= 18 and every current browser other than that has both).
// Unlike urlState.ts's synchronous packed form, BOTH encode and decode here
// are async: decompression is inherently Streams-API-based. A caller that
// needs to avoid ever rendering the wrong (default) state gates its first
// paint on `decode()` when a param is present, and skips the gate entirely
// when it's absent (the default IS correct then, synchronously) — see
// chartsUrlState.ts's doc for why that split means "read on mount" never
// flashes a default over a real shared link despite the async decode.
//
// An unknown version prefix, truncated payload, corrupt base64, or a
// decompressed/parsed value the caller's own `validate` rejects all decode
// to `null` — never throw, matching every other codec in this file's family.

import { writeUrlParam } from "./urlState";

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function fromBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const withPad = padded + "=".repeat((4 - (padded.length % 4)) % 4);
  const binary = atob(withPad);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
function supportsCompressionStreams(): boolean {
  return typeof CompressionStream !== "undefined" && typeof DecompressionStream !== "undefined";
}
async function deflateRaw(text: string): Promise<string> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream("deflate-raw"));
  const buffer = await new Response(stream).arrayBuffer();
  return toBase64Url(new Uint8Array(buffer));
}
async function inflateRaw(packed: string): Promise<string> {
  const bytes = fromBase64Url(packed);
  const stream = new Blob([bytes.buffer as ArrayBuffer]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Response(stream).text();
}

export interface JsonUrlEnvelope<S> {
  /** Always the compressed ('<version>.') form when supported, else the
   *  plain-JSON ('<version>j.') fallback. Never throws. */
  encode(state: S): Promise<string>;
  /** `null` for an absent param, an unrecognized prefix, a payload that
   *  fails to decompress/parse, or one `validate` rejects. Never throws. */
  decode(raw: string | null | undefined): Promise<S | null>;
  readonly version: string;
}

/** `validate` re-checks every field's shape and enum membership (a decoded
 *  JSON value is untrusted input, same as any other URL parameter) and
 *  returns `null` for anything it doesn't fully recognize — the codec never
 *  passes a partially-trusted object through. */
export function createJsonUrlEnvelope<S>(version: string, validate: (value: unknown) => S | null): JsonUrlEnvelope<S> {
  const deflatedPrefix = `${version}.`;
  const jsonPrefix = `${version}j.`;

  async function encode(state: S): Promise<string> {
    const json = JSON.stringify(state);
    if (supportsCompressionStreams()) {
      try {
        return `${deflatedPrefix}${await deflateRaw(json)}`;
      } catch {
        // Fall through to the plain-JSON form below — a real browser
        // reporting support but failing mid-stream is not expected, but
        // this must still produce a link rather than throw.
      }
    }
    return `${jsonPrefix}${toBase64Url(new TextEncoder().encode(json))}`;
  }

  async function decode(raw: string | null | undefined): Promise<S | null> {
    if (!raw) return null;
    try {
      if (raw.startsWith(jsonPrefix)) {
        const json = new TextDecoder().decode(fromBase64Url(raw.slice(jsonPrefix.length)));
        return validate(JSON.parse(json));
      }
      if (raw.startsWith(deflatedPrefix)) {
        if (!supportsCompressionStreams()) return null;
        const json = await inflateRaw(raw.slice(deflatedPrefix.length));
        return validate(JSON.parse(json));
      }
    } catch {
      return null;
    }
    return null;
  }

  return { encode, decode, version };
}

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
