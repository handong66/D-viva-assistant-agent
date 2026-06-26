import { describe, it, expect } from "vitest";
import { MockLlmClient } from "./mock";
import {
  QUESTION_KINDS,
  ExamQuestionSchema,
  selectCandidates,
  buildExaminerPrompt,
  generateExamQuestion,
  type EvidenceCandidate,
} from "./examiner";

const C: EvidenceCandidate[] = [
  { id: "e1", text: "intro claim", section: "Introduction" },
  { id: "e2", text: "method detail", section: "Methods" },
  { id: "e3", text: "more methods", section: "Methods" },
  { id: "e4", text: "result 81.3%", section: "Results" },
];

describe("ExamQuestionSchema", () => {
  it("rejects a question with no evidence and an empty question", () => {
    expect(ExamQuestionSchema.safeParse({ question: "Q?", evidence_unit_ids: [] }).success).toBe(false);
    expect(ExamQuestionSchema.safeParse({ question: "", evidence_unit_ids: ["e1"] }).success).toBe(false);
  });

  it("accepts a grounded question", () => {
    expect(ExamQuestionSchema.safeParse({ question: "Why X?", evidence_unit_ids: ["e1"] }).success).toBe(true);
  });
});

describe("selectCandidates", () => {
  it("by_section keeps only that section", () => {
    expect(selectCandidates(C, "by_section", { section: "Methods" }).map((e) => e.id)).toEqual(["e2", "e3"]);
  });

  it("by_section requires opts.section (no silent whole-thesis fallback)", () => {
    expect(() => selectCandidates(C, "by_section")).toThrow(/requires opts\.section/i);
  });

  it("cross_section takes up to 2 evidence from each of the first 3 distinct sections", () => {
    const candidates: EvidenceCandidate[] = [
      { id: "a1", text: "a one", section: "A" },
      { id: "a2", text: "a two", section: "A" },
      { id: "a3", text: "a three", section: "A" },
      { id: "b1", text: "b one", section: "B" },
      { id: "b2", text: "b two", section: "B" },
      { id: "b3", text: "b three", section: "B" },
      { id: "c1", text: "c one", section: "C" },
      { id: "c2", text: "c two", section: "C" },
      { id: "d1", text: "d one", section: "D" },
    ];

    expect(selectCandidates(candidates, "cross_section").map((e) => e.id)).toEqual([
      "a1",
      "a2",
      "b1",
      "b2",
      "c1",
      "c2",
    ]);
  });

  it("random/hostile/boundary/followup use the whole candidate set", () => {
    for (const kind of ["random", "hostile", "boundary", "followup"] as const) {
      expect(selectCandidates(C, kind).map((e) => e.id)).toEqual(["e1", "e2", "e3", "e4"]);
    }
  });
});

describe("buildExaminerPrompt", () => {
  it("lists evidence id, section, text, the kind instruction, and a grounding instruction", () => {
    const p = buildExaminerPrompt({ title: "T", kind: "hostile", candidates: C });
    expect(p).toContain("[e4] (Results) result 81.3%");
    expect(p.toLowerCase()).toContain("adversarial");
    expect(p.toLowerCase()).toContain("evidence_unit_ids");
    expect(p.toLowerCase()).toContain("ground");
  });

  it("includes the previous Q/A for a followup", () => {
    const p = buildExaminerPrompt({
      title: "T",
      kind: "followup",
      candidates: C,
      previous: { question: "PQ", answer: "PA" },
    });
    expect(p).toContain("PREVIOUS QUESTION: PQ");
    expect(p).toContain("CANDIDATE ANSWER: PA");
  });

  it("emits a non-trivial, evidence-listing prompt for every question_kind", () => {
    const instructionFragments = {
      random: "substantive viva question",
      by_section: "focused question",
      cross_section: "integrative question",
      hostile: "adversarial examiner question",
      boundary: "limitations",
      followup: "follow-up question",
    } satisfies Record<(typeof QUESTION_KINDS)[number], string>;

    for (const kind of QUESTION_KINDS) {
      const p = buildExaminerPrompt({ title: "T", kind, candidates: C });
      expect(p).toContain("EVIDENCE (id: text):");
      expect(p).toContain("[e1] (Introduction) intro claim");
      expect(p.toLowerCase()).toContain(instructionFragments[kind]);
    }
  });
});

describe("generateExamQuestion", () => {
  it("returns the parsed question from the client, keyed by purpose 'examiner:<kind>'", async () => {
    const mock = new MockLlmClient().setObject("examiner:by_section", {
      question: "Why 81.3%?",
      evidence_unit_ids: ["e4"],
    });

    const out = await generateExamQuestion(mock, { thesisId: "t1", title: "T", kind: "by_section", candidates: C });

    expect(out).toEqual({ question: "Why 81.3%?", evidence_unit_ids: ["e4"] });
    expect(mock.calls).toEqual([{ kind: "object", role: "default", purpose: "examiner:by_section" }]);
  });

  it("uses the 'hard' role for hostile and cross_section, and 'default' for other kinds", async () => {
    for (const kind of QUESTION_KINDS) {
      const mock = new MockLlmClient().setObject(`examiner:${kind}`, {
        question: "Q?",
        evidence_unit_ids: ["e1"],
      });

      await generateExamQuestion(mock, { thesisId: "t1", title: "T", kind, candidates: C });

      expect(mock.calls[0]).toEqual({
        kind: "object",
        role: kind === "hostile" || kind === "cross_section" ? "hard" : "default",
        purpose: `examiner:${kind}`,
      });
    }
  });
});
