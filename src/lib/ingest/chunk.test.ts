import { describe, it, expect } from "vitest";
import { chunkParagraphs } from "./chunk";

const P = (text: string, section?: string) => (section ? { text, section } : { text });

describe("chunkParagraphs", () => {
  it("groups paragraphs up to maxChars without splitting a paragraph, keeping order", () => {
    const chunks = chunkParagraphs([P("aaaa"), P("bbbb"), P("cccc")], { maxChars: 10 });
    // "aaaa\n\nbbbb" = 10 chars -> one chunk; "cccc" -> next
    expect(chunks.map((c) => c.text)).toEqual(["aaaa\n\nbbbb", "cccc"]);
    expect(chunks.map((c) => c.ord)).toEqual([0, 1]);
  });

  it("starts a new chunk when the section changes", () => {
    const chunks = chunkParagraphs([P("a", "Intro"), P("b", "Methods")], { maxChars: 1000 });
    expect(chunks.map((c) => c.section)).toEqual(["Intro", "Methods"]);
  });

  it("records char offsets into the joined document and a stable sha256 hash", () => {
    const chunks = chunkParagraphs([P("hello"), P("world")], { maxChars: 5 });
    expect(chunks[0]).toMatchObject({ charStart: 0, charEnd: 5, text: "hello" });
    expect(chunks[1]).toMatchObject({ charStart: 7, charEnd: 12, text: "world" }); // 5 + "\n\n"
    expect(chunks[0]!.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(chunkParagraphs([P("hello")], { maxChars: 5 })[0]!.hash).toBe(chunks[0]!.hash);
  });
});
