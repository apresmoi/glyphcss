import { describe, expect, it } from "vitest";
import { renderGlyphSequence, renderGlyphSequenceJson } from "./render";
import type { GlyphSequence } from "./types";

const LOGIN: GlyphSequence = {
  participants: [
    { id: "client", label: "Client" },
    { id: "api", label: "API" },
    { id: "auth", label: "Auth" },
    { id: "db", label: "DB" },
  ],
  messages: [
    { from: "client", to: "api", label: "POST /login" },
    { from: "api", to: "auth", label: "verify(creds)" },
    { from: "auth", to: "db", label: "SELECT user" },
    { from: "db", to: "auth", label: "row", style: "dashed" },
    { from: "auth", to: "api", label: "{sub, roles}", style: "dashed" },
    { from: "api", to: "auth", label: "issue(24h)" },
    { from: "api", to: "client", label: "200 + JWT", style: "dashed" },
  ],
  frames: [{ kind: "alt", label: "roles contains admin", from: 5, to: 5 }],
};

/** The first painted row — the header. Not necessarily row 0: the paint
 *  centres the diagram vertically in its grid, exactly as the graph
 *  pipeline does, so the header sits after the top margin. */
function headerLine(text: string): string {
  return text.split("\n").find((l) => l.trim().length > 0) ?? "";
}

describe("renderGlyphSequence", () => {
  it("renders autonumber labels, including the second number after a frame boundary", async () => {
    const result = await renderGlyphSequence("sequenceDiagram\nautonumber\nA->>B: ask\nopt maybe\nB-->>A: reply\nend", { target: "chat", width: 60, height: 20 });
    expect(result.text).toContain("1. ask");
    expect(result.text).toContain("2. reply");
  });

  it.each([["par", "and"], ["critical", "option"], ["break", undefined]])("renders Mermaid %s with its kind verbatim", async (kind, branch) => {
    const result = await renderGlyphSequence(`sequenceDiagram\n${kind} first\nA->>B: x\n${branch ? `${branch} second\nB->>A: y\n` : ""}end`, { target: "chat", width: 60, height: 20 });
    expect(result.text).toContain(`${kind} first`);
    if (branch) expect(result.text).toContain(`${branch} second`);
    expect(result.text).toContain("┌");
    expect(result.text).toContain("┘");
  });

  it.each(["left", "right"])("renders Note %s of X on that side of the lifeline", async (side) => {
    const result = await renderGlyphSequence(`sequenceDiagram\nparticipant X\nNote ${side} of X: hello\nX->>X: done`, { target: "chat", width: 60, height: 20 });
    const lines = result.text.split("\n");
    const x = lines.find((line) => line.trim() === "X")!.indexOf("X");
    const noteLine = lines.find((line) => line.includes("note  hello"))!;
    if (side === "left") expect(noteLine.indexOf("note  hello") + "note  hello".length).toBeLessThan(x);
    else expect(noteLine.indexOf("note  hello")).toBeGreaterThan(x);
    expect(result.text).toContain("done");
    expect(result.report.ledger).toEqual([]);
  });

  it("keeps side notes inside their frame and fits or reports their label cuts", async () => {
    const source = "sequenceDiagram\npar work\nNote left of A: left note\nNote right of B: right note\nA->>B: x\nend";
    const wide = await renderGlyphSequence(source, { target: "chat", width: 80, height: 24 });
    const lines = wide.text.split("\n");
    const border = lines.find((line) => line.includes("par work"))!;
    for (const label of ["note  left note", "note  right note"]) {
      const row = lines.find((line) => line.includes(label))!;
      expect(row.indexOf(label)).toBeGreaterThan(border.indexOf("┌"));
      expect(row.indexOf(label) + label.length).toBeLessThan(border.lastIndexOf("┐"));
    }
    const narrow = await renderGlyphSequence(source, { target: "chat", width: 40, height: 24 });
    expect(narrow.canvas.cols).toBe(40);
    expect(narrow.report.ledger.some((entry) => entry.code === "label-abbreviated")).toBe(true);
    expect(narrow.text).toContain("┌");
    expect(narrow.text).toContain("┐");
    const overflow = await renderGlyphSequence(source, { target: "chat", width: 20, height: 24 });
    expect(overflow.report.ledger.some((entry) => entry.code === "sequence-layout-overflow")).toBe(true);
  });

  it.each(["->>+B: call\nB-->>-A: reply", "->>B: call\nactivate B\ndeactivate B\nB-->>A: reply"])("activation syntax leaves existing drawing unchanged: %s", async (tail) => {
    const options = { target: "chat", width: 40, height: 16 } as const;
    const actual = await renderGlyphSequence(`sequenceDiagram\nA${tail}`, options);
    const plain = await renderGlyphSequence("sequenceDiagram\nA->>B: call\nB-->>A: reply", options);
    expect(actual.text).toBe(plain.text);
  });

  it.each(["rect rgb(0,0,0)\nA->>B: hi\nend", "box Team\nparticipant A\nparticipant B\nend\nA->>B: hi"])("inert grouping leaves existing drawing unchanged: %s", async (body) => {
    const options = { target: "chat", width: 40, height: 12 } as const;
    expect((await renderGlyphSequence(`sequenceDiagram\n${body}`, options)).text).toBe((await renderGlyphSequence("sequenceDiagram\nA->>B: hi", options)).text);
  });

  it.each(["-x", "--x", "-)", "--)"])("renders %s like the existing solid/dashed arrow", async (op) => {
    const options = { target: "chat", width: 40, height: 12 } as const;
    const actual = await renderGlyphSequence(`sequenceDiagram\nA${op}B: hi`, options);
    const expected = await renderGlyphSequence(`sequenceDiagram\nA${op.startsWith("--") ? "-->>" : "->>"}B: hi`, options);
    expect(actual.text).toBe(expected.text);
    expect(actual.text).toContain("▶");
  });

  it("paints the parsed title above actors and allows the render option to override it", async () => {
    const source = "sequenceDiagram\ntitle Hello\nactor A\nA->>B: hi";
    const result = await renderGlyphSequence(source, { target: "chat", width: 40, height: 12 });
    expect(headerLine(result.text).trim()).toBe("Hello");
    expect(result.meta.description).toContain("Hello.");
    const overridden = await renderGlyphSequence(source, { target: "chat", width: 40, height: 12, title: "Custom" });
    expect(headerLine(overridden.text).trim()).toBe("Custom");
    expect(overridden.text).not.toContain("Hello");
    expect(overridden.text).toContain("o");
  });

  it("rejects an invalid title option instead of falling back to the source title", async () => {
    await expect(renderGlyphSequence("sequenceDiagram\ntitle Hello\nA->>B: hi", { title: null as unknown as string })).rejects.toMatchObject({ code: "bad-options" });
  });

  it("repeats titles across pages and reports cuts on narrow titles", async () => {
    const result = await renderGlyphSequence("sequenceDiagram\ntitle A very long title\nA->>B: one\nA->>B: two\nA->>B: three", { target: "chat", width: 16, height: 8 });
    expect(result.pages.length).toBeGreaterThan(1);
    for (const page of result.pages) expect(headerLine(page.text)).toContain("A very long");
    expect(result.report.ledger.some((entry) => entry.code === "label-abbreviated" && entry.detail?.role === "title")).toBe(true);
  });

  it("renders every participant label in the header and every line padded to the requested width", async () => {
    const result = await renderGlyphSequence(LOGIN, { target: "chat", width: 60, height: 24 });
    const lines = result.text.split("\n");
    for (const p of LOGIN.participants) expect(headerLine(result.text)).toContain(p.label);
    for (const line of lines) expect(line.length).toBe(60);
  });

  it("points the arrowhead toward the message's own destination, both directions", async () => {
    const result = await renderGlyphSequence(LOGIN, { target: "chat", width: 60, height: 24 });
    const lines = result.text.split("\n");
    expect(lines.some((l) => l.includes("▶"))).toBe(true); // client -> api, forward
    expect(lines.some((l) => l.includes("◀"))).toBe(true); // auth -> api / api -> client, backward
  });

  it("renders a dashed message with the tier's own hop glyph, never a solid rule", async () => {
    const solidOnly: GlyphSequence = { participants: LOGIN.participants.slice(0, 2), messages: [{ from: "client", to: "api", label: "x", style: "dashed" }] };
    const result = await renderGlyphSequence(solidOnly, { target: "chat", width: 40, height: 10 });
    expect(result.text).toContain("╌");
  });

  it("renders a self-message with its own loop shape, distinct from a plain arrow", async () => {
    const sequence: GlyphSequence = {
      participants: [{ id: "a", label: "A" }, { id: "b", label: "B" }],
      messages: [{ from: "a", to: "a", label: "validate" }],
    };
    const result = await renderGlyphSequence(sequence, { target: "chat", width: 40, height: 10 });
    // Mutation: render a self-message as a generic zero-width arrow instead
    // of its own loop -> the corner glyphs below never appear, and this fails.
    expect(result.text).toContain("┐");
    expect(result.text).toContain("┘");
    expect(result.text).toContain("◀");
  });

  it("marks a lifeline a long-range message crosses with a 4-way junction, not a silent gap", async () => {
    const sequence: GlyphSequence = {
      participants: [{ id: "a", label: "A" }, { id: "b", label: "B" }, { id: "c", label: "C" }],
      messages: [{ from: "a", to: "c", label: "skip b" }],
    };
    const result = await renderGlyphSequence(sequence, { target: "chat", width: 50, height: 10 });
    const arrowLine = result.text.split("\n").find((l) => l.includes("▶"))!;
    // Mutation: paint the crossed lifeline's cell as a plain dash instead of
    // a junction -> "┼" never appears and this fails.
    expect(arrowLine).toContain("┼");
  });

  it("renders a frame's own kind and label in its top border", async () => {
    const result = await renderGlyphSequence(LOGIN, { target: "chat", width: 60, height: 24 });
    expect(result.text).toContain("alt");
    expect(result.text).toMatch(/roles contains admin|roles contains a/);
  });

  it("renders a note over one or more participants", async () => {
    const sequence: GlyphSequence = {
      participants: [{ id: "a", label: "A" }, { id: "b", label: "B" }],
      messages: [{ from: "a", to: "b", label: "x" }],
      notes: [{ text: "shared context", over: ["a", "b"], at: 1 }],
    };
    const result = await renderGlyphSequence(sequence, { target: "chat", width: 50, height: 12 });
    expect(result.text).toContain("note");
    expect(result.text).toMatch(/shared context|shared conte/);
  });

  it("abbreviates participant labels when the natural layout is too wide, and logs it", async () => {
    const wide: GlyphSequence = {
      participants: [{ id: "a", label: "A Very Long Participant Name" }, { id: "b", label: "Another Very Long One" }],
      messages: [{ from: "a", to: "b", label: "go" }],
    };
    const result = await renderGlyphSequence(wide, { target: "chat", width: 30, height: 10 });
    // Mutation: skip the abbreviation degrade lever entirely -> the rendered
    // width would exceed 30 and no label-abbreviated entry would be logged.
    for (const line of result.text.split("\n")) expect(line.length).toBe(30);
    expect(result.report.ledger.some((e) => e.code === "label-abbreviated")).toBe(true);
  });

  it("pages a sequence that does not fit the requested height into multiple panels, each repeating the header", async () => {
    const participants = [{ id: "a", label: "Alice" }, { id: "b", label: "Bob" }];
    const messages = Array.from({ length: 8 }, (_, i) => ({ from: i % 2 === 0 ? "a" : "b", to: i % 2 === 0 ? "b" : "a", label: `step ${i + 1}` }));
    const result = await renderGlyphSequence({ participants, messages }, { target: "chat", width: 40, height: 10 });
    // Mutation: never split by time -> pages.length stays 1 and every panel
    // after the first would silently lose its header, or rows would overflow
    // the requested height.
    expect(result.pages.length).toBeGreaterThan(1);
    expect(result.report.ledger.some((e) => e.code === "sequence-paged")).toBe(true);
    for (const page of result.pages) {
      const lines = page.text.split("\n");
      expect(headerLine(page.text)).toContain("Alice");
      expect(lines.length).toBeLessThanOrEqual(10);
    }
  });

  it("renders every ascii-charset output within the printable ASCII range", async () => {
    const result = await renderGlyphSequence(LOGIN, { target: "chat", charset: "ascii", width: 60, height: 24 });
    for (const ch of result.text) if (ch !== "\n") expect(ch.codePointAt(0)!).toBeLessThanOrEqual(0x7e);
  });

  it("box/blocks/braille charsets all draw the same whole-cell box-drawing (no hardcoded literals)", async () => {
    const box = await renderGlyphSequence(LOGIN, { target: "chat", charset: "box", color: "none", width: 60, height: 24 });
    const braille = await renderGlyphSequence(LOGIN, { target: "chat", charset: "braille", color: "none", width: 60, height: 24 });
    expect(braille.text).toBe(box.text);
  });

  it("round-trips through the JSON entry point, success and failure", async () => {
    const ok = JSON.parse(await renderGlyphSequenceJson(JSON.stringify(LOGIN), { target: "chat", width: 60, height: 24 }));
    expect(ok.text).toContain("Client");
    const bad = JSON.parse(await renderGlyphSequenceJson("{not json"));
    expect(bad.code).toBe("GLYPH_SEQUENCE_BAD_JSON");
    expect(bad.hint).toBeTruthy();
  });

  it("renders straight from Mermaid source through the same entry point", async () => {
    const result = await renderGlyphSequence(`sequenceDiagram
    A->>B: hello`, { target: "chat", width: 30, height: 10 });
    expect(result.text).toContain("hello");
  });
});

const SIGN_IN = `sequenceDiagram
  participant U as User
  participant W as Web
  participant A as Auth
  participant D as Database
  U->>W: POST /login
  W->>A: verify credentials
  A->>D: find user by email
  D-->>A: user record
  alt password ok
    A-->>W: session token
    W-->>U: 200 + cookie
  else wrong password
    A-->>W: invalid
    W-->>U: 401
  end
  U->>W: GET /dashboard
  W-->>U: dashboard html`;

const POLL = `sequenceDiagram
  participant C as Client
  participant Q as Queue
  participant W as Worker
  C->>Q: enqueue job
  loop until queue empty
    W->>Q: poll
    Q-->>W: job
    opt job is large
      W->>W: split into chunks
    end
    W-->>Q: ack
  end
  Q-->>C: done`;

const rowOf = (lines: readonly string[], text: string): number => lines.findIndex((l) => l.includes(text));

describe("frames", () => {
  it("encloses an alt's messages in one box, with else as a dashed divider between its branches", async () => {
    const lines = (await renderGlyphSequence(SIGN_IN, { target: "chat", width: 72, height: 60 })).text.split("\n");
    const top = rowOf(lines, "┌─ alt password ok"), divider = rowOf(lines, "├╌ else wrong password"), bottom = lines.findIndex((l, y) => y > divider && l.includes("└"));
    // Mutation: draw the old floating bar per segment -> no "├╌ else" divider
    // row exists, and nothing closes the box below the else branch.
    expect(top).toBeGreaterThan(-1);
    expect(divider).toBeGreaterThan(top);
    expect(bottom).toBeGreaterThan(divider);
    // The borders sit flush against the messages they enclose.
    expect(rowOf(lines, "session token")).toBe(top + 1);
    expect(rowOf(lines, "invalid")).toBe(divider + 1);
    expect(rowOf(lines, " 401")).toBe(bottom - 2);
    const x0 = lines[top]!.indexOf("┌"), x1 = lines[top]!.lastIndexOf("┐");
    expect(lines[divider]!.indexOf("├")).toBe(x0);
    expect(lines[bottom]!.indexOf("└")).toBe(x0);
    expect(lines[bottom]!.lastIndexOf("┘")).toBe(x1);
    for (let y = top + 1; y < bottom; y++) if (y !== divider) expect([lines[y]![x0], lines[y]![x1]]).toEqual(["│", "│"]);
    // Messages outside the block stay outside the box.
    expect(rowOf(lines, "user record")).toBeLessThan(top);
    expect(rowOf(lines, "GET /dashboard")).toBeGreaterThan(bottom);
  });

  it("reopens a frame cut by a page break under its current branch", async () => {
    const result = await renderGlyphSequence(SIGN_IN, { target: "chat", width: 72, height: 17 });
    expect(result.pages.length).toBeGreaterThan(1);
    const second = result.pages[1]!.text.split("\n");
    // Mutation: clip the frame without its branch header -> the second panel
    // opens with "alt password ok" (or no box) above the else branch.
    expect(second.find((l) => l.includes("┌"))).toContain("else wrong password");
  });

  it("keeps every lifeline in the same column on every panel, framed or not", async () => {
    const result = await renderGlyphSequence(POLL, { target: "chat", width: 72, height: 12 });
    const lifelines = (page: { text: string }) => {
      const lines = page.text.split("\n");
      const header = lines.findIndex((l) => l.trim().length > 0);
      return [...lines[header + 1]!].flatMap((ch, x) => (ch === "│" ? [x] : []));
    };
    expect(result.pages.some((page) => !page.text.includes("┌"))).toBe(true);
    // Mutation: centre each panel on its own ink -> the frame-free panel,
    // narrower than the framed ones, shifts every lifeline sideways.
    for (const page of result.pages) expect(lifelines(page)).toEqual(lifelines(result.pages[0]!));
  });

  it("widens the gaps a frame encloses so its label never pushes its side across the next lifeline", async () => {
    const lines = (await renderGlyphSequence(`sequenceDiagram
      A->>B: go
      alt a much longer condition than the gap
        B-->>A: ok
      end
      B->>C: next`, { target: "chat", width: 72, height: 30 })).text.split("\n");
    const top = rowOf(lines, "┌─ alt");
    const cX = lines[rowOf(lines, "next") + 1]!.lastIndexOf("▶") + 1;
    // Mutation: skip the column pass that makes room for frames -> the
    // box's right side lands on or past C's lifeline.
    expect(lines[top]!.lastIndexOf("┐")).toBeLessThan(cX - 1);
    expect(lines[top]).toContain("a much longer condition than the gap");
  });

  it("wraps an outer frame around an inner one on a single lifeline whose label reaches past the outer's own box", async () => {
    const lines = (await renderGlyphSequence(`sequenceDiagram
      A->>B: go
      loop x
        B->>C: try
        opt a much longer inner condition
          C->>C: retry
        end
      end`, { target: "chat", width: 72, height: 30 })).text.split("\n");
    const outer = rowOf(lines, "┌─ loop x"), inner = rowOf(lines, "┌─ opt");
    // Mutation: size an outer frame from its own lifelines and label alone ->
    // the inner box's label pushes the inner side past the outer one.
    expect(lines[inner]!.lastIndexOf("┐")).toBeLessThan(lines[outer]!.lastIndexOf("┐"));
    expect(lines[inner]!.indexOf("┌")).toBeGreaterThan(lines[outer]!.indexOf("┌"));
  });

  it("leaves room right of a self-message's loop for its whole label", async () => {
    const lines = (await renderGlyphSequence(`sequenceDiagram
      A->>A: validate the whole input
      A->>B: send`, { target: "chat", width: 72, height: 30 })).text.split("\n");
    // Mutation: size a self-message's gap for its loop alone -> the label
    // is cut, or runs into B's lifeline.
    expect(lines.some((l) => /validate the whole input\s+│/.test(l))).toBe(true);
  });

  it("nests an inner frame inside its outer one and keeps a self-message's whole label", async () => {
    const lines = (await renderGlyphSequence(POLL, { target: "chat", width: 72, height: 60 })).text.split("\n");
    const outer = rowOf(lines, "┌─ loop until queue empty"), inner = rowOf(lines, "┌─ opt job is large");
    const outerX = [lines[outer]!.indexOf("┌"), lines[outer]!.lastIndexOf("┐")], innerX = [lines[inner]!.indexOf("┌"), lines[inner]!.lastIndexOf("┐")];
    // Mutation: size every frame from its lifelines alone -> the inner box's
    // label pushes it past the outer box's right side.
    expect(innerX[0]!).toBeGreaterThan(outerX[0]!);
    expect(innerX[1]!).toBeLessThan(outerX[1]!);
    // Mutation: drop the self-label room from the column layout -> "split
    // into chunks" is cut with an ellipsis.
    expect(lines.some((l) => l.includes("split into chunks"))).toBe(true);
  });

  it("grows taller in one panel with overflow: expand instead of paging", async () => {
    const result = await renderGlyphSequence(SIGN_IN, { target: "chat", width: 72, height: 10, overflow: "expand" });
    // Mutation: ignore overflow -> the sequence pages at height 10.
    expect(result.pages.length).toBe(1);
    expect(result.report.ledger.some((e) => e.code === "sequence-paged")).toBe(false);
    expect(result.text).toContain("dashboard html");
  });
});

const CHECKOUT = `sequenceDiagram
  participant U as Shopper
  participant W as Web app
  participant C as Cart service
  participant P as Payments
  participant B as Bank
  U->>W: Click checkout
  W->>C: Reserve items
  C-->>W: Reserved
  W->>P: Charge $42.00
  P->>B: Authorize card
  alt approved
    B-->>P: Auth code
    P-->>W: Paid
    W-->>U: Order #1042 placed
  else declined
    B-->>P: Declined
    W-->>U: Try another card
  end
  opt receipt requested
    W->>W: Render PDF
    W-->>U: Email receipt
  end`;
const chatSize = { width: 72, height: 24, overflow: "expand" } as const;

describe("long labels", () => {
  it("wraps a message label too long for its gap onto extra rows above the arrow instead of cutting it", async () => {
    // Mutation: wrap at an unbounded room -> "Order #1042 p…".
    const r = await renderGlyphSequence(CHECKOUT, chatSize);
    const lines = r.text.split("\n");
    expect(r.text).not.toContain("…");
    const order = rowOf(lines, "Order #1042");
    expect(lines[order]).not.toContain("placed");
    expect(lines[order + 1]).toContain("placed");
    expect(lines[order + 2]).toContain("◀");
    expect(r.report.ledger.filter((e) => e.code === "label-abbreviated")).toEqual([]);
  });

  it("spends leftover width un-wrapping labels before spreading it as air", async () => {
    // Mutation: drop the un-wrap pass -> "Try another" and "card" split.
    const r = await renderGlyphSequence(CHECKOUT, chatSize);
    expect(r.text).toContain("Try another card");
    expect(r.canvas.grid.cols).toBe(72);
  });

  it("shows a frame label whole when its box has room, whatever cap the message labels needed", async () => {
    // Mutation: label the box with the capped text -> "opt receipt requ…".
    const r = await renderGlyphSequence(CHECKOUT, chatSize);
    expect(r.text).toContain("opt receipt requested");
  });

  it("wraps a self-message label beside its loop and draws the loop under the last line", async () => {
    // Mutation: draw the loop at the label's first row -> it overwrites "PDF".
    const r = await renderGlyphSequence("sequenceDiagram\n  participant A as App\n  participant B as Bank\n  A->>A: Render the receipt PDF\n  A->>B: Send", { width: 18, height: 24, overflow: "expand" });
    const lines = r.text.split("\n");
    const last = lines.findIndex((l) => l.includes("PDF"));
    expect(last).toBeGreaterThan(rowOf(lines, "Render"));
    expect(lines[last + 1]).toContain("┐");
    expect(r.text).not.toContain("…");
  });

  it("starts every dashed arrow's pattern at its head, whatever the arrow's length", async () => {
    // Mutation: count the dashes from the source -> an odd-length reply reads "◀ ╌".
    const r = await renderGlyphSequence(CHECKOUT, chatSize);
    const heads = r.text.split("\n").filter((l) => l.includes("◀") && !l.includes("◀┘"));
    expect(heads.length).toBeGreaterThan(4);
    for (const line of heads) expect(line).toMatch(/◀[╌─]/);
  });

  it("reports every label it still has to cut", async () => {
    // Mutation: drop the paint's abbreviation entry -> the cut word goes unreported.
    const r = await renderGlyphSequence("sequenceDiagram\n  A->>B: Supercalifragilisticexpialidocious", { width: 16, height: 12 });
    expect(r.text).toContain("…");
    expect(r.report.ledger.some((e) => e.code === "label-abbreviated" && e.message.includes("Supercalifragilisticexpialidocious"))).toBe(true);
  });
});

describe("colour surface: participantColor", () => {
  // A frame-free/note-free slice of LOGIN: every painted cell is
  // participant-owned (a frame/note marker bar is deliberately NOT
  // participant-coloured — see paint.ts's own doc — so including one here
  // would leave stray base-default cells and weaken the "every colour is
  // the override" assertion below).
  const NO_MARKERS: GlyphSequence = { participants: LOGIN.participants, messages: LOGIN.messages };

  it("color: none stays byte-identical whether or not participantColor is set (colour is additive only)", async () => {
    const plain = await renderGlyphSequence(LOGIN, { color: "none", width: 60, height: 24 });
    const withOverride = await renderGlyphSequence(LOGIN, { color: "none", width: 60, height: 24, participantColor: "#0a0b0c" });
    expect(withOverride.text).toBe(plain.text);
    expect(withOverride.canvas.grid.color.every((c) => c === null)).toBe(true);
  });

  it("defaults to the shared palette, cycled by participant order — four participants must show more than one colour (mutation: one flat default colour collapses this to one)", async () => {
    const result = await renderGlyphSequence(LOGIN, { target: "web", color: "css" });
    const used = new Set(result.canvas.grid.color.filter((c): c is string => c !== null));
    expect(used.size).toBeGreaterThan(1);
  });

  it("participantColor as a plain string overrides every participant-owned glyph (no frames/notes in this slice, so every painted cell is one of them)", async () => {
    const result = await renderGlyphSequence(NO_MARKERS, { target: "web", color: "css", participantColor: "#ff00ff" });
    const used = new Set(result.canvas.grid.color.filter((c): c is string => c !== null));
    expect(used).toEqual(new Set(["#ff00ff"]));
  });

  it("colours a message's arrow by its ORIGINATING participant, never the receiver (mutation: key off `to` instead of `from`)", async () => {
    const twoWay: GlyphSequence = {
      participants: [{ id: "a", label: "A" }, { id: "b", label: "B" }],
      messages: [{ from: "a", to: "b", label: "ping" }, { from: "b", to: "a", label: "pong" }],
    };
    const result = await renderGlyphSequence(twoWay, {
      target: "web", color: "css",
      participantColor: (p) => (p.id === "a" ? "#aaaaaa" : "#bbbbbb"),
    });
    const cols = result.canvas.grid.cols;
    const forwardArrow = result.canvas.grid.char.indexOf("▶"), backArrow = result.canvas.grid.char.indexOf("◀");
    expect(forwardArrow).toBeGreaterThanOrEqual(0); expect(backArrow).toBeGreaterThanOrEqual(0);
    // The arrowHEAD itself, not the whole row — a row also carries the
    // OTHER participant's own untouched lifeline stub in its own colour
    // (correctly: that lifeline keeps its own colour down its column too),
    // so asserting the row's full colour set would fail for a reason
    // unrelated to this claim.
    expect(result.canvas.grid.color[forwardArrow]).toBe("#aaaaaa"); // a -> b: A's colour
    expect(result.canvas.grid.color[backArrow]).toBe("#bbbbbb"); // b -> a: B's colour
  });

  it("rejects a participantColor that isn't canonical lowercase #rrggbb with the package's own tagged bad-color rule", async () => {
    await expect(renderGlyphSequence(LOGIN, { color: "css", participantColor: "magenta" })).rejects.toMatchObject({ code: "bad-color" });
    await expect(renderGlyphSequence(LOGIN, { color: "css", participantColor: () => "#12345" })).rejects.toMatchObject({ code: "bad-color" });
  });
});
