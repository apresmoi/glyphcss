import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";
import { inflateReferenceFrame, referenceFrameTypedArrayKinds, wireReferenceFrame } from "../src/referenceWire.mjs";

describe("reference browser wire transport", () => {
  it("browser-equivalent decoding preserves exact subview bytes for every control-frame typed-array kind", () => {
    expect(new Uint8Array(new Uint16Array([0x0102]).buffer)).toEqual(new Uint8Array([0x02, 0x01]));
    const frame: Record<string, unknown> = { metadata: { id: "frame" } };
    const expected = new Map<string, Uint8Array>();
    for (const [field, kind] of Object.entries(referenceFrameTypedArrayKinds)) {
      const Constructor = globalThis[kind as keyof typeof globalThis] as unknown as { new(buffer: ArrayBuffer, byteOffset: number, length: number): ArrayBufferView & { readonly length: number }, BYTES_PER_ELEMENT: number };
      const storage = new ArrayBuffer(Constructor.BYTES_PER_ELEMENT * 5);
      const bytes = new Uint8Array(storage);
      bytes.fill(0xa5);
      const view = new Constructor(storage, Constructor.BYTES_PER_ELEMENT, 3);
      const selected = new Uint8Array(storage, Constructor.BYTES_PER_ELEMENT, Constructor.BYTES_PER_ELEMENT * 3);
      for (let index = 0; index < selected.length; index += 1) selected[index] = (index * 37 + field.length) & 0xff;
      if (kind.startsWith("Float")) {
        const values = view as unknown as Float32Array | Float64Array;
        values[0] = -0;
        values[1] = NaN;
      }
      frame[field] = view;
      expected.set(field, selected.slice());
    }
    const wired = wireReferenceFrame(frame);
    const inflated = inflateReferenceFrame(wired);
    expect(inflated.metadata).toEqual({ id: "frame" });
    for (const [field, kind] of Object.entries(referenceFrameTypedArrayKinds)) {
      const wire = wired[field] as { schemaVersion: string, kind: string, byteLength: number, dataBase64: string };
      expect(wire).toMatchObject({ schemaVersion: "glyph-reference-wire-array/v1", kind });
      expect(Buffer.from(wire.dataBase64, "base64")).toEqual(Buffer.from(expected.get(field)!));
      expect((inflated[field] as ArrayBufferView).constructor.name).toBe(kind);
      expect(new Uint8Array((inflated[field] as ArrayBufferView).buffer)).toEqual(expected.get(field));
      if (kind.startsWith("Float")) {
        const values = inflated[field] as Float32Array | Float64Array;
        expect(Object.is(values[0], -0)).toBe(true);
        expect(Number.isNaN(values[1])).toBe(true);
      }
    }
  });

  it("supports zero-length arrays for every kind and fails closed on schema/type drift", () => {
    for (const [field, kind] of Object.entries(referenceFrameTypedArrayKinds)) {
      const Constructor = globalThis[kind as keyof typeof globalThis] as unknown as { new(length: number): ArrayBufferView };
      const inflated = inflateReferenceFrame(wireReferenceFrame({ [field]: new Constructor(0) }));
      expect((inflated[field] as ArrayBufferView).byteLength).toBe(0);
      expect(() => wireReferenceFrame({ [field]: new DataView(new ArrayBuffer(0)) })).toThrow(/REFERENCE_WIRE_TYPED_ARRAY_KIND/);
    }
    expect(() => wireReferenceFrame({ unexpected: new Uint8Array(1) })).toThrow(/REFERENCE_WIRE_UNEXPECTED_BINARY_FIELD/);
    expect(() => wireReferenceFrame({ unexpected: new ArrayBuffer(1) })).toThrow(/REFERENCE_WIRE_UNEXPECTED_BINARY_FIELD/);
    if (typeof SharedArrayBuffer !== "undefined") expect(() => wireReferenceFrame({ unexpected: new SharedArrayBuffer(1) })).toThrow(/REFERENCE_WIRE_UNEXPECTED_BINARY_FIELD/);
    expect(() => wireReferenceFrame({ metadata: { nested: new Uint8Array(1) } })).toThrow(/REFERENCE_WIRE_JSON_VALUE/);
    expect(() => wireReferenceFrame({ metadata: undefined })).toThrow(/REFERENCE_WIRE_JSON_VALUE/);
    const wrongKind = wireReferenceFrame({ depth: new Float64Array(1) });
    (wrongKind.depth as { kind: string }).kind = "Float32Array";
    expect(() => inflateReferenceFrame(wrongKind)).toThrow(/REFERENCE_WIRE_SCHEMA/);
    const wrongLength = wireReferenceFrame({ coverage: new Uint8Array(1) });
    (wrongLength.coverage as { byteLength: number }).byteLength = 2;
    expect(() => inflateReferenceFrame(wrongLength)).toThrow(/REFERENCE_WIRE_BYTE_LENGTH/);
    for (const mutate of [
      (wire: any) => { wire.extra = true; },
      (wire: any) => { delete wire.kind; },
      (wire: any) => { wire.schemaVersion = "glyph-reference-wire-array/v2"; },
      (wire: any) => { wire.byteLength = 1.5; },
      (wire: any) => { wire.dataBase64 = 3; },
    ]) {
      const envelope = wireReferenceFrame({ coverage: new Uint8Array(1) });
      mutate(envelope.coverage);
      expect(() => inflateReferenceFrame(envelope)).toThrow(/REFERENCE_WIRE_SCHEMA/);
    }
    for (const malformed of ["*", "A", "AAA", "====", "AA=A"]) {
      const envelope = wireReferenceFrame({ coverage: new Uint8Array(1) });
      (envelope.coverage as { dataBase64: string }).dataBase64 = malformed;
      expect(() => inflateReferenceFrame(envelope)).toThrow(/REFERENCE_WIRE_BASE64/);
    }
    const misaligned = wireReferenceFrame({ depth: new Float64Array(1) });
    (misaligned.depth as { dataBase64: string, byteLength: number }).dataBase64 = "AA==";
    (misaligned.depth as { byteLength: number }).byteLength = 1;
    expect(() => inflateReferenceFrame(misaligned)).toThrow(/REFERENCE_WIRE_ELEMENT_ALIGNMENT/);
  });
});
