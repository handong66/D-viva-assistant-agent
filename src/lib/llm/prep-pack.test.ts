import { describe, it, expect } from "vitest";
import { MockLlmClient } from "./mock";
import { PrepPackSchema, buildPrepPackPrompt, generatePrepPack } from "./prep-pack";

describe("PrepPackSchema", () => {
  it("rejects an item with no cited evidence", () => {
    expect(() =>
      PrepPackSchema.parse({
        items: [{ type: "digest", title: "T", claim_text: "c", evidence_unit_ids: [] }],
      }),
    ).toThrow();
  });

  it("accepts a well-formed item and defaults nullable fields", () => {
    const p = PrepPackSchema.parse({
      items: [{ type: "qa", title: "Q", claim_text: "c", evidence_unit_ids: ["e1"] }],
    });
    expect(p.items[0]).toMatchObject({ evidence_quote: null, value_numeric: null, unit: null });
  });
});

describe("buildPrepPackPrompt", () => {
  it("includes each evidence id + text and instructs grounding", () => {
    const prompt = buildPrepPackPrompt({ title: "Voice", evidence: [{ id: "e1", text: "accuracy was 81.3%" }] });
    expect(prompt).toContain("e1");
    expect(prompt).toContain("accuracy was 81.3%");
    expect(prompt.toLowerCase()).toMatch(/evidence_unit_ids|cite|grounded/);
  });
});

describe("generatePrepPack", () => {
  it("calls the client with the prep schema and returns parsed items", async () => {
    const mock = new MockLlmClient().setObject("prep_pack", {
      items: [
        {
          type: "key_number",
          title: "Acc",
          claim_text: "accuracy 81.3%",
          value_numeric: 81.3,
          unit: "%",
          evidence_unit_ids: ["e1"],
        },
      ],
    });
    const items = await generatePrepPack(mock, {
      thesisId: "t1",
      title: "V",
      evidence: [{ id: "e1", text: "accuracy was 81.3%" }],
    });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ type: "key_number", value_numeric: 81.3, evidence_unit_ids: ["e1"] });
  });
});
