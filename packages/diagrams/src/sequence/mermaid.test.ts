import { describe, expect, it } from "vitest";
import { glyphSequenceFromMermaid } from "./mermaid";

describe("glyphSequenceFromMermaid", () => {
  it("parses explicit and implicit participants, actor shape, and solid/dashed styles", () => {
    const sequence = glyphSequenceFromMermaid(`sequenceDiagram
    actor U as User
    participant S as Server
    U->>S: request
    S-->>U: response`);
    expect(sequence.participants).toEqual([{ id: "U", label: "User", shape: "actor" }, { id: "S", label: "Server" }]);
    expect(sequence.messages).toEqual([
      { from: "U", to: "S", label: "request", style: "solid" },
      { from: "S", to: "U", label: "response", style: "dashed" },
    ]);
  });

  it("auto-adds a participant on first reference, in order of appearance", () => {
    const sequence = glyphSequenceFromMermaid(`sequenceDiagram
    A->>B: hi`);
    expect(sequence.participants).toEqual([{ id: "A", label: "A" }, { id: "B", label: "B" }]);
  });

  it("treats A->>A as a self message structurally, with no separate kind field", () => {
    const sequence = glyphSequenceFromMermaid(`sequenceDiagram
    A->>A: think`);
    expect(sequence.messages[0]).toEqual({ from: "A", to: "A", label: "think", style: "solid" });
    expect(sequence.messages[0]).not.toHaveProperty("kind");
  });

  it("maps alt/else onto two generic sibling frames, and opt/loop onto their own kind", () => {
    const sequence = glyphSequenceFromMermaid(`sequenceDiagram
    A->>B: ask
    alt condition one
      B->>A: yes
    else condition two
      B->>A: no
    end
    opt maybe
      A->>B: extra
    end
    loop until done
      A->>B: poll
    end`);
    expect(sequence.frames).toEqual([
      { kind: "alt", label: "condition one", from: 1, to: 1 },
      { kind: "else", label: "condition two", from: 2, to: 2 },
      { kind: "opt", label: "maybe", from: 3, to: 3 },
      { kind: "loop", label: "until done", from: 4, to: 4 },
    ]);
    // Mutation: hardcode the Mermaid keyword vocabulary into the renderer
    // instead of passing it through -> this fails, since every kind here is
    // an arbitrary caller-facing string with no reserved meaning.
    for (const frame of sequence.frames!) expect(typeof frame.kind).toBe("string");
  });

  it("parses note over one or more participants at the current position", () => {
    const sequence = glyphSequenceFromMermaid(`sequenceDiagram
    A->>B: ask
    note over A,B: thinking it over
    B->>A: answer`);
    expect(sequence.notes).toEqual([{ text: "thinking it over", over: ["A", "B"], at: 1 }]);
  });

  it("rejects a non-sequenceDiagram header and an unclosed alt/loop/opt block", () => {
    expect(() => glyphSequenceFromMermaid("flowchart TB\n  a --> b")).toThrow(expect.objectContaining({ code: "GLYPH_SEQUENCE_MERMAID_SYNTAX" }));
    expect(() => glyphSequenceFromMermaid("sequenceDiagram\nalt x\nA->>B: hi")).toThrow(expect.objectContaining({ code: "GLYPH_SEQUENCE_MERMAID_SYNTAX" }));
    expect(() => glyphSequenceFromMermaid("sequenceDiagram\nend")).toThrow(expect.objectContaining({ code: "GLYPH_SEQUENCE_MERMAID_SYNTAX" }));
  });

  it("ignores %% comment lines without treating them as statements", () => {
    const sequence = glyphSequenceFromMermaid(`sequenceDiagram
    %% a full-line comment
    A->>B: hi`);
    expect(sequence.messages).toHaveLength(1);
  });

  it("a non-software fixture: a two-party protocol handshake with no service vocabulary", () => {
    const sequence = glyphSequenceFromMermaid(`sequenceDiagram
    participant P1 as Peer 1
    participant P2 as Peer 2
    P1->>P2: SYN
    P2-->>P1: SYN-ACK
    P1->>P2: ACK`);
    expect(sequence.participants.map((p) => p.label)).toEqual(["Peer 1", "Peer 2"]);
    expect(sequence.messages.map((m) => m.label)).toEqual(["SYN", "SYN-ACK", "ACK"]);
  });
});
