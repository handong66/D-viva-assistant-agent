import { describe, it, expect } from "vitest";
import { MockLlmClient } from "./mock";
import { JudgeResultSchema, buildJudgePrompt, judgeAnswer } from "./judge";

const valid = {
  scores: { evidence: 4, clarity: 3, completeness: 2, boundary: 5, delivery: 4 },
  diagnosis: "Mostly grounded but missed the limitation.",
  rewrite: "A clearer grounded answer.",
  follow_ups: ["What about the boundary case?"],
};

describe("JudgeResultSchema", () => {
  it("accepts a well-formed result (follow_ups may be empty)", () => {
    expect(JudgeResultSchema.safeParse(valid).success).toBe(true);
    expect(JudgeResultSchema.safeParse({ ...valid, follow_ups: [] }).success).toBe(true);
  });

  it("rejects out-of-range / non-integer / missing dimension scores", () => {
    expect(JudgeResultSchema.safeParse({ ...valid, scores: { ...valid.scores, evidence: 0 } }).success).toBe(false);
    expect(JudgeResultSchema.safeParse({ ...valid, scores: { ...valid.scores, clarity: 6 } }).success).toBe(false);
    expect(JudgeResultSchema.safeParse({ ...valid, scores: { ...valid.scores, delivery: 3.5 } }).success).toBe(false);
    expect(
      JudgeResultSchema.safeParse({ ...valid, scores: { evidence: 4, clarity: 3, completeness: 2, boundary: 5 } })
        .success,
    ).toBe(false);
  });

  it("rejects empty diagnosis/rewrite", () => {
    expect(JudgeResultSchema.safeParse({ ...valid, diagnosis: "" }).success).toBe(false);
    expect(JudgeResultSchema.safeParse({ ...valid, rewrite: "" }).success).toBe(false);
  });
});

describe("buildJudgePrompt", () => {
  it("includes the question, the bound evidence, the answer, and an evidence-only instruction", () => {
    const p = buildJudgePrompt({
      question: "Why 81.3%?",
      evidence: [{ id: "e1", text: "accuracy was 81.3%" }],
      answer: "Because the model was tuned.",
    });

    expect(p).toContain("Why 81.3%?");
    expect(p).toContain("[e1] accuracy was 81.3%");
    expect(p).toContain("Because the model was tuned.");
    expect(p.toLowerCase()).toContain("do not use outside knowledge");
    for (const d of ["evidence", "clarity", "completeness", "boundary", "delivery"]) {
      expect(p).toContain(d);
    }
  });
});

describe("judgeAnswer", () => {
  it("returns the parsed result and calls the 'hard' role with purpose 'judge'", async () => {
    const mock = new MockLlmClient().setObject("judge", valid);

    const out = await judgeAnswer(mock, {
      thesisId: "t1",
      question: "Q?",
      evidence: [{ id: "e1", text: "x" }],
      answer: "a",
    });

    expect(out.scores.boundary).toBe(5);
    expect(mock.calls).toEqual([{ kind: "object", role: "hard", purpose: "judge" }]);
  });
});
