import "server-only";
import { randomUUID } from "node:crypto";
import type { Database as DB } from "better-sqlite3";
import type { QualityReport, SourceKind } from "./types";
import { extractMarkdown, extractText, extractPdf } from "./extract";
import { chunkParagraphs } from "./chunk";
import { insertThesisWithChunks } from "../../db/repository";

export type IngestInput =
  | { title: string; author?: string; sourceKind: "md" | "txt"; content: string }
  | { title: string; author?: string; sourceKind: "pdf"; data: Uint8Array };

export async function ingestThesis(db: DB, input: IngestInput): Promise<{ thesisId: string; report: QualityReport }> {
  const extracted =
    input.sourceKind === "pdf" ? await extractPdf(input.data)
    : input.sourceKind === "md" ? extractMarkdown(input.content)
    : extractText(input.content);

  const chunks = chunkParagraphs(extracted.paragraphs);
  const thesisId = randomUUID();
  insertThesisWithChunks(db, {
    thesis: { id: thesisId, title: input.title, author: input.author, source_kind: input.sourceKind as SourceKind },
    chunks,
  });
  return { thesisId, report: extracted.report };
}
