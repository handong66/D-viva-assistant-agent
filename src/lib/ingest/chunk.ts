import { createHash } from "node:crypto";
import type { Chunk, Paragraph } from "./types";

const SEP = "\n\n";

export function chunkParagraphs(paragraphs: Paragraph[], opts?: { maxChars?: number }): Chunk[] {
  const maxChars = opts?.maxChars ?? 1500;
  const chunks: Chunk[] = [];
  let ord = 0;
  let cursor = 0;
  let buf: Paragraph[] = [];
  let bufLen = 0;
  let start = 0;
  let section: string | undefined;

  const flush = () => {
    if (buf.length === 0) return;
    const text = buf.map((p) => p.text).join(SEP);
    chunks.push({
      ord: ord++,
      section,
      text,
      charStart: start,
      charEnd: start + text.length,
      hash: createHash("sha256").update(text).digest("hex"),
    });
    cursor = start + text.length;
    buf = [];
    bufLen = 0;
  };

  for (const p of paragraphs) {
    const sectionChanged = buf.length > 0 && p.section !== section;
    if (buf.length > 0 && (sectionChanged || bufLen + SEP.length + p.text.length > maxChars)) {
      flush();
      cursor += SEP.length;
    }
    if (buf.length === 0) {
      start = cursor;
      section = p.section;
      buf.push(p);
      bufLen = p.text.length;
    } else {
      buf.push(p);
      bufLen += SEP.length + p.text.length;
    }
  }
  flush();
  return chunks;
}
