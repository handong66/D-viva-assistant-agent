# M3a — AI Examiner Implementation Plan

> **For agentic workers:** This project runs the Claude↔Codex 老流程 (see `AGENTS.md`): **Codex implements** each task via `codex:codex-rescue` (`--write`); **Claude runs tests + reviews + commits** per task and at a milestone gate (绿测试≠Done). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate a viva exam question grounded in a thesis's evidence, persist it as a `practice_run`, and bind the exact evidence it was based on — so the M3b judge can score an answer against that same evidence.

**Architecture:** Mirror M2's generate→persist→bind shape, minus the validator (a *question* is not a verifiable factual claim, so it never reaches `verified`). A pure `selectCandidates` slices the thesis's evidence by `question_kind`; the LLM generates a question + the `evidence_unit_ids` it used; the runner keeps only ids that were actually offered (anti-hallucination), then calls one repository helper that **atomically inserts the `practice_run` and binds that evidence** (no public path leaves a run unbound). No `generation_run` (single question, not a batch — `generation_run.kind` has no `examiner` value anyway).

**Tech Stack:** TypeScript (strict, `noUncheckedIndexedAccess`), zod, Vercel AI SDK v7 via the existing `LlmClient`, better-sqlite3, vitest. LLM only through `lib/llm` (AGENTS red line #2); every question evidence-bound (red line #1); injected `MockLlmClient` in tests (red line #5).

> **Revised after Codex design-review round 1** (CONDITIONAL GO → fixes integrated): P0 followup read the wrong join table (`getBoundEvidence` is prep_item-only) → new `getPracticeRunBoundEvidence`. P1 no public unbound-insert path → `insertPracticeRunWithEvidence` (atomic, requires evidence). P1 `by_section` requires a section (no whole-thesis fallback). P1 followup derives the prior answer from `answer_text` **or** `transcript` and errors if neither. P2 FTS deferral made explicit; kind validated at the DB layer; more tests.

---

## Contracts (define in Task 1, reused everywhere)

```ts
// src/lib/llm/examiner.ts
export const QUESTION_KINDS = ["random", "by_section", "cross_section", "hostile", "boundary", "followup"] as const;
export type QuestionKind = (typeof QUESTION_KINDS)[number];

export const ExamQuestionSchema = z.object({
  question: z.string().min(1),
  evidence_unit_ids: z.array(z.string()).min(1),
});
export type ExamQuestion = z.infer<typeof ExamQuestionSchema>;

export type EvidenceCandidate = { id: string; text: string; section: string | null };
```

- `ExamQuestionSchema` is a plain `z.object` (NOT `.strict()`) — consistent with M2's lenient generated-content schemas; `evidence_unit_ids` min 1 forces grounding.
- The runner + repository are the safety boundary, not the schema: the runner filters cited ids to the offered candidate set; `insertPracticeRunWithEvidence` requires ≥1 evidence id and `bindPracticeRunEvidence` re-checks same-thesis. The schema only guarantees shape.

## File structure

- **Create** `src/lib/llm/examiner.ts` — schema/types + pure `selectCandidates` + pure `buildExaminerPrompt` + `generateExamQuestion` (the only LLM-touching fn).
- **Create** `src/lib/llm/examiner.test.ts` — schema + selection + prompt tests (no DB, no LLM).
- **Modify** `src/db/repository.ts` — add `getThesisEvidenceWithSection`, `getPracticeRunBoundEvidence`, `insertPracticeRunWithEvidence`, and the `PRACTICE_QUESTION_KINDS` const (alongside `getThesisEvidence`/`bindPracticeRunEvidence`).
- **Create** `src/db/repository.examiner.test.ts` — DB tests for the new helpers.
- **Create** `src/lib/llm/examiner-run.ts` — `runExaminerQuestion` orchestrator (select → generate → filter → atomic persist+bind).
- **Create** `src/lib/llm/examiner-run.test.ts` — orchestration tests with `MockLlmClient` + in-memory DB.

---

### Task 1: Examiner schema, candidate selection, and prompt (pure)

**Files:**
- Create: `src/lib/llm/examiner.ts`
- Test: `src/lib/llm/examiner.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/llm/examiner.test.ts
import { describe, it, expect } from "vitest";
import { QUESTION_KINDS, ExamQuestionSchema, selectCandidates, buildExaminerPrompt, type EvidenceCandidate } from "./examiner";

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
  it("cross_section spans at least two distinct sections", () => {
    const out = selectCandidates(C, "cross_section");
    expect(new Set(out.map((e) => e.section)).size).toBeGreaterThanOrEqual(2);
  });
  it("random/hostile/boundary use the whole candidate set", () => {
    expect(selectCandidates(C, "hostile").map((e) => e.id)).toEqual(["e1", "e2", "e3", "e4"]);
  });
});

describe("buildExaminerPrompt", () => {
  it("lists evidence id+text, the kind instruction, and a grounding instruction", () => {
    const p = buildExaminerPrompt({ title: "T", kind: "hostile", candidates: C });
    expect(p).toContain("[e4]");
    expect(p).toContain("result 81.3%");
    expect(p.toLowerCase()).toContain("adversarial");
    expect(p.toLowerCase()).toContain("evidence_unit_ids");
  });
  it("includes the previous Q/A for a followup", () => {
    const p = buildExaminerPrompt({ title: "T", kind: "followup", candidates: C, previous: { question: "PQ", answer: "PA" } });
    expect(p).toContain("PQ");
    expect(p).toContain("PA");
  });
  it("emits a non-trivial, evidence-listing prompt for every question_kind", () => {
    for (const kind of QUESTION_KINDS) {
      const p = buildExaminerPrompt({ title: "T", kind, candidates: C });
      expect(p).toContain("EVIDENCE (id: text):");
      expect(p).toContain("[e1]");
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/llm/examiner.test.ts`
Expected: FAIL — `Cannot find module './examiner'`.

- [ ] **Step 3: Write the minimal implementation**

```ts
// src/lib/llm/examiner.ts
import { z } from "zod";
import type { LlmClient } from "./types";

export const QUESTION_KINDS = ["random", "by_section", "cross_section", "hostile", "boundary", "followup"] as const;
export type QuestionKind = (typeof QUESTION_KINDS)[number];

export const ExamQuestionSchema = z.object({
  question: z.string().min(1),
  evidence_unit_ids: z.array(z.string()).min(1),
});
export type ExamQuestion = z.infer<typeof ExamQuestionSchema>;

export type EvidenceCandidate = { id: string; text: string; section: string | null };

/** Deterministic slice of the thesis's evidence for a question kind. `followup` is
 *  handled by the runner (it uses the previous run's bound evidence), not here. */
export function selectCandidates(
  all: EvidenceCandidate[],
  kind: QuestionKind,
  opts?: { section?: string | null },
): EvidenceCandidate[] {
  if (kind === "by_section") {
    if (opts?.section == null) throw new Error("by_section requires opts.section");
    return all.filter((e) => e.section === opts.section);
  }
  if (kind === "cross_section") {
    // up to 2 evidence from each of the first 3 distinct sections, in encounter order
    const bySection = new Map<string, EvidenceCandidate[]>();
    for (const e of all) {
      const key = e.section ?? "";
      const arr = bySection.get(key) ?? [];
      if (arr.length < 2) arr.push(e);
      bySection.set(key, arr);
    }
    return Array.from(bySection.values()).slice(0, 3).flat();
  }
  return all; // random | hostile | boundary (whole-thesis candidates)
}

const KIND_INSTRUCTIONS: Record<QuestionKind, string> = {
  random: "Ask one substantive viva question on any aspect of the evidence.",
  by_section: "Ask one focused question about the specific section the evidence is drawn from.",
  cross_section: "Ask one integrative question that connects findings across the different sections shown.",
  hostile: "Ask one tough, adversarial examiner question that challenges a claim, assumption, or weakness in the evidence.",
  boundary: "Ask one question probing the limitations, scope, or boundary conditions of the work.",
  followup: "Ask one follow-up question that digs deeper into the candidate's previous answer.",
};

export function buildExaminerPrompt(args: {
  title: string;
  kind: QuestionKind;
  candidates: EvidenceCandidate[];
  previous?: { question: string; answer: string } | null;
}): string {
  const ev = args.candidates.map((e) => `[${e.id}]${e.section ? ` (${e.section})` : ""} ${e.text}`).join("\n");
  const lines = [
    `You are a viva (thesis defence) examiner for the thesis "${args.title}".`,
    KIND_INSTRUCTIONS[args.kind],
    `Ground the question ONLY in the evidence below and cite the exact evidence_unit_ids the question is based on. Do NOT ask about anything not supported by this evidence.`,
  ];
  if (args.previous) {
    lines.push("", `PREVIOUS QUESTION: ${args.previous.question}`, `CANDIDATE ANSWER: ${args.previous.answer}`);
  }
  lines.push("", "EVIDENCE (id: text):", ev);
  return lines.join("\n");
}

export async function generateExamQuestion(
  client: LlmClient,
  args: {
    thesisId: string;
    title: string;
    kind: QuestionKind;
    candidates: EvidenceCandidate[];
    previous?: { question: string; answer: string } | null;
  },
): Promise<ExamQuestion> {
  return client.generateObject({
    role: args.kind === "hostile" || args.kind === "cross_section" ? "hard" : "default",
    purpose: `examiner:${args.kind}`,
    schema: ExamQuestionSchema,
    prompt: buildExaminerPrompt(args),
    thesisId: args.thesisId,
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/llm/examiner.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/llm/examiner.ts src/lib/llm/examiner.test.ts
git commit -m "feat(m3a): examiner schema + candidate selection + grounded prompt (Task 1)"
```

---

### Task 2: `generateExamQuestion` routes through LlmClient (mock test)

**Files:**
- Test: `src/lib/llm/examiner.test.ts` (append) — `generateExamQuestion` itself is implemented in Task 1.

- [ ] **Step 1: Confirm the mock API, then write the test**

Read `src/lib/llm/mock.ts` first: `setObject(purpose, value)` keys by the **exact** `purpose` string, and `generateObject` does `schema.parse(value)`. So the key here must be `examiner:<kind>` and the value must satisfy `ExamQuestionSchema`.

```ts
// append to src/lib/llm/examiner.test.ts
import { MockLlmClient } from "./mock";
import { generateExamQuestion } from "./examiner";

describe("generateExamQuestion", () => {
  it("returns the parsed question from the client, keyed by purpose 'examiner:<kind>'", async () => {
    const mock = new MockLlmClient().setObject("examiner:by_section", { question: "Why 81.3%?", evidence_unit_ids: ["e4"] });
    const out = await generateExamQuestion(mock, { thesisId: "t1", title: "T", kind: "by_section", candidates: C });
    expect(out).toEqual({ question: "Why 81.3%?", evidence_unit_ids: ["e4"] });
    expect(mock.calls).toEqual([{ kind: "object", role: "default", purpose: "examiner:by_section" }]);
  });
  it("uses the 'hard' role for hostile and cross_section", async () => {
    const mock = new MockLlmClient()
      .setObject("examiner:hostile", { question: "Q?", evidence_unit_ids: ["e1"] });
    await generateExamQuestion(mock, { thesisId: "t1", title: "T", kind: "hostile", candidates: C });
    expect(mock.calls[0]?.role).toBe("hard");
  });
});
```

- [ ] **Step 2: Run**

Run: `npx vitest run src/lib/llm/examiner.test.ts -t "generateExamQuestion"`
Expected: PASS (`generateExamQuestion` exists from Task 1; this pins the `examiner:<kind>` purpose key, the pass-through return, and the role mapping).

- [ ] **Step 3: (no new impl)**

- [ ] **Step 4: Run the full file**

Run: `npx vitest run src/lib/llm/examiner.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/llm/examiner.test.ts
git commit -m "test(m3a): generateExamQuestion routes through LlmClient by purpose + role (Task 2)"
```

---

### Task 3: Repository — evidence-with-section, practice-run bound evidence, atomic insert+bind

**Files:**
- Modify: `src/db/repository.ts`
- Test: `src/db/repository.examiner.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/db/repository.examiner.test.ts
import { describe, it, expect } from "vitest";
import { makeTestDb } from "../test/db";
import { getThesisEvidenceWithSection, insertPracticeRunWithEvidence, getPracticeRunBoundEvidence } from "./repository";

function seed(db: ReturnType<typeof makeTestDb>) {
  db.exec(`
    INSERT INTO thesis (id,title,source_kind,is_active) VALUES ('t1','T','md',1);
    INSERT INTO thesis_chunk (id,thesis_id,ord,section,text,char_count,hash) VALUES ('c1','t1',0,'Methods','m',1,'h1');
    INSERT INTO thesis_chunk (id,thesis_id,ord,section,text,char_count,hash) VALUES ('c2','t1',1,'Results','r',1,'h2');
    INSERT INTO evidence_unit (id,thesis_id,chunk_id,section,char_start,char_end,text,hash) VALUES ('e1','t1','c1','Methods',0,1,'method detail','h1');
    INSERT INTO evidence_unit (id,thesis_id,chunk_id,section,char_start,char_end,text,hash) VALUES ('e2','t1','c2','Results',0,1,'result 81.3%','h2');
  `);
}

describe("examiner repository", () => {
  it("getThesisEvidenceWithSection returns id+text+section in thesis order", () => {
    const db = makeTestDb(); seed(db);
    expect(getThesisEvidenceWithSection(db, "t1")).toEqual([
      { id: "e1", text: "method detail", section: "Methods" },
      { id: "e2", text: "result 81.3%", section: "Results" },
    ]);
    db.close();
  });

  it("insertPracticeRunWithEvidence atomically creates a 'practice' run AND binds its evidence", () => {
    const db = makeTestDb(); seed(db);
    const id = insertPracticeRunWithEvidence(db, { thesisId: "t1", question: "Why 81.3%?", questionKind: "by_section" }, ["e2"]);
    const row = db.prepare("SELECT thesis_id, question, question_kind, status, answer_text FROM practice_run WHERE id=?").get(id) as {
      thesis_id: string; question: string; question_kind: string; status: string; answer_text: string | null;
    };
    expect(row).toMatchObject({ thesis_id: "t1", question: "Why 81.3%?", question_kind: "by_section", status: "practice", answer_text: null });
    expect(getPracticeRunBoundEvidence(db, id)).toEqual([{ id: "e2", text: "result 81.3%" }]);
    db.close();
  });

  it("insertPracticeRunWithEvidence rejects empty evidence and leaves no orphan run", () => {
    const db = makeTestDb(); seed(db);
    expect(() => insertPracticeRunWithEvidence(db, { thesisId: "t1", question: "Q?", questionKind: "random" }, [])).toThrow(/evidence/i);
    expect((db.prepare("SELECT count(*) c FROM practice_run").get() as { c: number }).c).toBe(0);
    db.close();
  });

  it("insertPracticeRunWithEvidence rejects an invalid question_kind with a domain error (before any insert)", () => {
    const db = makeTestDb(); seed(db);
    expect(() => insertPracticeRunWithEvidence(db, { thesisId: "t1", question: "Q?", questionKind: "bogus" }, ["e1"])).toThrow(/question_kind/i);
    expect((db.prepare("SELECT count(*) c FROM practice_run").get() as { c: number }).c).toBe(0);
    db.close();
  });

  it("insertPracticeRunWithEvidence rejects cross-thesis evidence (bind enforces same-thesis) with no orphan run", () => {
    const db = makeTestDb(); seed(db);
    db.exec(`
      INSERT INTO thesis (id,title,source_kind,is_active) VALUES ('t2','Other','md',0);
      INSERT INTO thesis_chunk (id,thesis_id,ord,section,text,char_count,hash) VALUES ('c9','t2',0,'S','x',1,'h9');
      INSERT INTO evidence_unit (id,thesis_id,chunk_id,section,char_start,char_end,text,hash) VALUES ('eX','t2','c9','S',0,1,'x','h9');
    `);
    expect(() => insertPracticeRunWithEvidence(db, { thesisId: "t1", question: "Q?", questionKind: "random" }, ["eX"])).toThrow();
    expect((db.prepare("SELECT count(*) c FROM practice_run").get() as { c: number }).c).toBe(0); // tx rolled back
    db.close();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/db/repository.examiner.test.ts`
Expected: FAIL — the new exports do not exist.

- [ ] **Step 3: Write the minimal implementation**

Append to `src/db/repository.ts` (near `getThesisEvidence`/`bindPracticeRunEvidence`; reuse the already-imported `randomUUID`, the existing `EvidenceText` type, and the existing `bindPracticeRunEvidence`):

```ts
export type ExamEvidence = { id: string; text: string; section: string | null };

export const PRACTICE_QUESTION_KINDS = ["random", "by_section", "cross_section", "hostile", "boundary", "followup"] as const;

export function getThesisEvidenceWithSection(db: DB, thesisId: string): ExamEvidence[] {
  return db
    .prepare(
      `SELECT eu.id AS id, eu.text AS text, eu.section AS section
         FROM evidence_unit eu JOIN thesis_chunk tc ON tc.id = eu.chunk_id
        WHERE eu.thesis_id = ? ORDER BY tc.ord, eu.char_start, eu.id`,
    )
    .all(thesisId) as ExamEvidence[];
}

/** Evidence bound to a practice_run — NOTE the join table is practice_run_evidence,
 *  distinct from getBoundEvidence() which reads prep_item_evidence. */
export function getPracticeRunBoundEvidence(db: DB, practiceRunId: string): EvidenceText[] {
  return db
    .prepare(
      `SELECT eu.id AS id, eu.text AS text
         FROM practice_run_evidence pre JOIN evidence_unit eu ON eu.id = pre.evidence_unit_id
        WHERE pre.practice_run_id = ? ORDER BY eu.id`,
    )
    .all(practiceRunId) as EvidenceText[];
}

/** Atomically insert a practice_run AND bind its evidence. There is intentionally no
 *  public path that persists an unbound run (every question must cite ≥1 evidence). */
export function insertPracticeRunWithEvidence(
  db: DB,
  input: { thesisId: string; question: string; questionKind: string },
  evidenceUnitIds: string[],
): string {
  if (!(PRACTICE_QUESTION_KINDS as readonly string[]).includes(input.questionKind)) {
    throw new Error(`invalid question_kind: ${input.questionKind}`);
  }
  if (evidenceUnitIds.length === 0) throw new Error("a practice_run must bind at least one evidence_unit");
  const id = randomUUID();
  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO practice_run (id, thesis_id, question, question_kind, status)
       VALUES (@id, @thesis_id, @question, @question_kind, 'practice')`,
    ).run({ id, thesis_id: input.thesisId, question: input.question, question_kind: input.questionKind });
    bindPracticeRunEvidence(db, id, evidenceUnitIds); // re-enforces same-thesis; throws EvidenceBindingError otherwise
  });
  tx();
  return id;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/db/repository.examiner.test.ts`
Expected: PASS (5 tests). The cross-thesis case proves the transaction rolls back the run insert when the bind throws.

- [ ] **Step 5: Commit**

```bash
git add src/db/repository.ts src/db/repository.examiner.test.ts
git commit -m "feat(m3a): repository evidence-with-section + practice-run bound evidence + atomic insert+bind (Task 3)"
```

---

### Task 4: `runExaminerQuestion` orchestrator (select → generate → filter → atomic persist+bind)

**Files:**
- Create: `src/lib/llm/examiner-run.ts`
- Test: `src/lib/llm/examiner-run.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/llm/examiner-run.test.ts
import { describe, it, expect } from "vitest";
import { makeTestDb } from "../../test/db";
import { MockLlmClient } from "./mock";
import { runExaminerQuestion } from "./examiner-run";

function seed(db: ReturnType<typeof makeTestDb>) {
  db.exec(`
    INSERT INTO thesis (id,title,source_kind,is_active) VALUES ('t1','T','md',1);
    INSERT INTO thesis_chunk (id,thesis_id,ord,section,text,char_count,hash) VALUES ('c1','t1',0,'Methods','m',1,'h1');
    INSERT INTO thesis_chunk (id,thesis_id,ord,section,text,char_count,hash) VALUES ('c2','t1',1,'Results','r',1,'h2');
    INSERT INTO evidence_unit (id,thesis_id,chunk_id,section,char_start,char_end,text,hash) VALUES ('e1','t1','c1','Methods',0,1,'method detail','h1');
    INSERT INTO evidence_unit (id,thesis_id,chunk_id,section,char_start,char_end,text,hash) VALUES ('e2','t1','c2','Results',0,1,'result 81.3%','h2');
  `);
}

describe("runExaminerQuestion", () => {
  it("generates a question, persists a practice_run, and binds the cited evidence", async () => {
    const db = makeTestDb(); seed(db);
    const mock = new MockLlmClient().setObject("examiner:by_section", { question: "Why 81.3%?", evidence_unit_ids: ["e2"] });
    const res = await runExaminerQuestion(db, mock, "t1", "by_section", { section: "Results" });

    expect(res.question).toBe("Why 81.3%?");
    expect(res.evidenceUnitIds).toEqual(["e2"]);
    const run = db.prepare("SELECT question_kind, status FROM practice_run WHERE id=?").get(res.practiceRunId) as { question_kind: string; status: string };
    expect(run).toMatchObject({ question_kind: "by_section", status: "practice" });
    expect((db.prepare("SELECT evidence_unit_id FROM practice_run_evidence WHERE practice_run_id=?").get(res.practiceRunId) as { evidence_unit_id: string }).evidence_unit_id).toBe("e2");
    db.close();
  });

  it("drops cited ids that were not in the offered candidate set (anti-hallucination)", async () => {
    const db = makeTestDb(); seed(db);
    // by_section=Results offers only e2; the model also cites e1 (Methods, not offered) and 'eX' (nonexistent)
    const mock = new MockLlmClient().setObject("examiner:by_section", { question: "Q?", evidence_unit_ids: ["e2", "e1", "eX"] });
    const res = await runExaminerQuestion(db, mock, "t1", "by_section", { section: "Results" });
    expect(res.evidenceUnitIds).toEqual(["e2"]);
    expect((db.prepare("SELECT count(*) c FROM practice_run_evidence WHERE practice_run_id=?").get(res.practiceRunId) as { c: number }).c).toBe(1);
    db.close();
  });

  it("throws and persists nothing when the model cites no offered evidence", async () => {
    const db = makeTestDb(); seed(db);
    const mock = new MockLlmClient().setObject("examiner:by_section", { question: "Q?", evidence_unit_ids: ["eX"] });
    await expect(runExaminerQuestion(db, mock, "t1", "by_section", { section: "Results" })).rejects.toThrow(/no provided evidence/i);
    expect((db.prepare("SELECT count(*) c FROM practice_run").get() as { c: number }).c).toBe(0); // no orphan run
    db.close();
  });

  it("by_section without a section is rejected (no whole-thesis fallback)", async () => {
    const db = makeTestDb(); seed(db);
    const mock = new MockLlmClient().setObject("examiner:by_section", { question: "Q?", evidence_unit_ids: ["e1"] });
    await expect(runExaminerQuestion(db, mock, "t1", "by_section")).rejects.toThrow(/requires opts\.section/i);
    db.close();
  });

  it("followup uses the previous run's bound evidence and previous Q/A", async () => {
    const db = makeTestDb(); seed(db);
    const first = await runExaminerQuestion(
      db,
      new MockLlmClient().setObject("examiner:random", { question: "Q1?", evidence_unit_ids: ["e1"] }),
      "t1",
      "random",
    );
    db.prepare("UPDATE practice_run SET answer_text='my answer' WHERE id=?").run(first.practiceRunId);

    const mock = new MockLlmClient().setObject("examiner:followup", { question: "Follow up on e1?", evidence_unit_ids: ["e1"] });
    const res = await runExaminerQuestion(db, mock, "t1", "followup", { previousRunId: first.practiceRunId });
    expect(res.evidenceUnitIds).toEqual(["e1"]);
    db.close();
  });

  it("followup falls back to the transcript when answer_text is empty", async () => {
    const db = makeTestDb(); seed(db);
    const first = await runExaminerQuestion(
      db,
      new MockLlmClient().setObject("examiner:random", { question: "Q1?", evidence_unit_ids: ["e1"] }),
      "t1",
      "random",
    );
    db.prepare("UPDATE practice_run SET transcript='spoken answer' WHERE id=?").run(first.practiceRunId);
    const mock = new MockLlmClient().setObject("examiner:followup", { question: "F?", evidence_unit_ids: ["e1"] });
    const res = await runExaminerQuestion(db, mock, "t1", "followup", { previousRunId: first.practiceRunId });
    expect(res.evidenceUnitIds).toEqual(["e1"]);
    db.close();
  });

  it("followup throws when the previous run has neither answer nor transcript", async () => {
    const db = makeTestDb(); seed(db);
    const first = await runExaminerQuestion(
      db,
      new MockLlmClient().setObject("examiner:random", { question: "Q1?", evidence_unit_ids: ["e1"] }),
      "t1",
      "random",
    );
    const mock = new MockLlmClient().setObject("examiner:followup", { question: "F?", evidence_unit_ids: ["e1"] });
    await expect(runExaminerQuestion(db, mock, "t1", "followup", { previousRunId: first.practiceRunId })).rejects.toThrow(/no answer/i);
    db.close();
  });

  it("followup rejects a previous run that belongs to another thesis", async () => {
    const db = makeTestDb(); seed(db);
    db.exec(`INSERT INTO thesis (id,title,source_kind,is_active) VALUES ('t2','Other','md',0);`);
    const first = await runExaminerQuestion(
      db,
      new MockLlmClient().setObject("examiner:random", { question: "Q1?", evidence_unit_ids: ["e1"] }),
      "t1",
      "random",
    );
    db.prepare("UPDATE practice_run SET answer_text='a' WHERE id=?").run(first.practiceRunId);
    const mock = new MockLlmClient().setObject("examiner:followup", { question: "F?", evidence_unit_ids: ["e1"] });
    await expect(runExaminerQuestion(db, mock, "t2", "followup", { previousRunId: first.practiceRunId })).rejects.toThrow(/not found for this thesis/i);
    db.close();
  });

  it("a disabled client rejects and persists nothing", async () => {
    const db = makeTestDb(); seed(db);
    const disabled = { enabled: false, generateObject: () => Promise.reject(new Error("disabled")), generateText: () => Promise.reject(new Error("disabled")) };
    await expect(runExaminerQuestion(db, disabled as never, "t1", "random")).rejects.toThrow();
    expect((db.prepare("SELECT count(*) c FROM practice_run").get() as { c: number }).c).toBe(0);
    db.close();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/llm/examiner-run.test.ts`
Expected: FAIL — `Cannot find module './examiner-run'`.

- [ ] **Step 3: Write the minimal implementation**

```ts
// src/lib/llm/examiner-run.ts
import "server-only";
import type { Database as DB } from "better-sqlite3";
import type { LlmClient } from "./types";
import { type QuestionKind, type EvidenceCandidate, selectCandidates, generateExamQuestion } from "./examiner";
import {
  getThesisEvidenceWithSection,
  getPracticeRunBoundEvidence,
  insertPracticeRunWithEvidence,
} from "../../db/repository";

export async function runExaminerQuestion(
  db: DB,
  client: LlmClient,
  thesisId: string,
  kind: QuestionKind,
  opts?: { section?: string | null; previousRunId?: string },
): Promise<{ practiceRunId: string; question: string; evidenceUnitIds: string[] }> {
  const thesis = db.prepare("SELECT title FROM thesis WHERE id=?").get(thesisId) as { title: string } | undefined;
  if (!thesis) throw new Error(`thesis not found: ${thesisId}`);

  let candidates: EvidenceCandidate[];
  let previous: { question: string; answer: string } | null = null;

  if (kind === "followup") {
    if (!opts?.previousRunId) throw new Error("followup requires opts.previousRunId");
    const prev = db
      .prepare("SELECT question, answer_text, transcript FROM practice_run WHERE id=? AND thesis_id=?")
      .get(opts.previousRunId, thesisId) as { question: string; answer_text: string | null; transcript: string | null } | undefined;
    if (!prev) throw new Error(`previous run not found for this thesis: ${opts.previousRunId}`);
    const answer = (prev.answer_text ?? "").trim() || (prev.transcript ?? "").trim();
    if (!answer) throw new Error("previous run has no answer (or transcript) to follow up on");
    candidates = getPracticeRunBoundEvidence(db, opts.previousRunId).map((e) => ({ id: e.id, text: e.text, section: null }));
    previous = { question: prev.question, answer };
  } else {
    candidates = selectCandidates(getThesisEvidenceWithSection(db, thesisId), kind, opts);
  }
  if (candidates.length === 0) throw new Error(`no candidate evidence for kind=${kind}`);

  const q = await generateExamQuestion(client, { thesisId, title: thesis.title, kind, candidates, previous });

  // Anti-hallucination: keep only ids that were actually offered (dedup, preserve order).
  const offered = new Set(candidates.map((c) => c.id));
  const evidenceUnitIds = Array.from(new Set(q.evidence_unit_ids)).filter((id) => offered.has(id));
  if (evidenceUnitIds.length === 0) throw new Error("examiner cited no provided evidence");

  // Atomic insert+bind (no orphan practice_run) lives in the repository helper.
  const practiceRunId = insertPracticeRunWithEvidence(db, { thesisId, question: q.question, questionKind: kind }, evidenceUnitIds);

  return { practiceRunId, question: q.question, evidenceUnitIds };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/llm/examiner-run.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/llm/examiner-run.ts src/lib/llm/examiner-run.test.ts
git commit -m "feat(m3a): runExaminerQuestion orchestrator (select->generate->filter->bind) (Task 4)"
```

---

## Full-suite gate (Claude runs; Codex cannot run npm/vitest)

```bash
npm run check   # typecheck + lint + vitest (all suites)
npm run build   # Next prod build smoke (server-only imports must not crash)
```
Expected: all green; test count = previous (88) + new examiner tests. No new lint errors — use typed casts in tests (`as { c: number }`), never `as any` (matches the M2 test convention).

## Red-line / safety checklist (verify before the milestone gate)

1. **Evidence-bound (red line #1):** there is no public path that persists an unbound `practice_run` — `insertPracticeRunWithEvidence` requires ≥1 evidence id and inserts+binds in one transaction (a bind failure rolls back the run). The runner additionally throws before persisting if no offered id was cited. A *question* is not a factual claim, so there is intentionally **no** validator/`verified` state here — that gate is for generated *content* (M2); the judge (M3b) scores against this binding.
2. **No hallucinated grounding:** cited ids are filtered to the offered candidate set; `bindPracticeRunEvidence` independently re-enforces same-thesis (`EvidenceBindingError`).
3. **LLM only via `lib/llm` (red line #2):** the sole model call is `generateExamQuestion` → `client.generateObject`; `purpose` is `examiner:<kind>`; role `hard` for hostile/cross_section else `default`; no provider SDK, no hardcoded model.
4. **Graceful degrade (red line #4):** a disabled client rejects; the runner persists nothing (no partial run). The UI layer (later milestone) keeps practice usable without AI by letting the user pick a question manually.
5. **Tests use `MockLlmClient` (red line #5):** no live calls.

## Self-review (done while writing; updated after review round 1)

- **Spec coverage:** spec §11 examiner *modes* (random/by_section/cross_section/hostile/boundary/followup) → all six handled (selection branch + per-kind prompt); each question binds `evidence_unit` via `practice_run_evidence` (§6) → Tasks 3–4. **Retrieval is explicitly deferred (acceptance criterion):** spec §11/§6 tie `cross_section`/integrative questioning to `evidence_fts` + section coverage (P1-8); M3a uses deterministic thesis-ordered selection (no `ORDER BY RANDOM()`), so `cross_section` is a **limited approximation** (first sections, not FTS-relevance). Full FTS retrieval + the content-accuracy coverage metric are **out of scope for M3a** and tracked for a later milestone (M3b/M4). This plan does NOT claim full §11 retrieval fidelity.
- **Type consistency:** `EvidenceCandidate {id,text,section}` (examiner) and `ExamEvidence {id,text,section}` (repository) are structurally identical; the followup path maps `getPracticeRunBoundEvidence` `{id,text}` → `{...,section:null}`. `QuestionKind` (lib/llm) is the typed source for callers; `insertPracticeRunWithEvidence` takes `questionKind: string` but validates it against the DB-local `PRACTICE_QUESTION_KINDS` (domain error before any insert) — this both avoids a db→lib/llm import cycle and stops invalid kinds from reaching SQLite as a raw CHECK violation.
- **Evidence join tables are distinct:** `getBoundEvidence` reads `prep_item_evidence` (prep items); `getPracticeRunBoundEvidence` reads `practice_run_evidence` (practice runs). The followup path must use the latter (round-1 P0 fix).
- **Policy decisions (resolved in round 1):** (a) cite-nothing-offered → throw (caller/UI retries), not silent; (b) `by_section` requires `opts.section` (no whole-thesis fallback); (c) followup prior answer = `answer_text` else `transcript`, error if neither.
- **No placeholders:** every step has full code + exact commands.
