import { describe, it, expect } from "vitest";
import { makeTestDb } from "../test/db";
import { insertThesisWithChunks, getThesisChunks, countEvidence } from "./repository";

const chunk = (ord: number, text: string) => ({ ord, text, charStart: 0, charEnd: text.length, hash: `h${ord}` });

describe("insertThesisWithChunks", () => {
  it("inserts thesis + chunks + one evidence_unit per chunk, and FTS becomes searchable", () => {
    const db = makeTestDb();
    insertThesisWithChunks(db, {
      thesis: { id: "t1", title: "T", source_kind: "md" },
      chunks: [chunk(0, "emotional prosody study"), chunk(1, "second chunk text")],
    });
    expect(getThesisChunks(db, "t1").length).toBe(2);
    expect(countEvidence(db, "t1")).toBe(2);
    const hit = db.prepare("SELECT evidence_unit_id FROM evidence_fts WHERE evidence_fts MATCH ?").get("prosody");
    expect(hit).toBeTruthy();
    db.close();
  });

  it("is atomic — a bad chunk rolls back the whole thesis", () => {
    const db = makeTestDb();
    expect(() =>
      insertThesisWithChunks(db, {
        thesis: { id: "t1", title: "T", source_kind: "md" },
        // force a REAL DB NOT NULL violation (reaches insChunk.run): valid text so char_count computes, but null hash
        chunks: [chunk(0, "ok"), { ord: 1, text: "bad", charStart: 0, charEnd: 3, hash: null as unknown as string }],
      }),
    ).toThrow();
    expect(db.prepare("SELECT count(*) c FROM thesis WHERE id='t1'").get()).toEqual({ c: 0 });
    db.close();
  });
});
