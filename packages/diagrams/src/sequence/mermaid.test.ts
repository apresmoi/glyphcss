import { describe, expect, it } from "vitest";
import { glyphSequenceFromMermaid } from "./mermaid";

describe("glyphSequenceFromMermaid", () => {
  it.each(["->>+", "-->>-"])("accepts activation suffix %s without contaminating the endpoint", (op) => {
    const sequence = glyphSequenceFromMermaid(`sequenceDiagram\nA${op}B: call`);
    expect(sequence.participants.map((p) => p.id)).toEqual(["A", "B"]);
    expect(sequence.messages).toEqual([{ from: "A", to: "B", label: "call", style: op.startsWith("--") ? "dashed" : "solid" }]);
  });

  it.each(["activate", "deactivate"])("accepts inert %s and keeps its participant", (directive) => {
    expect(glyphSequenceFromMermaid(`sequenceDiagram\n${directive} X`)).toEqual({ participants: [{ id: "X", label: "X" }], messages: [] });
  });

  it.each(["left", "right"] as const)("anchors Note %s of X beside X", (placement) => {
    expect(glyphSequenceFromMermaid(`sequenceDiagram\nNote ${placement} of X: hello`).notes).toEqual([{ over: ["X"], text: "hello", at: 0, placement }]);
  });

  it("autonumber prefixes messages only, including empty labels across frames", () => {
    const sequence = glyphSequenceFromMermaid(`sequenceDiagram
      autonumber
      A->>B: ask
      par work
        Note over A: waiting
        B-->>A:
      and other
        A->>A: think
      end`);
    expect(sequence.messages.map((m) => m.label)).toEqual(["1. ask", "2.", "3. think"]);
    expect(sequence.notes![0]!.text).toBe("waiting");
  });

  it("autonumber applies to the whole diagram wherever the directive occurs", () => {
    expect(glyphSequenceFromMermaid("sequenceDiagram\nA->>B: one\nautonumber\nB->>A: two").messages.map((m) => m.label)).toEqual(["1. one", "2. two"]);
  });

  it.each([["par", "and"], ["critical", "option"]])("parses %s/%s with verbatim frame and branch kinds", (kind, branch) => {
    expect(glyphSequenceFromMermaid(`sequenceDiagram\n${kind} first\nA->>B: x\n${branch} second\nB->>A: y\nend`).frames).toEqual([
      { kind, label: "first", from: 0, to: 1, branches: [{ kind: branch, label: "second", at: 1 }] },
    ]);
  });

  it("parses break as a verbatim frame kind", () => {
    expect(glyphSequenceFromMermaid("sequenceDiagram\nbreak aborted\nA->>B: stop\nend").frames).toEqual([{ kind: "break", label: "aborted", from: 0, to: 0 }]);
  });

  it("keeps nested frame ranges through inert rect grouping", () => {
    expect(glyphSequenceFromMermaid(`sequenceDiagram
      par
        rect rgb(0,0,0)
          break
            A->>B: x
          end
        end
      and
        B->>A: y
      end`).frames).toEqual([
      { kind: "break", from: 0, to: 0 },
      { kind: "par", from: 0, to: 1, branches: [{ kind: "and", at: 1 }] },
    ]);
  });

  it("accepts box around participants without adding a frame", () => {
    expect(glyphSequenceFromMermaid(`sequenceDiagram
      box rgb(0,0,0) Team
        participant A as Alice
        actor B as Bob
      end
      A->>B: hi`)).toEqual({
      participants: [{ id: "A", label: "Alice" }, { id: "B", label: "Bob", shape: "actor" }],
      messages: [{ from: "A", to: "B", label: "hi", style: "solid" }],
    });
  });

  it.each(["-x", "--x", "-)", "--)"])("maps %s to the closest existing arrow style", (op) => {
    expect(glyphSequenceFromMermaid(`sequenceDiagram\nA${op}B: hi`).messages).toEqual([{ from: "A", to: "B", label: "hi", style: op.startsWith("--") ? "dashed" : "solid" }]);
  });

  it.each(["title Hello", "title: Hello"])("retains %s as the sequence title", (statement) => {
    expect(glyphSequenceFromMermaid(`sequenceDiagram\n${statement}\nA->>B: hi`).title).toBe("Hello");
  });

  it.each([
    ["par x\nA->>B: hi\nelse wrong\nend", "else"],
    ["alt x\nA->>B: hi\nand wrong\nend", "and"],
    ["loop x\nA->>B: hi\noption wrong\nend", "option"],
    ["rect rgb(0,0,0)\nA->>B: hi", "rect"],
    ["box Team\nparticipant A", "box"],
    ["box Team\nA->>B: hi\nend", "box"],
    ["autonumber 10 2\nA->>B: hi", "autonumber"],
    ["create participant B\nA->>B: hi", "create"],
    ["Note left of A,B: hi", "Note left"],
    ["title", "title"],
    ["title First\ntitle Second", "title"],
  ])("rejects unsupported or malformed syntax %j by construct", (body, construct) => {
    expect(() => glyphSequenceFromMermaid(`sequenceDiagram\n${body}`)).toThrow(expect.objectContaining({ code: "GLYPH_SEQUENCE_MERMAID_SYNTAX", message: expect.stringContaining(construct) }));
  });

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

  it("maps alt/else onto one frame with an else branch, and opt/loop onto their own kind", () => {
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
      { kind: "alt", label: "condition one", from: 1, to: 2, branches: [{ kind: "else", label: "condition two", at: 2 }] },
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
