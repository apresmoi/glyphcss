import { describe, expect, it } from "vitest";
import { ledgerSequenceLayoutOverflow, ledgerSequenceMarkerDropped, ledgerSequencePaged } from "./ledger";

const SAMPLES = [
  ledgerSequenceLayoutOverflow({ naturalWidth: 90, naturalHeight: 20, requestedWidth: 72, requestedHeight: 24 }),
  ledgerSequencePaged({ panels: 3 }),
  ledgerSequenceMarkerDropped({ kind: "alt", label: "x", reason: "there was no room for it" }),
];

describe("sequence ledger entries read like sentences, not internal logs", () => {
  it("every message starts capitalised, ends with a period, and has no colon or arrow", () => {
    for (const entry of SAMPLES) expect(entry.message).toMatch(/^[A-Z][^:>]*\.$/);
  });
  it("every code is a stable kebab id, namespaced under sequence-", () => {
    for (const entry of SAMPLES) expect(entry.code).toMatch(/^sequence-[a-z0-9-]*$/);
  });
});
