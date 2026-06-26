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
    const bySection = new Map<string | null, EvidenceCandidate[]>();
    for (const candidate of all) {
      let selected = bySection.get(candidate.section);
      if (!selected) {
        selected = [];
        bySection.set(candidate.section, selected);
      }
      if (selected.length < 2) {
        selected.push(candidate);
      }
    }
    return Array.from(bySection.values()).slice(0, 3).flat();
  }

  return all;
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
  const evidenceLines = args.candidates
    .map((candidate) => `[${candidate.id}] (${candidate.section ?? "unsectioned"}) ${candidate.text}`)
    .join("\n");
  const lines = [
    `You are a viva (thesis defence) examiner for the thesis "${args.title}".`,
    KIND_INSTRUCTIONS[args.kind],
    "Ground the question ONLY in the evidence below and cite the exact evidence_unit_ids the question is based on. Do NOT ask about anything not supported by this evidence.",
  ];

  if (args.previous) {
    lines.push("", `PREVIOUS QUESTION: ${args.previous.question}`, `CANDIDATE ANSWER: ${args.previous.answer}`);
  }

  lines.push("", "EVIDENCE (id: text):", evidenceLines);
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
