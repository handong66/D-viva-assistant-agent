import { describe, expect, it } from "vitest";
import { parseImportForm } from "./parse";

describe("parseImportForm", () => {
  it("rejects a blank title", () => {
    expect(() => parseImportForm({ title: "   ", sourceKind: "md", content: "Body" })).toThrow("Title is required");
  });

  it("rejects md with no content", () => {
    expect(() => parseImportForm({ title: "T", sourceKind: "md", content: "   " })).toThrow("Content is required");
  });

  it("rejects txt with no content", () => {
    expect(() => parseImportForm({ title: "T", sourceKind: "txt" })).toThrow("Content is required");
  });

  it("rejects pdf with no data", () => {
    expect(() => parseImportForm({ title: "T", sourceKind: "pdf" })).toThrow("PDF file is required");
  });

  it("returns valid md input with a trimmed title", () => {
    expect(parseImportForm({ title: "  My Thesis  ", sourceKind: "md", content: "# Intro\n\nBody" })).toEqual({
      title: "My Thesis",
      sourceKind: "md",
      content: "# Intro\n\nBody",
    });
  });

  it("returns valid pdf input with bytes", () => {
    const data = new Uint8Array([1, 2, 3]);
    expect(parseImportForm({ title: "T", sourceKind: "pdf", data })).toEqual({
      title: "T",
      sourceKind: "pdf",
      data,
    });
  });
});
