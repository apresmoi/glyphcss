import { describe, expect, it } from "vitest";
import { GLYPH_SEQUENCE_VALIDATION_RULES, glyphSequenceRepairHint, validateGlyphSequence } from "./validate";

const valid = {
  participants: [{ id: "a", label: "A" }, { id: "b", label: "B" }],
  messages: [{ from: "a", to: "b" }],
};

export const glyphSequenceBadFixtures: readonly { id: string; value: unknown }[] = [
  { id: "bad-sequence", value: { ...valid, surprise: true } },
  { id: "empty-participants", value: { ...valid, participants: [] } },
  { id: "bad-participant", value: { ...valid, participants: [{ id: " ", label: "bad" }] } },
  { id: "bad-participant", value: { ...valid, participants: [{ id: "a", label: "A", shape: "triangle" }] } },
  { id: "duplicate-participant-id", value: { ...valid, participants: [...valid.participants, { id: "a", label: "Again" }] } },
  { id: "bad-message", value: { ...valid, messages: [{ from: "a", to: "b", style: "wavy" }] } },
  { id: "duplicate-message-id", value: { ...valid, messages: [{ id: "m", from: "a", to: "b" }, { id: "m", from: "b", to: "a" }] } },
  { id: "unknown-participant", value: { ...valid, messages: [{ from: "a", to: "ghost" }] } },
  { id: "bad-frame", value: { ...valid, frames: [{ kind: "alt", from: -1, to: 0 }] } },
  { id: "bad-frame-range", value: { ...valid, frames: [{ kind: "alt", from: 0, to: 5 }] } },
  { id: "bad-frame-range", value: { ...valid, frames: [{ kind: "alt", from: 1, to: 0 }] } },
  { id: "bad-note", value: { ...valid, notes: [{ text: "n", over: [], at: 0 }] } },
  { id: "unknown-participant", value: { ...valid, notes: [{ text: "n", over: ["ghost"], at: 0 }] } },
  { id: "bad-note-range", value: { ...valid, notes: [{ text: "n", over: ["a"], at: 5 }] } },
];

describe("GlyphSequence validation", () => {
  it("returns owned arrays without changing the input", () => {
    const input = { ...valid, frames: [{ kind: "alt", label: "x", from: 0, to: 0 }], notes: [{ text: "n", over: ["a"], at: 0 }] };
    const sequence = validateGlyphSequence(input);
    expect(sequence.participants).not.toBe(input.participants);
    expect(sequence.participants[0]).not.toBe(input.participants[0]);
    expect(sequence.messages).not.toBe(input.messages);
    expect(sequence.notes?.[0]?.over).not.toBe(input.notes[0]!.over);
  });

  it.each(glyphSequenceBadFixtures)("rejects $id with a table rule and repair hint", ({ id, value }) => {
    expect(GLYPH_SEQUENCE_VALIDATION_RULES).toContain(id);
    expect(() => validateGlyphSequence(value)).toThrow(expect.objectContaining({ code: id }));
    expect(glyphSequenceRepairHint(id)).toBeTruthy();
  });

  it("allows self-messages, no frames, no notes, and a zero-message sequence", () => {
    expect(validateGlyphSequence({ participants: valid.participants, messages: [{ from: "a", to: "a" }] })).toBeTruthy();
    expect(validateGlyphSequence({ participants: valid.participants, messages: [] })).toBeTruthy();
  });

  it("carries no domain vocabulary in the IR: kind is an open string, never a closed HTTP/RPC enum", () => {
    // Any string is a valid participant.kind — the whole point of leaving it
    // open. A caller modelling threads, teams, or protocol peers must not
    // need a service-call vocabulary to pass validation.
    const sequence = validateGlyphSequence({
      participants: [{ id: "a", label: "A", kind: "hardware-component" }, { id: "b", label: "B", kind: "os-thread" }],
      messages: [{ from: "a", to: "b" }],
    });
    expect(sequence.participants[0]!.kind).toBe("hardware-component");
  });

  it("gives every validation rule id its own repair hint, not the generic fallback", () => {
    const fallback = glyphSequenceRepairHint("not-a-real-rule-id");
    for (const id of GLYPH_SEQUENCE_VALIDATION_RULES) {
      // Mutation: delete a rule's REPAIR_HINTS entry -> its hint falls back to
      // the generic message and this goes red instead of merely being truthy.
      expect(glyphSequenceRepairHint(id)).not.toBe(fallback);
    }
  });
});
