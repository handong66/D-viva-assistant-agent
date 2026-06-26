import { describe, it, expect } from "vitest";
import { makeTestDb } from "../../test/db";
import { ingestThesis } from "./index";
import { countEvidence } from "../../db/repository";

describe("ingestThesis", () => {
  it("ingests a markdown thesis end-to-end and returns a thesisId + report", async () => {
    const db = makeTestDb();
    const md = "# Intro\n\n" + "This thesis studies emotional prosody in some detail. ".repeat(5) +
      "\n\n## Methods\n\n" + "We ran a controlled listening experiment with many participants. ".repeat(5) +
      "\n\n## Results\n\n" + "Listeners often misread the intended emotion in the voice. ".repeat(5);
    const res = await ingestThesis(db, { title: "Voice", sourceKind: "md", content: md });
    expect(res.report.ok).toBe(true);
    expect(countEvidence(db, res.thesisId)).toBeGreaterThan(0);
    const hit = db.prepare("SELECT 1 FROM evidence_fts WHERE evidence_fts MATCH ?").get("prosody");
    expect(hit).toBeTruthy();
    db.close();
  });

  it("still ingests but flags a poor (too-short) source as not ok", async () => {
    const db = makeTestDb();
    const res = await ingestThesis(db, { title: "X", sourceKind: "txt", content: "tiny" });
    expect(res.report.ok).toBe(false);
    db.close();
  });
});
