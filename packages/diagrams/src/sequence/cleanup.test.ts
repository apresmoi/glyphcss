import { expect, it } from "vitest";
import { glyphSequenceFromMermaid } from "./mermaid";
import { renderGlyphSequence } from "./render";
import { layoutGlyphSequenceColumns, layoutGlyphSequenceRows } from "./layout";
import { validateGlyphSequence } from "./validate";

export const cleanupSequence = `sequenceDiagram
  autonumber
  participant C as Client
  participant A as API
  participant D as DB
  C->>+A: POST /order
  Note right of A: validate
  par write
    A->>D: insert
  and notify
    A-->>C: 202 Accepted
  end
  A-->>-C: done`;

it("keeps a note authored before par above its top border", async () => {
  const result = await renderGlyphSequence(cleanupSequence, { width: 72, height: 24, target: "chat", overflow: "expand" });
  const lines = result.text.split("\n");
  const note = lines.findIndex((line) => line.includes("note  validate"));
  const frame = lines.findIndex((line) => line.includes("par write"));
  expect(note).toBeGreaterThan(-1);
  expect(note + 1).toBeLessThan(frame);
  expect(result.text).toContain("4. done");
});

it("preserves note/frame/branch order through validation and nested layout", () => {
  const sequence = validateGlyphSequence(glyphSequenceFromMermaid(`sequenceDiagram
    Note over A: outside
    par outer
      Note over A: outer note
      opt inner
        Note over A: inner note
        A->>B: work
      end
      Note over A: before branch
    and second
      Note over A: after branch
      A->>B: more
    end`));
  const cols = layoutGlyphSequenceColumns(sequence);
  const result = layoutGlyphSequenceRows(sequence, cols.columns, 0);
  const markers = result.rows.filter((row) => row.type === "marker");
  const outer = result.rows.find((row) => row.type === "frame" && row.kind === "par")!;
  const inner = result.rows.find((row) => row.type === "frame" && row.kind === "opt")!;
  expect(outer.type).toBe("frame"); expect(inner.type).toBe("frame");
  if (outer.type !== "frame" || inner.type !== "frame") return;
  expect(markers[0]!.top + 2).toBeLessThan(outer.top);
  expect(markers[1]!.top).toBeGreaterThan(outer.top);
  expect(markers[1]!.top + 2).toBeLessThan(inner.top);
  expect(markers[2]!.top).toBeGreaterThan(inner.top);
  expect(markers[3]!.top + 2).toBeLessThan(outer.dividers[0]!.row);
  expect(markers[4]!.top).toBeGreaterThan(outer.dividers[0]!.row);
});

it("keeps preceding and enclosed notes ordered on a continued frame's page", async () => {
  const source = `sequenceDiagram
    A->>B: first
    A->>B: second
    Note over A: before
    par work
      Note over A: inside
      A->>B: third
      A->>B: fourth
    end`;
  const result = await renderGlyphSequence(source, { width: 60, height: 13, target: "chat" });
  expect(result.pages.length).toBeGreaterThan(1);
  const page = result.pages.find((page) => page.text.includes("note  before"))!;
  expect(page).toBeDefined();
  const lines = page.text.split("\n");
  expect(lines.findIndex((line) => line.includes("note  before")) + 1).toBeLessThan(lines.findIndex((line) => line.includes("par work")));
  expect(lines.findIndex((line) => line.includes("note  inside"))).toBeGreaterThan(lines.findIndex((line) => line.includes("par work")));
});

it.each(["left", "right"])("reserves the neighbouring gap for a long %s note", (side) => {
  const sequence = glyphSequenceFromMermaid(`sequenceDiagram\nparticipant L\nparticipant X\nparticipant R\nNote ${side} of X: a long note occupying the neighbouring gap\nL->>R: x`);
  const cols = layoutGlyphSequenceColumns(sequence);
  const rows = layoutGlyphSequenceRows(sequence, cols.columns, 0);
  const note = rows.rows.find((row) => row.type === "marker")!;
  expect(note.type).toBe("marker");
  if (note.type !== "marker") return;
  const left = cols.columns.find((col) => col.id === "L")!.x;
  const right = cols.columns.find((col) => col.id === "R")!.x;
  expect(note.x0).toBeGreaterThan(left + 1);
  expect(note.x1).toBeLessThan(right - 1);
});
