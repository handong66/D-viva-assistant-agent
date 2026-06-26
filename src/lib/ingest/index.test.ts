import { describe, it, expect } from "vitest";
import { makeTestDb } from "../../test/db";
import { ingestThesis, IngestQualityError } from "./index";
import { countEvidence, getActiveThesis } from "../../db/repository";

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

  it("throws IngestQualityError and rolls back when source is too short", async () => {
    const db = makeTestDb();
    const goodMd = [
      "First paragraph explains the thesis argument, method, and contribution with enough detail to meet the ingest quality gate.",
      "Second paragraph describes the evidence base, analysis choices, and validation logic so the source has meaningful content.",
      "Third paragraph summarises the findings, limitations, and viva preparation implications for a realistic imported thesis.",
    ].join("\n\n");
    const good = await ingestThesis(db, { title: "Good", sourceKind: "md", content: goodMd });
    let caught: unknown;
    try {
      await ingestThesis(db, { title: "Bad", sourceKind: "txt", content: "too short" });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(IngestQualityError);
    expect(getActiveThesis(db)).toMatchObject({ id: good.thesisId, title: "Good" });
    expect((db.prepare("SELECT count(*) c FROM thesis").get() as { c: number }).c).toBe(1);
    db.close();
  });
});
