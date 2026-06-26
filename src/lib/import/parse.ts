import type { IngestInput } from "../ingest";

export type RawImport = {
  title: string;
  sourceKind: string;
  content?: string;
  data?: Uint8Array;
};

export function parseImportForm(raw: RawImport): IngestInput {
  const title = raw.title.trim();
  if (!title) throw new Error("Title is required");

  if (raw.sourceKind === "md" || raw.sourceKind === "txt") {
    const content = raw.content?.trim();
    if (!content) throw new Error("Content is required");
    return { title, sourceKind: raw.sourceKind, content };
  }

  if (raw.sourceKind === "pdf") {
    const data = raw.data;
    if (!data || data.byteLength === 0) throw new Error("PDF file is required");
    return { title, sourceKind: "pdf", data };
  }

  throw new Error("Unsupported source kind");
}
