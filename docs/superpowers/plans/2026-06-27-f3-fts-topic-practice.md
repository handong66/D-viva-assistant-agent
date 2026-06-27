# Feature 3 — FTS retrieval: optional "topic" filter for practice questions

> **老流程:** Codex implements per task; Claude runs the gate + reviews + commits, with a Codex design review before code and a milestone gate after. (Touches the examiner/evidence path — gets a milestone gate. **Redesigned after design round 1.**)

**Goal:** Use the **already-built FTS5 index** (`evidence_fts` + sync triggers, migration 0002) for query-driven retrieval where it fits: an **optional "topic" filter** on practice questions. The user picks a question type (Random / Cross-section / Hostile / Boundary) and optionally types a topic ("methodology", "sample size"). When a topic is given, FTS retrieves the most relevant evidence units and the examiner asks its question grounded only in that retrieved evidence — "出题时按相关性挑证据" — and for long theses it bounds how much evidence goes into the prompt.

> **Round-1 fix — no new `question_kind`, no migration:** the first design added a `by_topic` kind, but `practice_run.question_kind` has a DB `CHECK` + a repository allow-list that exclude it (saving would crash). Instead, the topic is an **optional candidate-source override**: it changes WHICH evidence the examiner sees, while the stored `question_kind` stays the real, already-valid kind. This sidesteps the schema entirely and is more flexible (any general kind can be topic-scoped).

**Architecture:** A repository `searchEvidence(db, thesisId, query, limit)` runs a **sanitised** FTS5 `MATCH` (`ORDER BY rank`, scoped `eu.thesis_id = ?`). In `runExaminerQuestion`, when `opts.topic` is non-empty (and not a followup), candidates come from `searchEvidence` instead of `selectCandidates(all)`. Everything downstream — the LLM call, the offered-ids anti-hallucination filter, the atomic insert+bind — is unchanged, so grounding/evidence-binding is preserved (red line #1) and the stored kind is unchanged.

**Tech Stack:** SQLite FTS5 (built-in, already migrated), Next 16 RSC + the existing practice Server Action, vitest.

---

### Task 1: `searchEvidence` (FTS) + topic candidate-source in the run

**Files:** Modify `src/db/repository.ts` (+`src/db/repository.fts.test.ts`), `src/lib/llm/examiner-run.ts` (+`src/lib/llm/examiner-run.test.ts`)

- [ ] **Step 1: Failing tests**
  - `src/db/repository.fts.test.ts`: seed via `insertThesisWithChunks` (inserting `evidence_unit` rows fires the 0002 triggers → `evidence_fts` populated); `searchEvidence(db,"t1","methodology",5)` returns only matching units, ranked, scoped to the thesis (a different thesis's matching unit is excluded); a punctuation-only query → `[]`; `searchEvidence(db,"t1","sample-size")` tokenises to `sample` + `size` (intra-word punctuation does NOT collapse them) and matches either.
  - `src/lib/llm/examiner-run.test.ts`: with a mock client + seeded FTS, `runExaminerQuestion(db, mock, "t1", "random", { topic: "methods" })` offers ONLY the FTS-retrieved units as candidates and binds to a cited subset; the stored `question_kind` is still `"random"`; without a topic it uses `selectCandidates` as before; a topic with zero matches throws "no candidate evidence".

- [ ] **Step 2: `searchEvidence`** — append to `src/db/repository.ts`:
```ts
export type EvidenceHit = { id: string; text: string; section: string | null };
export function searchEvidence(db: DB, thesisId: string, query: string, limit = 8): EvidenceHit[] {
  // Tokenise to alphanumeric runs (matching the unicode61 index; "sample-size" → sample, size),
  // quote each, OR-join — never pass raw user text to FTS5 MATCH (a stray quote/operator errors).
  const terms = query.match(/[\p{L}\p{N}]+/gu) ?? [];
  if (terms.length === 0) return [];
  const match = terms.map((t) => `"${t}"`).join(" OR ");
  return db
    .prepare(
      `SELECT eu.id AS id, eu.text AS text, eu.section AS section
         FROM evidence_fts f JOIN evidence_unit eu ON eu.id = f.evidence_unit_id
        WHERE f.text MATCH ? AND eu.thesis_id = ?
        ORDER BY rank
        LIMIT ?`,
    )
    .all(match, thesisId, limit) as EvidenceHit[];
}
```

- [ ] **Step 3: topic candidate-source** — in `src/lib/llm/examiner-run.ts`, add `topic?: string` to `opts` and a branch BEFORE the `selectCandidates` fallback (mirroring how `followup` sources its own candidates); `kind` is passed through to the insert unchanged:
```ts
} else if (opts?.topic?.trim()) {
  candidates = searchEvidence(db, thesisId, opts.topic).map((e) => ({ id: e.id, text: e.text, section: e.section }));
} else {
  candidates = selectCandidates(getThesisEvidenceWithSection(db, thesisId), kind, opts);
}
```
(import `searchEvidence`; the existing `candidates.length === 0` guard throws "no candidate evidence for kind=…"; the offered-ids filter still enforces grounding. No `examiner.ts` change — no new kind/instruction.)

- [ ] **Step 4: PASS + typecheck**, commit — `git commit -m "feat(f3): FTS searchEvidence + optional topic candidate-source in the examiner run"`

---

### Task 2: topic input on the practice form + action

**Files:** Modify `src/app/practice/start-form.tsx`, `src/app/_actions/practice.ts`

- [ ] **Step 1: Action** — in `startPracticeAction` (`src/app/_actions/practice.ts`): read `const topic = String(formData.get("topic") ?? "").trim();` and pass it through — `await runExaminerQuestion(db, client, thesis.id, kind as QuestionKind, topic ? { topic } : undefined);`. No `SELECTABLE` change (the kind stays one of the existing selectable kinds). Keep the try/catch (a topic with no FTS hits → the existing generic "Could not generate a question." — acceptable for v1).

- [ ] **Step 2: Start form** — in `src/app/practice/start-form.tsx`, add a `name="topic"` text input (label "Topic (optional)", placeholder "e.g. methodology, sample size") next to the kind select. Harmless when empty; the action only uses it when non-empty. No new client state (plain input).

- [ ] **Step 3: Typecheck + build**, commit — `git commit -m "feat(f3): optional topic input on the practice form"`

---

### Task 3: spec doc-sync (AGENTS.md §"Doc-sync")

**Files:** Modify `docs/superpowers/specs/2026-06-23-viva-assistant-generic-design.md`

- [ ] Update the examiner/evidence section to note **FTS retrieval**: the `evidence_fts` index (already in §6/migration 0002) now has a reader `searchEvidence`, used as an optional topic filter that sources the examiner's candidates by BM25 relevance instead of the full pool; the stored `question_kind` is unchanged; grounding/binding is preserved. Commit — `git commit -m "docs(f3): spec — FTS topic retrieval for the examiner"`

---

## Gate + smoke (Claude)

```bash
npm run check   # searchEvidence FTS tests + examiner-run topic test + existing suite
npm run build   # /practice compiles
```
Dev smoke (AI off): import a thesis → `/practice` shows the kind select + a "Topic (optional)" input. (Topic generation needs AI — mock-tested. Direct `searchEvidence` smoke: inject evidence + query a term → ranked hits scoped to the thesis.)

## Red lines

1. **Evidence-binding preserved (#1):** the topic filter only changes WHICH evidence is offered (FTS top-k); the question is still grounded in that real evidence, and `runExaminerQuestion`'s offered-ids filter + atomic insert+bind are unchanged. FTS narrows candidates; it never lets the model cite unprovided evidence. The stored `question_kind` stays a valid existing kind (no schema/CHECK change).
2. **Unified LLM + degrade (#2/#4):** the examiner still calls `client.generateObject`; AI off → the existing `AI_OFF` guard. Mock-tested.
3. **Local-first + no injection (#3):** FTS5 is local SQLite (no new outbound/dep); the topic is sanitised to quoted alphanumeric tokens before `MATCH`.

## Self-review

- **Round-1 NO-GO resolved:** dropping the `by_topic` kind in favour of an optional topic candidate-source removes the `practice_run.question_kind` CHECK/allow-list blocker entirely — no migration, no schema risk, and topic-scoping now works with any general kind.
- **Uses the dormant index:** `evidence_fts` + triggers (0002) were never queried; `searchEvidence` is the first reader. `insertThesisWithChunks` fires the triggers, so FTS is populated in test DBs.
- **P2 fix (recall):** tokenising via `/[\p{L}\p{N}]+/gu` matches the unicode61 tokeniser, so `sample-size` searches `sample` + `size`.
- **Doc-sync (P1):** Task 3 updates the spec per AGENTS.md.
- **Open question for round-2 review:** is the optional-topic-override the right shape (vs a distinct mode)? And is surfacing a no-FTS-hit topic as the generic error acceptable, or worth a specific "no evidence matched that topic" message?
