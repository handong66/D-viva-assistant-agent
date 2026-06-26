import "server-only";
import type { Paragraph, QualityReport, SourceKind } from "./types";

const HEADING = /^(#{1,6})\s+(.*)$/;

function buildReport(sourceKind: SourceKind, paragraphs: Paragraph[]): QualityReport {
  const chars = paragraphs.reduce((n, p) => n + p.text.length, 0);
  const sections = new Set(paragraphs.map((p) => p.section).filter(Boolean)).size;
  const warnings: string[] = [];
  const ok = paragraphs.length >= 3 && chars >= 200;
  if (!ok) warnings.push("Extraction looks short/sparse — paste Markdown or plain text for best results.");
  return {
    sourceKind,
    paragraphs: paragraphs.length,
    chars,
    sections,
    warnings,
    ok,
    sampleSnippets: paragraphs.slice(0, 3).map((p) => p.text.slice(0, 120)),
  };
}

// Split a body into paragraphs on blank lines, returning trimmed non-empty blocks.
function splitParas(body: string): string[] {
  return body
    .replace(/\r\n?/g, "\n")
    .split(/\n\s*\n/)
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter((s) => s.length > 0);
}

export function extractMarkdown(content: string): { paragraphs: Paragraph[]; report: QualityReport } {
  const lines = content.replace(/\r\n?/g, "\n").split("\n");
  const paragraphs: Paragraph[] = [];
  let section: string | undefined;
  let buf: string[] = [];
  const flush = () => {
    const text = buf.join(" ").replace(/\s+/g, " ").trim();
    if (text) paragraphs.push(section ? { text, section } : { text });
    buf = [];
  };
  for (const line of lines) {
    const h = HEADING.exec(line.trim());
    if (h) {
      flush();
      section = h[2]!.trim();
      continue;
    }
    if (line.trim() === "") {
      flush();
      continue;
    }
    buf.push(line.trim());
  }
  flush();
  return { paragraphs, report: buildReport("md", paragraphs) };
}

export function extractText(content: string): { paragraphs: Paragraph[]; report: QualityReport } {
  const paragraphs = splitParas(content).map((text) => ({ text }));
  return { paragraphs, report: buildReport("txt", paragraphs) };
}

export function pdfTextToParagraphs(text: string): { paragraphs: Paragraph[]; report: QualityReport } {
  const paragraphs = splitParas(text).map((t) => ({ text: t }));
  return { paragraphs, report: buildReport("pdf", paragraphs) };
}

export async function extractPdf(data: Uint8Array): Promise<{ paragraphs: Paragraph[]; report: QualityReport }> {
  const { extractText: pdfExtract, getDocumentProxy } = await import("unpdf");
  const doc = await getDocumentProxy(data);
  const { text } = await pdfExtract(doc, { mergePages: true });
  return pdfTextToParagraphs(text);
}
