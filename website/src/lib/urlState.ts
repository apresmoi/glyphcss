// Shared compact URL-state codec for the website's stateful pages (/gallery,
// /synth, /wordart). One page's whole configuration packs into a SINGLE query
// param value: short per-field tokens, length-prefixed strings, base36
// numbers, no key= repeated per field, no base64. Measured on a real /wordart
// state: verbose query 419 chars -> schema-packed 104 chars (4x). Wrapping a
// short packed string in base64url makes it WORSE (139 chars) because base64
// inflates by ~33% and there's nothing left for it to compress — the win is
// entirely in packing the schema, not in how the packed string is encoded.
// See AGENTS.md's "Iterating on the system" — this is new infrastructure, not
// a render-mode change, so it doesn't need an AGENTS.md entry of its own.

// ── Base36 packed numbers (length-prefixed so values concatenate with no
//    separator) ──────────────────────────────────────────────────────────
const BASE36 = 36;

/** Quantize `value` to the nearest multiple of `step` (the field's declared
 *  rounding precision — e.g. 0.1 degree, 1 whole unit, 5-degree buckets).
 *  Works for step < 1 (fractional precision) AND step > 1 (coarse grids like
 *  a 5-degree gradient-angle slider), unlike a plain multiplicative "scale"
 *  which breaks (divide-by-zero-ish rounding) once step > 1. */
function round(value: number, step: number): number {
  // Clean up float noise from `units * step` (e.g. 6 * 0.05 = 0.30000000000000004)
  // so a quantized value compares equal to itself after a round-trip.
  return Number((Math.round(value / step) * step).toPrecision(12));
}

/** Encode a number quantized to `step` as sign + base36 digits of
 *  `round(value, step) / step` (an integer by construction), prefixed by one
 *  base36 char giving the digit string's length. Self-delimiting: callers can
 *  concatenate encoded numbers with no separator between them. */
function encodePackedNumber(value: number, step: number): string {
  const units = Math.round(value / step);
  const encoded = units.toString(BASE36);
  return `${encoded.length.toString(BASE36)}${encoded}`;
}

function decodePackedNumber(
  raw: string,
  index: number,
  step: number,
): { value: number; next: number } | undefined {
  const lengthChar = raw[index];
  if (lengthChar === undefined) return undefined;
  const length = Number.parseInt(lengthChar, BASE36);
  if (!Number.isFinite(length) || length <= 0) return undefined;
  const start = index + 1;
  const end = start + length;
  if (end > raw.length) return undefined;
  const digits = raw.slice(start, end);
  if (!/^-?[0-9a-z]+$/i.test(digits)) return undefined;
  const parsed = Number.parseInt(digits, BASE36);
  if (!Number.isFinite(parsed)) return undefined;
  return { value: Number((parsed * step).toPrecision(12)), next: end };
}

// ── Length-prefixed strings: "<lengthBase36>.<content>" — content can be any
//    unicode text (spaces, tildes, punctuation) with no escaping of its own,
//    since the length prefix removes any need for a content-side separator. ──
function encodePackedString(value: string): string {
  return `${value.length.toString(BASE36)}.${value}`;
}

function decodePackedString(
  raw: string,
  index: number,
): { value: string; next: number } | undefined {
  const dot = raw.indexOf(".", index);
  if (dot < 0) return undefined;
  const lengthDigits = raw.slice(index, dot);
  if (!/^[0-9a-z]+$/i.test(lengthDigits)) return undefined;
  const length = Number.parseInt(lengthDigits, BASE36);
  if (!Number.isFinite(length) || length < 0) return undefined;
  const start = dot + 1;
  const end = start + length;
  if (end > raw.length) return undefined;
  return { value: raw.slice(start, end), next: end };
}

// ── Colors: bare hex packed as 5 base36 chars (0..0xffffff), no "#"/"%23". ──
function encodePackedColor(value: string): string | undefined {
  const hex = value.replace(/^#/, "").toLowerCase();
  if (!/^[0-9a-f]{6}$/.test(hex)) return undefined;
  return Number.parseInt(hex, 16).toString(BASE36).padStart(5, "0");
}

function decodePackedColor(
  raw: string,
  index: number,
): { value: string; next: number } | undefined {
  const chunk = raw.slice(index, index + 5);
  if (!/^[0-9a-z]{5}$/i.test(chunk)) return undefined;
  const parsed = Number.parseInt(chunk, BASE36);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 0xffffff) return undefined;
  return { value: `#${parsed.toString(16).padStart(6, "0")}`, next: index + 5 };
}

// ── Enums: single base36 char = index into a fixed `values` list (<=36
//    options — every enum in this codebase is well under that). ────────────
function encodePackedEnum(value: string, values: readonly string[]): string | undefined {
  const index = values.indexOf(value);
  return index < 0 ? undefined : index.toString(BASE36);
}

function decodePackedEnum<T extends string>(
  raw: string,
  index: number,
  values: readonly T[],
): { value: T; next: number } | undefined {
  const char = raw[index];
  if (char === undefined) return undefined;
  const i = Number.parseInt(char, BASE36);
  const value = values[i];
  return value === undefined ? undefined : { value, next: index + 1 };
}

// ── Bool: single "0"/"1" char. ──────────────────────────────────────────────
function encodePackedBool(value: boolean): string {
  return value ? "1" : "0";
}
function decodePackedBool(raw: string, index: number): { value: boolean; next: number } | undefined {
  const char = raw[index];
  if (char !== "0" && char !== "1") return undefined;
  return { value: char === "1", next: index + 1 };
}

// ── Field schema (page-level, static — every field known up front) ────────

export type UrlFieldKind =
  | { readonly kind: "bool" }
  | { readonly kind: "int" }
  | { readonly kind: "float"; readonly step: number }
  | { readonly kind: "enum"; readonly values: readonly string[] }
  | { readonly kind: "color" }
  | { readonly kind: "string" }
  /** Fixed-length tuple of floats (e.g. a 4-point bezier or a vec3), same
   *  rounding step for every slot. */
  | { readonly kind: "floatTuple"; readonly length: number; readonly step: number }
  /** A number that can also be `false` (e.g. camera perspective distance,
   *  where `false` means "orthographic/disabled"). `false` packs as "n". */
  | { readonly kind: "floatOrFalse"; readonly step: number };

export interface UrlField<S, K extends keyof S = keyof S> {
  readonly key: K;
  /** Single wire char, unique within the schema. a-z/A-Z/0-9 recommended. */
  readonly token: string;
  readonly type: UrlFieldKind;
  readonly default: S[K];
}

function numberStep(type: { kind: "int" } | { kind: "float"; step: number }): number {
  return type.kind === "int" ? 1 : type.step;
}

function sameValue(type: UrlFieldKind, a: unknown, b: unknown): boolean {
  if (type.kind === "int" || type.kind === "float") {
    if (typeof a !== "number" || typeof b !== "number") return a === b;
    const step = numberStep(type);
    return round(a, step) === round(b, step);
  }
  if (type.kind === "floatTuple") {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v, i) => round(v, type.step) === round(b[i], type.step));
  }
  if (type.kind === "color") {
    return typeof a === "string" && typeof b === "string" && a.toLowerCase() === b.toLowerCase();
  }
  if (type.kind === "floatOrFalse") {
    if (a === false || b === false) return a === b;
    if (typeof a !== "number" || typeof b !== "number") return a === b;
    return round(a, type.step) === round(b, type.step);
  }
  return a === b;
}

function encodeFieldValue(type: UrlFieldKind, value: unknown): string | undefined {
  switch (type.kind) {
    case "bool":
      return typeof value === "boolean" ? encodePackedBool(value) : undefined;
    case "int":
    case "float":
      return typeof value === "number" && Number.isFinite(value)
        ? encodePackedNumber(value, numberStep(type))
        : undefined;
    case "floatOrFalse":
      if (value === false) return "n";
      return typeof value === "number" && Number.isFinite(value)
        ? encodePackedNumber(value, type.step)
        : undefined;
    case "floatTuple": {
      if (!Array.isArray(value) || value.length !== type.length) return undefined;
      return value.map((v) => encodePackedNumber(Number(v), type.step)).join("");
    }
    case "enum":
      return typeof value === "string" ? encodePackedEnum(value, type.values) : undefined;
    case "color":
      return typeof value === "string" ? encodePackedColor(value) : undefined;
    case "string":
      return typeof value === "string" ? encodePackedString(value) : undefined;
  }
}

function decodeFieldValue(
  type: UrlFieldKind,
  raw: string,
  index: number,
): { value: unknown; next: number } | undefined {
  switch (type.kind) {
    case "bool":
      return decodePackedBool(raw, index);
    case "int":
    case "float":
      return decodePackedNumber(raw, index, numberStep(type));
    case "floatOrFalse":
      if (raw[index] === "n") return { value: false, next: index + 1 };
      return decodePackedNumber(raw, index, type.step);
    case "floatTuple": {
      const values: number[] = [];
      let cursor = index;
      for (let i = 0; i < type.length; i++) {
        const decoded = decodePackedNumber(raw, cursor, type.step);
        if (!decoded) return undefined;
        values.push(decoded.value);
        cursor = decoded.next;
      }
      return { value: values, next: cursor };
    }
    case "enum":
      return decodePackedEnum(raw, index, type.values);
    case "color":
      return decodePackedColor(raw, index);
    case "string":
      return decodePackedString(raw, index);
  }
}

// ── Deflate fallback (large-state path) ─────────────────────────────────────
// Native CompressionStream/DecompressionStream only — no dependency if
// unavailable. Compression is inherently async (Streams API); to keep initial
// state hydration synchronous, `encodeUrlState` ALWAYS returns a valid packed
// ('p') string immediately, then (above the size threshold, when supported)
// asynchronously swaps the URL for a smaller deflated ('z') one once ready.
// `decodeUrlStateAsync` lets a page catch a 'z' link a moment after the
// synchronous decode (which only understands 'p') sees an empty result.
const LARGE_STATE_THRESHOLD = 400; // ~where deflate-raw + base64url starts to beat raw packing

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

// ── Public codec ─────────────────────────────────────────────────────────

export interface UrlCodec<S> {
  /** Pack non-default fields into `<format><version><tokens>`. Synchronous —
   *  always the 'p' (raw packed) form; see `scheduleCompactedUrlWrite` for the
   *  async deflate upgrade above the size threshold. */
  encode(state: S): string;
  /** Decode a 'p'-format payload synchronously. Returns {} (all defaults) for
   *  garbage, truncated, unknown-version, or 'z'-format input — never throws.
   *  Unknown trailing tokens stop decoding but keep everything parsed so far. */
  decode(raw: string | null | undefined): Partial<S>;
  /** Decode either format, awaiting native decompression for 'z'. Same
   *  never-throws contract as `decode`. Use this once (on mount) to catch a
   *  compressed link `decode` couldn't read synchronously. */
  decodeAsync(raw: string | null | undefined): Promise<Partial<S>>;
  /** If `encode(state)` is above the compaction threshold and
   *  CompressionStream is available, resolves to a smaller 'z'-format string.
   *  Otherwise resolves to the same string `encode` produced. */
  compact(state: S): Promise<string>;
  readonly version: string;
  readonly fields: readonly UrlField<S>[];
}

function assertUniqueTokens<S>(fields: readonly UrlField<S>[]): void {
  const seen = new Set<string>();
  for (const field of fields) {
    if (field.token.length !== 1) {
      throw new Error(`urlState: token "${field.token}" for "${String(field.key)}" must be exactly 1 char`);
    }
    if (seen.has(field.token)) {
      throw new Error(`urlState: duplicate token "${field.token}" in schema`);
    }
    seen.add(field.token);
  }
}

export function createUrlCodec<S extends object>(
  version: string,
  fields: readonly UrlField<S>[],
): UrlCodec<S> {
  assertUniqueTokens(fields);
  const byToken = new Map(fields.map((f) => [f.token, f] as const));

  function encodePacked(state: S): string {
    let tokens = "";
    for (const field of fields) {
      const value = state[field.key];
      if (sameValue(field.type, value, field.default)) continue;
      const encoded = encodeFieldValue(field.type, value);
      if (encoded === undefined) continue;
      tokens += field.token + encoded;
    }
    return `p${version}${tokens}`;
  }

  function decodePacked(raw: string): Partial<S> {
    const out: Partial<S> = {};
    let index = 2; // "p" + version char
    while (index < raw.length) {
      const field = byToken.get(raw[index]!);
      if (!field) break; // unknown token: stop, keep what's parsed, default the rest
      index += 1;
      const decoded = decodeFieldValue(field.type, raw, index);
      if (!decoded) break;
      (out as Record<string, unknown>)[field.key as string] = decoded.value;
      index = decoded.next;
    }
    return out;
  }

  function decode(raw: string | null | undefined): Partial<S> {
    if (!raw || raw.length < 2) return {};
    if (raw[0] === "z") {
      // A real ('z'-tagged) compressed link landed on the SYNCHRONOUS decode
      // path, which by contract only understands 'p' (see `UrlCodec.decode`'s
      // doc) — decompression is inherently async. This is not garbage input;
      // it's a real payload the caller must catch up on via `decodeAsync`, or
      // every param silently reverts to schema defaults with no signal at
      // all (the exact silent-loss failure mode this warning exists to
      // surface — see AGENTS.md-adjacent VOLUMETRIC notes on the /synth URL
      // codec P0).
      console.warn(
        `urlState: received a compressed ('z') URL parameter but decode() only reads the synchronous 'p' format — call decodeAsync() to read it. Falling back to defaults until that resolves.`,
      );
      return {};
    }
    if (raw[0] !== "p") return {};
    if (raw[1] !== version) return {}; // unknown/future version: never throw, just default
    try {
      return decodePacked(raw);
    } catch {
      return {};
    }
  }

  async function decodeAsync(raw: string | null | undefined): Promise<Partial<S>> {
    if (!raw || raw.length < 2) return {};
    if (raw[0] === "p") return decode(raw);
    if (raw[0] !== "z") return {};
    if (raw[1] !== version) {
      console.warn(`urlState: compressed URL parameter is tagged version "${raw[1]}", but this codec only decodes version "${version}" — falling back to defaults.`);
      return {};
    }
    if (!supportsCompressionStreams()) {
      console.warn("urlState: compressed URL parameter present, but this browser has no CompressionStream/DecompressionStream support — falling back to defaults.");
      return {};
    }
    try {
      const inflated = await inflateRaw(raw.slice(2));
      return decodePacked(inflated);
    } catch (error) {
      console.warn("urlState: failed to decompress a 'z'-tagged URL parameter — falling back to defaults.", error);
      return {};
    }
  }

  async function compact(state: S): Promise<string> {
    const packed = encodePacked(state);
    if (packed.length <= LARGE_STATE_THRESHOLD || !supportsCompressionStreams()) return packed;
    try {
      const deflated = await deflateRaw(packed);
      const zForm = `z${version}${deflated}`;
      return zForm.length < packed.length ? zForm : packed;
    } catch {
      return packed;
    }
  }

  return { encode: encodePacked, decode, decodeAsync, compact, version, fields };
}

// ── Generic effect-params codec (shared by gallery/wordart effect-layer
//    overrides AND the synth's own field-synth params — same
//    GlyphEffectParamSchema shape, same packing rules as above) ────────────

export interface EffectParamSpecLike {
  readonly kind: "number" | "string" | "boolean" | "color";
  readonly default: unknown;
  readonly step?: number;
  readonly values?: readonly string[];
}
export type EffectParamSchemaLike = Readonly<Record<string, EffectParamSpecLike>>;

const BASE62 = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

function fromBase62Char(char: string | undefined): number | undefined {
  if (char === undefined) return undefined;
  const index = BASE62.indexOf(char);
  return index < 0 ? undefined : index;
}

// A single BASE62 char only reaches indices 0..61. `fieldSynthSchema` alone
// is past 120 keys (duty/phase/originW/layer/layer*/render/march params all
// landed past that cap across VOLUMETRIC.md's phases), so indices >= 62 need
// a second form. `INDEX_ESCAPE` is a char OUTSIDE the BASE62 alphabet, so it
// can only ever be read as an escape at a fresh token-start position —
// decoding is strictly positional (every value is length-prefixed or
// fixed-width and self-delimiting), so this char can never appear mid-value
// and be misread as a token. An escaped index is 2 BASE62 digits
// (big-endian), covering 0..3843 — comfortably past any schema this codec
// packs. A pre-fix packed string never contains `_` (indices >= 62 were
// silently DROPPED, never encoded — see the `encodeEffectParamsPacked` doc
// below), so every previously shared link decodes through this same path
// unchanged; `synthUrlState.ts`'s version bump is the belt-and-suspenders
// legacy path for the OUTER codec regardless.
const INDEX_ESCAPE = "_";

function encodeTokenIndex(index: number): string {
  if (index < BASE62.length) return BASE62[index]!;
  const hi = Math.floor(index / BASE62.length);
  const lo = index % BASE62.length;
  return `${INDEX_ESCAPE}${BASE62[hi]}${BASE62[lo]}`;
}

function decodeTokenIndex(raw: string, index: number): { value: number; next: number } | undefined {
  const char = raw[index];
  if (char === undefined) return undefined;
  if (char === INDEX_ESCAPE) {
    const hi = fromBase62Char(raw[index + 1]);
    const lo = fromBase62Char(raw[index + 2]);
    if (hi === undefined || lo === undefined) return undefined;
    return { value: hi * BASE62.length + lo, next: index + 3 };
  }
  const i = fromBase62Char(char);
  return i === undefined ? undefined : { value: i, next: index + 1 };
}

function specStep(spec: EffectParamSpecLike): number {
  return spec.step && spec.step > 0 ? spec.step : 0.0001;
}

function encodeSpecValue(spec: EffectParamSpecLike, value: unknown): string | undefined {
  if (spec.kind === "boolean") return typeof value === "boolean" ? encodePackedBool(value) : undefined;
  if (spec.kind === "number") return typeof value === "number" && Number.isFinite(value) ? encodePackedNumber(value, specStep(spec)) : undefined;
  if (spec.kind === "color") return typeof value === "string" ? encodePackedColor(value) : undefined;
  // string: enum-pack against declared `values` when present, else free string.
  if (typeof value !== "string") return undefined;
  if (spec.values) return encodePackedEnum(value, spec.values);
  return encodePackedString(value);
}

function decodeSpecValue(
  spec: EffectParamSpecLike,
  raw: string,
  index: number,
): { value: unknown; next: number } | undefined {
  if (spec.kind === "boolean") return decodePackedBool(raw, index);
  if (spec.kind === "number") return decodePackedNumber(raw, index, specStep(spec));
  if (spec.kind === "color") return decodePackedColor(raw, index);
  if (spec.values) return decodePackedEnum(raw, index, spec.values);
  return decodePackedString(raw, index);
}

function sameSpecValue(spec: EffectParamSpecLike, a: unknown, b: unknown): boolean {
  if (spec.kind === "number" && typeof a === "number" && typeof b === "number") {
    const step = specStep(spec);
    return round(a, step) === round(b, step);
  }
  if (spec.kind === "color" && typeof a === "string" && typeof b === "string") {
    return a.toLowerCase() === b.toLowerCase();
  }
  return a === b;
}

/** Diff `values` against `defaults` and pack the overrides against `schema`,
 *  keyed by each param's position in `Object.keys(schema)` — a single base62
 *  char for indices 0..61, an `INDEX_ESCAPE`-prefixed 2-char form beyond that
 *  (see `encodeTokenIndex`; `fieldSynthSchema` is already past 120 keys, so
 *  this isn't a theoretical case). Returns "" for no overrides. `time`/
 *  `skipKeys` are excluded (animated/derived, not part of a shareable link). */
export function encodeEffectParamsPacked(
  schema: EffectParamSchemaLike,
  defaults: Record<string, unknown>,
  values: Record<string, unknown>,
  skipKeys: readonly string[] = ["time"],
): string {
  const keys = Object.keys(schema);
  let out = "";
  for (const [name, value] of Object.entries(values)) {
    if (skipKeys.includes(name)) continue;
    const spec = schema[name];
    if (!spec) continue;
    if (sameSpecValue(spec, value, defaults[name])) continue;
    const index = keys.indexOf(name);
    if (index < 0) continue;
    const encoded = encodeSpecValue(spec, value);
    if (encoded === undefined) continue;
    out += encodeTokenIndex(index) + encoded;
  }
  return out;
}

/** Inverse of `encodeEffectParamsPacked`. Never throws: an unknown token or
 *  malformed value stops decoding and returns whatever parsed so far. */
export function decodeEffectParamsPacked(
  schema: EffectParamSchemaLike,
  packed: string | undefined,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!packed) return out;
  const keys = Object.keys(schema);
  let index = 0;
  try {
    while (index < packed.length) {
      const token = decodeTokenIndex(packed, index);
      if (!token) break;
      index = token.next;
      const name = keys[token.value];
      const spec = name ? schema[name] : undefined;
      if (!name || !spec) break;
      const decoded = decodeSpecValue(spec, packed, index);
      if (!decoded) break;
      out[name] = decoded.value;
      index = decoded.next;
    }
  } catch {
    return out;
  }
  return out;
}

// ── Single-query-param glue (read/write, replaceState — never pushes a new
//    history entry, matching the existing gallery/synth/wordart behavior) ──

export function readUrlParam(param: string): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get(param);
}

export function writeUrlParam(param: string, value: string | null): void {
  if (typeof window === "undefined") return;
  const params = new URLSearchParams(window.location.search);
  if (value) params.set(param, value);
  else params.delete(param);
  const search = params.toString();
  const next = `${window.location.pathname}${search ? `?${search}` : ""}${window.location.hash}`;
  const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (next !== current) window.history.replaceState(window.history.state, "", next);
}

/** Writes the synchronous packed form immediately, then (only above the size
 *  threshold, only when supported) asynchronously swaps in a smaller deflated
 *  form once ready. Safe to call on every state change — the async upgrade is
 *  a no-op below the threshold. */
export function scheduleCompactedUrlWrite<S extends object>(
  codec: UrlCodec<S>,
  param: string,
  state: S,
): void {
  const packed = codec.encode(state);
  writeUrlParam(param, packed || null);
  if (packed.length <= LARGE_STATE_THRESHOLD) return;
  void codec.compact(state).then((compacted) => {
    if (compacted !== packed && readUrlParam(param) === packed) {
      writeUrlParam(param, compacted || null);
    }
  });
}
