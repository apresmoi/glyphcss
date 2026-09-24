import { describe, expect, it } from "vitest";
import { ledgerLaneCapCollapsed, ledgerLaneLayoutOverflow, ledgerLanePaged } from "./ledger";

const SAMPLES = [
  ledgerLaneLayoutOverflow({ naturalWidth: 20, naturalHeight: 12, requestedWidth: 10, requestedHeight: 12 }),
  ledgerLaneCapCollapsed({ collapsedLanes: 2, nodeIds: ["a", "b"] }),
  ledgerLanePaged({ panels: 3 }),
];

describe("lane ledger entries read like sentences, not internal logs", () => {
  it("every message starts capitalised, ends with a period, and has no colon or arrow", () => {
    for (const entry of SAMPLES) expect(entry.message).toMatch(/^[A-Z][^:>]*\.$/);
  });
  it("every code is a stable kebab id, namespaced under lane-", () => {
    for (const entry of SAMPLES) expect(entry.code).toMatch(/^lane-[a-z0-9-]*$/);
  });
});
