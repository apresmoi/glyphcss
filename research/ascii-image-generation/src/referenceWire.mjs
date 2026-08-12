export const referenceFrameTypedArrayKinds = Object.freeze({
  visibleColor: "Uint32Array",
  semanticColor: "Uint32Array",
  albedoRgb: "Uint32Array",
  targetRgb: "Uint32Array",
  coverage: "Uint8Array",
  winnerPolygon: "Int32Array",
  classId: "Int32Array",
  instanceId: "Int32Array",
  surfaceId: "Int32Array",
  depth: "Float64Array",
  shade: "Float32Array",
  normal: "Float32Array",
  worldPosition: "Float32Array",
  surfaceUv: "Float32Array",
});

const typedArray = (value) => ArrayBuffer.isView(value) && !(value instanceof DataView);
const binary = (value) => value instanceof ArrayBuffer
  || (typeof SharedArrayBuffer !== "undefined" && value instanceof SharedArrayBuffer)
  || ArrayBuffer.isView(value);
const assertJsonSafe = (value, path) => {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError(`REFERENCE_WIRE_JSON_VALUE:${path}`);
    return;
  }
  if (binary(value) || typeof value !== "object") throw new TypeError(`REFERENCE_WIRE_JSON_VALUE:${path}`);
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.prototype.hasOwnProperty.call(value, index)) throw new TypeError(`REFERENCE_WIRE_JSON_VALUE:${path}`);
      assertJsonSafe(value[index], `${path}/${index}`);
    }
    return;
  }
  if (Object.getPrototypeOf(value) !== Object.prototype) throw new TypeError(`REFERENCE_WIRE_JSON_VALUE:${path}`);
  for (const [key, entry] of Object.entries(value)) assertJsonSafe(entry, `${path}/${key}`);
};

export const wireReferenceFrame = (frame) => Object.fromEntries(Object.entries(frame).map(([key, value]) => {
  const expectedKind = referenceFrameTypedArrayKinds[key];
  if (expectedKind === undefined) {
    if (binary(value)) throw new TypeError(`REFERENCE_WIRE_UNEXPECTED_BINARY_FIELD:${key}`);
    assertJsonSafe(value, key);
    return [key, value];
  }
  if (!typedArray(value) || value.constructor.name !== expectedKind) throw new TypeError(`REFERENCE_WIRE_TYPED_ARRAY_KIND:${key}:${expectedKind}`);
  return [key, {
    schemaVersion: "glyph-reference-wire-array/v1",
    kind: expectedKind,
    byteLength: value.byteLength,
    dataBase64: Buffer.from(value.buffer, value.byteOffset, value.byteLength).toString("base64"),
  }];
}));

export const inflateReferenceFrame = (frame, decodeBase64 = (value) => {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) throw new TypeError("REFERENCE_WIRE_BASE64");
  const text = atob(value);
  const bytes = new Uint8Array(text.length);
  for (let index = 0; index < text.length; index += 1) bytes[index] = text.charCodeAt(index);
  return bytes.buffer;
}) => Object.fromEntries(Object.entries(frame).map(([key, value]) => {
  const expectedKind = referenceFrameTypedArrayKinds[key];
  if (expectedKind === undefined) {
    assertJsonSafe(value, key);
    return [key, value];
  }
  if (value === null || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype || Object.keys(value).sort().join(",") !== "byteLength,dataBase64,kind,schemaVersion" || value.schemaVersion !== "glyph-reference-wire-array/v1" || value.kind !== expectedKind || !Number.isSafeInteger(value.byteLength) || value.byteLength < 0 || typeof value.dataBase64 !== "string") {
    throw new TypeError(`REFERENCE_WIRE_SCHEMA:${key}`);
  }
  const buffer = decodeBase64(value.dataBase64);
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength !== value.byteLength) throw new TypeError(`REFERENCE_WIRE_BYTE_LENGTH:${key}`);
  const Constructor = globalThis[expectedKind];
  if (buffer.byteLength % Constructor.BYTES_PER_ELEMENT !== 0) throw new TypeError(`REFERENCE_WIRE_ELEMENT_ALIGNMENT:${key}`);
  return [key, new Constructor(buffer)];
}));
