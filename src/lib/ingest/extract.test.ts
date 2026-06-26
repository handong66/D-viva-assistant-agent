import { describe, it, expect } from "vitest";
import { extractMarkdown, extractText, pdfTextToParagraphs } from "./extract";

describe("extractMarkdown", () => {
  it("splits on blank lines and tracks the current section heading", () => {
    const md = "# Intro\n\nFirst para.\n\n## Methods\n\nWe did X.\n\nThen Y.";
    const { paragraphs, report } = extractMarkdown(md);
    expect(paragraphs).toEqual([
      { text: "First para.", section: "Intro" },
      { text: "We did X.", section: "Methods" },
      { text: "Then Y.", section: "Methods" },
    ]);
    expect(report.sections).toBe(2);
    expect(report.sourceKind).toBe("md");
  });

  it("flags a too-short extraction as not ok", () => {
    const { report } = extractMarkdown("# Title\n\nhi");
    expect(report.ok).toBe(false);
    expect(report.warnings.join(" ")).toMatch(/short|paste|markdown|text/i);
  });
});

describe("extractText", () => {
  it("splits plain text on blank lines with no sections", () => {
    const { paragraphs, report } = extractText("Para one is long enough here.\n\nPara two is also quite long.");
    expect(paragraphs.map((p) => p.text)).toEqual(["Para one is long enough here.", "Para two is also quite long."]);
    expect(report.sections).toBe(0);
    expect(report.sourceKind).toBe("txt");
  });
});

describe("pdfTextToParagraphs", () => {
  it("splits merged PDF text into paragraphs and reports pdf source", () => {
    const { paragraphs, report } = pdfTextToParagraphs("Para one long enough.\n\nPara two also long enough.");
    expect(paragraphs.map((p) => p.text)).toEqual(["Para one long enough.", "Para two also long enough."]);
    expect(report.sourceKind).toBe("pdf");
  });
});
