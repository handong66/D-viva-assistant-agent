import { describe, expect, it } from "vitest";
import { makeTestDb } from "../test/db";
import { insertThesisWithChunks, searchEvidence } from "./repository";

function seedThesis(
  db: ReturnType<typeof makeTestDb>,
  thesisId: string,
  chunks: { section?: string; text: string; hash: string }[],
) {
  insertThesisWithChunks(db, {
    thesis: { id: thesisId, title: thesisId, source_kind: "md" },
    chunks: chunks.map((chunk, ord) => ({
      ord,
      section: chunk.section,
      text: chunk.text,
      charStart: 0,
      charEnd: chunk.text.length,
      hash: chunk.hash,
    })),
  });
}

describe("searchEvidence", () => {
  it("returns matching evidence ranked and scoped to the thesis", () => {
    const db = makeTestDb();
    seedThesis(db, "t1", [
      { section: "Methods", text: "methodology methodology", hash: "h1" },
      { section: "Background", text: "methodology appears in a broader background note with many filler terms", hash: "h2" },
      { section: "Results", text: "outcome reporting without the query term", hash: "h3" },
    ]);
    seedThesis(db, "t2", [
      { section: "Methods", text: "methodology methodology from another thesis", hash: "h4" },
    ]);

    const hits = searchEvidence(db, "t1", "methodology", 5);

    // Both matching t1 units are returned; their order is BM25-ranked (SQLite-internal — not
    // asserted). The non-matching t1 unit and the other thesis's unit are excluded.
    const texts = hits.map((hit) => hit.text);
    expect(texts).toHaveLength(2);
    expect(texts).toContain("methodology methodology");
    expect(texts).toContain("methodology appears in a broader background note with many filler terms");
    expect(texts.some((t) => t.includes("another thesis"))).toBe(false);
    db.close();
  });

  it("returns an empty result for punctuation-only queries", () => {
    const db = makeTestDb();

    expect(searchEvidence(db, "t1", "?! --")).toEqual([]);
    db.close();
  });

  it("tokenises intra-word punctuation and matches either term", () => {
    const db = makeTestDb();
    seedThesis(db, "t1", [
      { section: "Methods", text: "sample recruitment is discussed here", hash: "h1" },
      { section: "Methods", text: "the size calculation is reported separately", hash: "h2" },
      { section: "Results", text: "unrelated outcome reporting", hash: "h3" },
    ]);

    const hits = searchEvidence(db, "t1", "sample-size");

    const texts = hits.map((hit) => hit.text);
    expect(texts).toContain("sample recruitment is discussed here");
    expect(texts).toContain("the size calculation is reported separately");
    db.close();
  });
});
