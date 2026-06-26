export type SourceKind = "pdf" | "md" | "txt";
export type Paragraph = { text: string; section?: string };
export type QualityReport = {
  sourceKind: SourceKind;
  paragraphs: number;
  chars: number;
  sections: number;
  warnings: string[];
  sampleSnippets: string[];
  ok: boolean;
};
export type Chunk = { ord: number; section?: string; text: string; charStart: number; charEnd: number; hash: string };
