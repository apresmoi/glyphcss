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
